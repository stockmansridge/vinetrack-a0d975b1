// Clone & rootstock catalogues (Rork-owned contract, sql/182).
//
// Read-only consumption of the shared backend:
//   get_grape_clone_catalog()                  → global built-in clones (per variety)
//   get_rootstock_catalog()                    → global built-in rootstocks
//   list_vineyard_grape_clones(p_vineyard_id)  → vineyard custom clones
//   list_vineyard_rootstocks(p_vineyard_id)    → vineyard custom rootstocks
//   upsert_vineyard_grape_clone(...)           → create custom clone (owner/manager)
//   upsert_vineyard_rootstock(...)             → create custom rootstock (owner/manager)
//   archive_vineyard_grape_clone(p_id) / archive_vineyard_rootstock(p_id)
//
// The portal NEVER writes these tables directly and never invents catalogue
// rows for the sentinels below.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

/** Allocation-level sentinels — deliberately NOT catalogue rows. */
export const CLONE_MASS_SELECTION_KEY = "mass_selection";
export const CLONE_MASS_SELECTION_LABEL = "Mass selection";
export const ROOTSTOCK_OWN_ROOTS_KEY = "own_roots";
export const ROOTSTOCK_OWN_ROOTS_LABEL = "Own roots";

export interface CatalogClone {
  /** Stable identity: `shiraz:pt23` or `custom:<vid>:<variety>:<slug>`. */
  key: string;
  variety_key: string;
  display_name: string;
  clone_code?: string | null;
  selection_system?: string | null;
  source_country?: string | null;
  aliases: string[];
  is_custom: boolean;
  is_active: boolean;
  /** Row id — only present on vineyard custom rows (needed to archive). */
  id?: string | null;
}

export interface CatalogRootstock {
  key: string;
  display_name: string;
  canonical_name?: string | null;
  parentage?: string | null;
  aliases: string[];
  is_custom: boolean;
  is_active: boolean;
  id?: string | null;
}

function toAliases(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function bool(v: any, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function normaliseCloneRow(r: any, custom: boolean): CatalogClone | null {
  if (!r || typeof r !== "object") return null;
  const key = r.key ?? r.clone_key ?? r.cloneKey ?? null;
  const varietyKey = r.variety_key ?? r.varietyKey ?? null;
  const displayName = r.display_name ?? r.displayName ?? r.name ?? null;
  if (!key || !varietyKey || !displayName) return null;
  return {
    key: String(key),
    variety_key: String(varietyKey),
    display_name: String(displayName),
    clone_code: r.clone_code ?? r.cloneCode ?? null,
    selection_system: r.selection_system ?? r.selectionSystem ?? null,
    source_country: r.source_country ?? r.sourceCountry ?? null,
    aliases: toAliases(r.aliases),
    is_custom: bool(r.is_custom ?? r.isCustom, custom),
    is_active: bool(r.is_active ?? r.isActive, true),
    id: r.id ?? null,
  };
}

export function normaliseRootstockRow(r: any, custom: boolean): CatalogRootstock | null {
  if (!r || typeof r !== "object") return null;
  const key = r.key ?? r.rootstock_key ?? r.rootstockKey ?? null;
  const displayName = r.display_name ?? r.displayName ?? r.canonical_name ?? r.name ?? null;
  if (!key || !displayName) return null;
  return {
    key: String(key),
    display_name: String(displayName),
    canonical_name: r.canonical_name ?? r.canonicalName ?? null,
    parentage: r.parentage ?? null,
    aliases: toAliases(r.aliases),
    is_custom: bool(r.is_custom ?? r.isCustom, custom),
    is_active: bool(r.is_active ?? r.isActive, true),
    id: r.id ?? null,
  };
}

/** Built-in clone catalogue (global, variety-scoped rows). */
export function useCloneCatalog() {
  return useQuery({
    queryKey: ["grape_clone_catalog"],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async (): Promise<CatalogClone[]> => {
      const { data, error } = await supabase.rpc("get_grape_clone_catalog" as any);
      if (error) {
        console.warn("[get_grape_clone_catalog] failed:", error.message);
        return [];
      }
      return ((data as any[]) ?? [])
        .map((r) => normaliseCloneRow(r, false))
        .filter(Boolean) as CatalogClone[];
    },
  });
}

/** Vineyard custom clones (includes archived — filter on is_active for pickers). */
export function useVineyardClones(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["vineyard_grape_clones", vineyardId],
    enabled: !!vineyardId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<CatalogClone[]> => {
      const { data, error } = await supabase.rpc("list_vineyard_grape_clones" as any, {
        p_vineyard_id: vineyardId,
      });
      if (error) {
        console.warn("[list_vineyard_grape_clones] failed:", error.message);
        return [];
      }
      return ((data as any[]) ?? [])
        .map((r) => normaliseCloneRow(r, true))
        .filter(Boolean) as CatalogClone[];
    },
  });
}

/** Built-in rootstock catalogue (global — never filtered by variety). */
export function useRootstockCatalog() {
  return useQuery({
    queryKey: ["rootstock_catalog"],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async (): Promise<CatalogRootstock[]> => {
      const { data, error } = await supabase.rpc("get_rootstock_catalog" as any);
      if (error) {
        console.warn("[get_rootstock_catalog] failed:", error.message);
        return [];
      }
      return ((data as any[]) ?? [])
        .map((r) => normaliseRootstockRow(r, false))
        .filter(Boolean) as CatalogRootstock[];
    },
  });
}

export function useVineyardRootstocks(vineyardId: string | null | undefined) {
  return useQuery({
    queryKey: ["vineyard_rootstocks", vineyardId],
    enabled: !!vineyardId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<CatalogRootstock[]> => {
      const { data, error } = await supabase.rpc("list_vineyard_rootstocks" as any, {
        p_vineyard_id: vineyardId,
      });
      if (error) {
        console.warn("[list_vineyard_rootstocks] failed:", error.message);
        return [];
      }
      return ((data as any[]) ?? [])
        .map((r) => normaliseRootstockRow(r, true))
        .filter(Boolean) as CatalogRootstock[];
    },
  });
}

/** Create (or reactivate) a vineyard custom clone. Backend validates the parent
 *  variety, rejects reserved names, and returns the stable custom key. */
export function useUpsertVineyardClone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      vineyardId: string;
      varietyKey: string;
      displayName: string;
      isActive?: boolean;
    }): Promise<CatalogClone | null> => {
      const { data, error } = await supabase.rpc("upsert_vineyard_grape_clone" as any, {
        p_vineyard_id: input.vineyardId,
        p_variety_key: input.varietyKey,
        p_display_name: input.displayName,
        p_is_active: input.isActive ?? true,
      });
      if (error) throw error;
      return normaliseCloneRow(Array.isArray(data) ? data[0] : data, true);
    },
    onSuccess: (_row, vars) => {
      qc.invalidateQueries({ queryKey: ["vineyard_grape_clones", vars.vineyardId] });
    },
  });
}

export function useUpsertVineyardRootstock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      vineyardId: string;
      displayName: string;
      isActive?: boolean;
    }): Promise<CatalogRootstock | null> => {
      const { data, error } = await supabase.rpc("upsert_vineyard_rootstock" as any, {
        p_vineyard_id: input.vineyardId,
        p_display_name: input.displayName,
        p_is_active: input.isActive ?? true,
      });
      if (error) throw error;
      return normaliseRootstockRow(Array.isArray(data) ? data[0] : data, true);
    },
    onSuccess: (_row, vars) => {
      qc.invalidateQueries({ queryKey: ["vineyard_rootstocks", vars.vineyardId] });
    },
  });
}

export function useArchiveVineyardClone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("archive_vineyard_grape_clone" as any, { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vineyard_grape_clones"] }),
  });
}

export function useArchiveVineyardRootstock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("archive_vineyard_rootstock" as any, { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vineyard_rootstocks"] }),
  });
}

/** Clones available for one allocation's variety. Built-ins first, then the
 *  vineyard's active custom clones for the SAME variety key. */
export function clonesForVariety(
  builtIns: CatalogClone[],
  customs: CatalogClone[],
  varietyKey: string | null | undefined,
): CatalogClone[] {
  if (!varietyKey) return [];
  const mine = (rows: CatalogClone[]) =>
    rows.filter((c) => c.variety_key === varietyKey && c.is_active);
  return [...mine(builtIns), ...mine(customs)];
}

/** Rootstocks are variety-independent — the full catalogue is always offered. */
export function rootstockOptions(
  builtIns: CatalogRootstock[],
  customs: CatalogRootstock[],
): CatalogRootstock[] {
  return [...builtIns.filter((r) => r.is_active), ...customs.filter((r) => r.is_active)];
}

/** Search helper: clone matches display name, clone code, selection system and aliases. */
export function cloneMatches(c: CatalogClone, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.display_name, c.clone_code, c.selection_system, c.source_country, ...c.aliases]
    .filter(Boolean)
    .some((f) => String(f).toLowerCase().includes(q));
}

export function rootstockMatches(r: CatalogRootstock, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [r.display_name, r.canonical_name, r.parentage, ...r.aliases]
    .filter(Boolean)
    .some((f) => String(f).toLowerCase().includes(q));
}

/** Secondary line for a clone row — selection system / code / country. */
export function cloneSubtitle(c: CatalogClone): string {
  return [c.clone_code, c.selection_system, c.source_country].filter(Boolean).join(" · ");
}

/** True when the allocation carries legacy free text that is not a catalogue
 *  identity or sentinel — such text must be preserved verbatim. */
export function isLegacyFreeText(
  key: string | null | undefined,
  display: string | null | undefined,
): boolean {
  return !key && !!display && display.trim().length > 0;
}
