// Shared grape variety catalogue (Supabase RPCs).
//
// Source of truth is now Supabase:
//   - get_grape_variety_catalog()             → global built-ins
//   - list_vineyard_grape_varieties(p_vineyard_id) → vineyard-active list (built-ins + custom)
//   - upsert_vineyard_grape_variety(...)      → create / activate (server returns stable key)
//   - archive_vineyard_grape_variety(p_id)    → soft-delete from vineyard list
//
// The local resolver still ships an alias map (varietyResolver.ts) as a
// FALLBACK only — used when the catalogue RPC is unreachable or the
// allocation snapshot uses an old/free-text name.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

export interface CatalogVariety {
  /** Optional row id when present (vineyard list); built-in catalogue may omit. */
  id?: string | null;
  /** Stable key — e.g. "pinot_gris" for built-ins, "custom:<vid>:<slug>" for custom. */
  variety_key: string;
  /** Display name shown in pickers/snapshots. */
  display_name: string;
  /** Optional vineyard scoping (only on list_vineyard_grape_varieties results). */
  vineyard_id?: string | null;
  is_custom?: boolean | null;
  archived_at?: string | null;
  /** Anything else the server returns — kept for forward-compat. */
  [k: string]: any;
}

/** Normalise rpc rows into CatalogVariety, tolerating minor field differences. */
function normaliseRow(r: any): CatalogVariety | null {
  if (!r || typeof r !== "object") return null;
  const variety_key =
    r.variety_key ?? r.varietyKey ?? r.key ?? r.id ?? null;
  const display_name =
    r.display_name ?? r.displayName ?? r.name ?? r.label ?? null;
  if (!variety_key || !display_name) return null;
  return {
    id: r.id ?? null,
    variety_key: String(variety_key),
    display_name: String(display_name),
    vineyard_id: r.vineyard_id ?? r.vineyardId ?? null,
    is_custom: r.is_custom ?? r.isCustom ?? null,
    archived_at: r.archived_at ?? r.archivedAt ?? null,
    ...r,
  };
}

/** Global built-in catalogue (vineyard-independent). Cached for the session. */
export function useGrapeVarietyCatalog() {
  return useQuery({
    queryKey: ["grape_variety_catalog"],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async (): Promise<CatalogVariety[]> => {
      const { data, error } = await supabase.rpc("get_grape_variety_catalog");
      if (error) {
        console.warn("[get_grape_variety_catalog] failed:", error.message);
        return [];
      }
      return ((data as any[]) ?? []).map(normaliseRow).filter(Boolean) as CatalogVariety[];
    },
  });
}

/** Vineyard-active list (built-ins added + custom). */
export function useVineyardGrapeVarieties(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["vineyard_grape_varieties", vineyardId],
    enabled: !!vineyardId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CatalogVariety[]> => {
      const { data, error } = await supabase.rpc("list_vineyard_grape_varieties", {
        p_vineyard_id: vineyardId,
      });
      if (error) {
        console.warn("[list_vineyard_grape_varieties] failed:", error.message);
        return [];
      }
      return ((data as any[]) ?? []).map(normaliseRow).filter(Boolean) as CatalogVariety[];
    },
  });
}

/** Upsert a vineyard variety. Pass `variety_key = null` to create a CUSTOM variety —
 *  the server returns the stable `custom:<vineyard_id>:<slug>` key. */
export function useUpsertVineyardGrapeVariety() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      vineyardId: string;
      varietyKey?: string | null;
      displayName: string;
    }): Promise<CatalogVariety | null> => {
      const { data, error } = await supabase.rpc("upsert_vineyard_grape_variety", {
        p_vineyard_id: input.vineyardId,
        p_variety_key: input.varietyKey ?? null,
        p_display_name: input.displayName,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return normaliseRow(row);
    },
    onSuccess: (_row, vars) => {
      qc.invalidateQueries({ queryKey: ["vineyard_grape_varieties", vars.vineyardId] });
    },
  });
}

export function useArchiveVineyardGrapeVariety() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("archive_vineyard_grape_variety", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vineyard_grape_varieties"] });
    },
  });
}

/** Build the allocation snapshot Lovable should write to paddocks.variety_allocations.
 *  Always includes both varietyKey and a name snapshot so the resolver never has to guess. */
export function buildAllocationSnapshot(
  variety: Pick<CatalogVariety, "variety_key" | "display_name">,
  percent: number,
): { varietyKey: string; name: string; percent: number } {
  return {
    varietyKey: variety.variety_key,
    name: variety.display_name,
    percent,
  };
}
