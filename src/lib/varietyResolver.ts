// Variety resolver — supports the canonical iOS shape (varietyId → grape_varieties.id)
// plus name snapshots and canonical alias matching for built-in varieties.
//
// Resolution order (matches iOS):
//   1. Exact varietyId / variety_id against vineyard grape_varieties
//   2. Stable built-in deterministic ID against BUILTIN_VARIETY_BY_ID
//   3. Allocation name snapshot (allocation.name / allocation.varietyName / allocation.variety)
//      resolved via the alias map → canonical built-in name → grape_varieties (case-insensitive)
//   4. Otherwise: unresolved
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

export interface GrapeVariety {
  id: string;
  name: string;
}

export interface VarietyAllocationLike {
  id?: string;
  varietyKey?: string | null;
  variety_key?: string | null;
  varietyId?: string | null;
  variety_id?: string | null;
  variety?: string | null;
  name?: string | null;
  varietyName?: string | null;
  variety_name?: string | null;
  clone?: string | null;
  rootstock?: string | null;
  plantingYear?: number | null;
  planting_year?: number | null;
  percent?: number | null;
}

export type ResolverPath =
  | "varietyKey"
  | "varietyId"
  | "builtinId"
  | "nameSnapshot"
  | "alias"
  | "custom"
  | "unresolved";

export interface ResolvedAllocation {
  id?: string;
  name: string | null;     // resolved canonical display name, or null if unresolved
  percent: number | null;
  clone?: string | null;
  rootstock?: string | null;
  plantingYear?: number | null;
  raw: VarietyAllocationLike;
  resolved: boolean;
  /** Diagnostic: how we resolved this allocation. */
  resolverPath: ResolverPath;
}

// ---------------------------------------------------------------------------
// Built-in canonical varieties + aliases. Mirrors the iOS BuiltInVarieties.
// Canonical name is the value we display. Aliases are matched case-insensitive
// after stripping punctuation/whitespace.
// ---------------------------------------------------------------------------
const BUILTIN_VARIETIES: Array<{ key: string; name: string; aliases: string[] }> = [
  { key: "cabernet_sauvignon", name: "Cabernet Sauvignon", aliases: ["cab sauv", "cabernet sauv", "cab", "cabernet"] },
  { key: "cabernet_franc", name: "Cabernet Franc", aliases: ["cab franc", "cab frnc", "cab fr", "cabernet fr"] },
  { key: "merlot", name: "Merlot", aliases: ["mer"] },
  { key: "shiraz", name: "Shiraz", aliases: ["syrah"] },
  { key: "pinot_noir", name: "Pinot Noir", aliases: ["pinot n", "p noir", "pn"] },
  { key: "pinot_gris", name: "Pinot Gris", aliases: ["pinot grigio", "pinot gris grigio", "pinot gris / grigio", "p gris", "pg", "pinot_grigio"] },
  { key: "pinot_meunier", name: "Pinot Meunier", aliases: ["meunier"] },
  { key: "chardonnay", name: "Chardonnay", aliases: ["chard"] },
  { key: "sauvignon_blanc", name: "Sauvignon Blanc", aliases: ["sauv blanc", "savvy b", "sb", "sauvignon b"] },
  { key: "semillon", name: "Semillon", aliases: ["sem", "sémillon"] },
  { key: "riesling", name: "Riesling", aliases: ["ries"] },
  { key: "gruner_veltliner", name: "Gruner Veltliner", aliases: ["grüner veltliner", "gruner", "grüner", "gv"] },
  { key: "tempranillo", name: "Tempranillo", aliases: ["temp"] },
  { key: "primitivo", name: "Primitivo", aliases: ["zinfandel", "zin"] },
  { key: "nebbiolo", name: "Nebbiolo", aliases: ["nebb"] },
  { key: "sangiovese", name: "Sangiovese", aliases: ["sangio"] },
  { key: "grenache", name: "Grenache", aliases: ["garnacha"] },
  { key: "mourvedre", name: "Mourvedre", aliases: ["mourvèdre", "monastrell", "mataro"] },
  { key: "viognier", name: "Viognier", aliases: ["vio"] },
  { key: "verdelho", name: "Verdelho", aliases: [] },
  { key: "vermentino", name: "Vermentino", aliases: [] },
  { key: "marsanne", name: "Marsanne", aliases: [] },
  { key: "roussanne", name: "Roussanne", aliases: [] },
  { key: "petit_verdot", name: "Petit Verdot", aliases: ["pv"] },
  { key: "malbec", name: "Malbec", aliases: [] },
  { key: "barbera", name: "Barbera", aliases: [] },
  { key: "montepulciano", name: "Montepulciano", aliases: [] },
  { key: "fiano", name: "Fiano", aliases: [] },
  { key: "arneis", name: "Arneis", aliases: [] },
  { key: "gewurztraminer", name: "Gewurztraminer", aliases: ["gewürztraminer", "gewurz"] },
];

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Built-in lookup maps — by normalised name/alias AND by stable key.
const BUILTIN_BY_NORMAL_NAME: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const v of BUILTIN_VARIETIES) {
    m.set(normaliseName(v.name), v.name);
    m.set(normaliseName(v.key), v.name); // "pinot_gris" → "Pinot Gris"
    for (const a of v.aliases) m.set(normaliseName(a), v.name);
  }
  return m;
})();

const BUILTIN_BY_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const v of BUILTIN_VARIETIES) m.set(v.key, v.name);
  return m;
})();

/** Resolve a free-text variety name (or key) against built-in canonical names + aliases. */
export function resolveBuiltinName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (BUILTIN_BY_KEY.has(trimmed)) return BUILTIN_BY_KEY.get(trimmed)!;
  const key = normaliseName(trimmed);
  if (!key) return null;
  return BUILTIN_BY_NORMAL_NAME.get(key) ?? null;
}

/** Fetch the grape varieties for a vineyard (used to resolve varietyId).
 *  Returns [] if the table is unreachable / RLS blocks it. */
export function useGrapeVarieties(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["grape_varieties", vineyardId],
    enabled: !!vineyardId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GrapeVariety[]> => {
      const { data, error } = await supabase
        .from("grape_varieties")
        .select("id,name")
        .eq("vineyard_id", vineyardId);
      if (error) {
        console.warn("[grape_varieties] fetch failed:", error.message);
        return [];
      }
      return (data ?? []) as GrapeVariety[];
    },
  });
}

export type GrapeVarietyMap = {
  byId: Map<string, string>;
  byNameLower: Map<string, string>;
};

export function buildVarietyMap(varieties: GrapeVariety[] | undefined): GrapeVarietyMap {
  const byId = new Map<string, string>();
  const byNameLower = new Map<string, string>();
  for (const v of varieties ?? []) {
    if (v?.id && v?.name) byId.set(v.id, v.name);
    if (v?.name) byNameLower.set(normaliseName(v.name), v.name);
  }
  return { byId, byNameLower };
}

/** Resolve a single allocation against the variety map.
 *  Order: varietyId → builtin id → name snapshot → alias → vineyard name (CI). */
export function resolveAllocation(
  alloc: VarietyAllocationLike,
  map: GrapeVarietyMap,
): ResolvedAllocation {
  let name: string | null = null;
  let path: ResolverPath = "unresolved";

  const key = (alloc.varietyKey ?? alloc.variety_key ?? null) as string | null;
  const id = alloc.varietyId ?? alloc.variety_id ?? null;

  // 1. variety_key — built-in stable key (e.g. "pinot_gris")
  if (key && typeof key === "string") {
    const trimmedKey = key.trim();
    if (BUILTIN_BY_KEY.has(trimmedKey)) {
      name = BUILTIN_BY_KEY.get(trimmedKey)!;
      path = "varietyKey";
    } else {
      // Also accept normalised form (e.g. "Pinot Grigio" passed as a key).
      const fromKey = resolveBuiltinName(trimmedKey);
      if (fromKey) {
        name = fromKey;
        path = "varietyKey";
      }
    }
  }

  // 2. variety_id against vineyard grape_varieties
  if (!name && id && typeof id === "string" && map.byId.has(id)) {
    name = map.byId.get(id)!;
    path = "varietyId";
  }

  // 2b. Built-in match against the id itself (legacy rows where id is a name/key)
  if (!name && id && typeof id === "string") {
    const fromId = resolveBuiltinName(id);
    if (fromId) {
      name = fromId;
      path = "builtinId";
    }
  }

  // 3. Saved name snapshot (varietyName | variety_name | name | variety)
  const rawName =
    alloc.varietyName ?? alloc.variety_name ?? alloc.name ?? alloc.variety ?? null;
  const rawNameTrimmed = rawName != null ? String(rawName).trim() : "";

  if (!name && rawNameTrimmed) {
    // 3a. Snapshot resolves directly against vineyard varieties
    const vineyardHit = map.byNameLower.get(normaliseName(rawNameTrimmed));
    if (vineyardHit) {
      name = vineyardHit;
      path = "nameSnapshot";
    }
  }

  // 4. Alias / canonical match against built-in names
  if (!name && rawNameTrimmed) {
    const builtin = resolveBuiltinName(rawNameTrimmed);
    if (builtin) {
      name = builtin;
      path = "alias";
    }
  }

  // 5. Custom variety: a name exists but isn't in vineyard list or built-ins.
  //    Treat as a resolved CUSTOM variety — show the user's text, don't flag.
  if (!name && rawNameTrimmed) {
    name = rawNameTrimmed;
    path = "custom";
  }

  const resolved = path !== "unresolved";

  return {
    id: alloc.id,
    name: name || null,
    percent: typeof alloc.percent === "number" ? alloc.percent : null,
    clone: alloc.clone ?? null,
    rootstock: alloc.rootstock ?? null,
    plantingYear:
      typeof alloc.plantingYear === "number"
        ? alloc.plantingYear
        : typeof alloc.planting_year === "number"
        ? alloc.planting_year
        : null,
    raw: alloc,
    resolved,
    resolverPath: path,
  };
}

/** Resolve all allocations on a paddock (parses jsonb shape). */
export function resolvePaddockAllocations(
  paddockAllocations: any,
  map: GrapeVarietyMap,
): ResolvedAllocation[] {
  if (!Array.isArray(paddockAllocations)) return [];
  return paddockAllocations
    .filter((a) => a && typeof a === "object")
    .map((a) => resolveAllocation(a as VarietyAllocationLike, map));
}

/** Convenience: top variety name for a paddock (largest %, falling back to first).
 *  Returns null when there are no resolvable allocations. */
export function primaryVarietyName(
  paddockAllocations: any,
  map: GrapeVarietyMap,
): string | null {
  const list = resolvePaddockAllocations(paddockAllocations, map);
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const first = sorted.find((a) => a.resolved) ?? sorted[0];
  return first?.name ?? null;
}
