// Variety resolver — supports the canonical iOS shape (varietyId → grape_varieties.id)
// plus legacy/text fallbacks. Used anywhere we display a variety name from a
// paddock allocation (block detail, cost reports, yield reports, etc.).
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
  clone?: string | null;
  rootstock?: string | null;
  plantingYear?: number | null;
  planting_year?: number | null;
  percent?: number | null;
}

export interface ResolvedAllocation {
  id?: string;
  name: string | null;     // resolved display name, or null if unresolved
  percent: number | null;
  clone?: string | null;
  rootstock?: string | null;
  plantingYear?: number | null;
  raw: VarietyAllocationLike;
  resolved: boolean;
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
    if (v?.name) byNameLower.set(v.name.toLowerCase(), v.name);
  }
  return { byId, byNameLower };
}

/** Resolve a single allocation against the variety map.
 *  Order: varietyId → variety_id → variety (string) → name → case-insensitive name fallback. */
export function resolveAllocation(
  alloc: VarietyAllocationLike,
  map: GrapeVarietyMap,
): ResolvedAllocation {
  let name: string | null = null;
  const id = alloc.varietyId ?? alloc.variety_id ?? null;
  if (id && typeof id === "string" && map.byId.has(id)) {
    name = map.byId.get(id)!;
  }
  if (!name) {
    const raw = (alloc.variety ?? alloc.name ?? "").toString().trim();
    if (raw) {
      // Try case-insensitive resolve against grape_varieties first.
      const ci = map.byNameLower.get(raw.toLowerCase());
      name = ci ?? raw;
    }
  }
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
    resolved: !!name,
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
