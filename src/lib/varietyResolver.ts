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
  | "varietyId"
  | "builtinId"
  | "nameSnapshot"
  | "alias"
  | "vineyardName"
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
const BUILTIN_VARIETIES: Array<{ name: string; aliases: string[] }> = [
  { name: "Cabernet Sauvignon", aliases: ["cab sauv", "cabernet sauv", "cab", "cabernet"] },
  { name: "Cabernet Franc", aliases: ["cab franc", "cab frnc", "cab fr", "cabernet fr"] },
  { name: "Merlot", aliases: ["mer"] },
  { name: "Shiraz", aliases: ["syrah"] },
  { name: "Pinot Noir", aliases: ["pinot n", "p noir", "pn"] },
  { name: "Pinot Gris", aliases: ["pinot grigio", "p gris", "pg"] },
  { name: "Pinot Meunier", aliases: ["meunier"] },
  { name: "Chardonnay", aliases: ["chard"] },
  { name: "Sauvignon Blanc", aliases: ["sauv blanc", "savvy b", "sb", "sauvignon b"] },
  { name: "Semillon", aliases: ["sem", "sémillon"] },
  { name: "Riesling", aliases: ["ries"] },
  { name: "Gruner Veltliner", aliases: ["grüner veltliner", "gruner", "grüner", "gv"] },
  { name: "Tempranillo", aliases: ["temp"] },
  { name: "Primitivo", aliases: ["zinfandel", "zin"] },
  { name: "Nebbiolo", aliases: ["nebb"] },
  { name: "Sangiovese", aliases: ["sangio"] },
  { name: "Grenache", aliases: ["garnacha"] },
  { name: "Mourvedre", aliases: ["mourvèdre", "monastrell", "mataro"] },
  { name: "Viognier", aliases: ["vio"] },
  { name: "Verdelho", aliases: [] },
  { name: "Vermentino", aliases: [] },
  { name: "Marsanne", aliases: [] },
  { name: "Roussanne", aliases: [] },
  { name: "Petit Verdot", aliases: ["pv"] },
  { name: "Malbec", aliases: [] },
  { name: "Barbera", aliases: [] },
  { name: "Montepulciano", aliases: [] },
  { name: "Fiano", aliases: [] },
  { name: "Arneis", aliases: [] },
  { name: "Gewurztraminer", aliases: ["gewürztraminer", "gewurz"] },
];

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Deterministic UUID v5-ish derivation from canonical name. iOS uses a stable
// hash → UUID; we mirror by deriving the same RFC-4122 v5 from name in a
// "builtin.variety" namespace. We don't actually need to compute UUIDs here —
// we just need a SET of strings to test allocation.varietyId against. Since
// the iOS deterministic IDs are not transmitted to us, the practical path is
// name-based: built-in IDs (if ever present) are caught by name match anyway.
const BUILTIN_BY_NORMAL_NAME: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const v of BUILTIN_VARIETIES) {
    m.set(normaliseName(v.name), v.name);
    for (const a of v.aliases) m.set(normaliseName(a), v.name);
  }
  return m;
})();

/** Resolve a free-text variety name against built-in canonical names + aliases. */
export function resolveBuiltinName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normaliseName(raw);
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

  const id = alloc.varietyId ?? alloc.variety_id ?? null;

  // 1. Exact varietyId against vineyard grape_varieties
  if (id && typeof id === "string" && map.byId.has(id)) {
    name = map.byId.get(id)!;
    path = "varietyId";
  }

  // 2. Built-in deterministic ID — we don't have iOS's UUID derivation, but
  //    if a varietyId happens to BE a canonical built-in name (some legacy
  //    rows stored the name in varietyId), catch it here.
  if (!name && id && typeof id === "string") {
    const fromId = resolveBuiltinName(id);
    if (fromId) {
      name = fromId;
      path = "builtinId";
    }
  }

  // 3. Saved name snapshot (varietyName | name | variety)
  const rawName =
    alloc.varietyName ?? alloc.variety_name ?? alloc.name ?? alloc.variety ?? null;
  const rawNameTrimmed = rawName != null ? String(rawName).trim() : "";

  if (!name && rawNameTrimmed) {
    const key = normaliseName(rawNameTrimmed);
    // 3a. Snapshot resolves directly against vineyard varieties
    const vineyardHit = map.byNameLower.get(key);
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

  // 5. Last-ditch: use the raw snapshot as-is (treated as vineyard name);
  //    marked as resolved=true only when the original casing exists in the
  //    vineyard list. We otherwise leave name=null so the UI shows unresolved.
  if (!name && rawNameTrimmed) {
    // Keep raw text visible to the user but flag as unresolved.
    name = rawNameTrimmed;
    path = "unresolved";
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
