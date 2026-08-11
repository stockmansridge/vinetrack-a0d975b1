// Shared per-block pruning yield settings (sql/181_pruning_yield_settings.sql).
//
// Canonical table: public.pruning_yield_settings on the iOS/shared Supabase
// project. One live row per paddock (block); iOS, Android and the portal all
// read and write the same record. The portal stores ONLY the pruning input
// assumptions — never derived results (buds/vine, bunches/ha, kg/ha, t/ha,
// block total), which are always recalculated client-side from the saved
// inputs and the block's current area.
//
// Columns (verified against the live contract):
//   id, vineyard_id, paddock_id, prune_method, bunches_per_bud,
//   buds_per_spur, spurs_per_vine, buds_per_cane, canes_per_vine,
//   vines_per_ha, bunch_weight_grams,
//   created_at, updated_at, created_by, updated_by, deleted_at,
//   client_updated_at
//
// No schema, RLS or RPC changes are made from the portal — RLS remains the
// security boundary for who may read/write a vineyard's settings.
import { supabase } from "@/integrations/ios-supabase/client";
import type { PruneMethod } from "@/lib/pruningYieldFormula";

export const PRUNING_YIELD_SETTINGS_TABLE = "pruning_yield_settings";

export const PRUNING_YIELD_SETTINGS_COLUMNS =
  "id, vineyard_id, paddock_id, prune_method, bunches_per_bud, buds_per_spur, spurs_per_vine, buds_per_cane, canes_per_vine, vines_per_ha, bunch_weight_grams, created_at, updated_at, deleted_at";

export interface PruningYieldSettings {
  id?: string;
  vineyardId: string;
  paddockId: string;
  pruneMethod: PruneMethod;
  bunchesPerBud: number;
  budsPerSpur: number;
  spursPerVine: number;
  budsPerCane: number;
  canesPerVine: number;
  vinesPerHa: number;
  bunchWeightGrams: number;
  updatedAt?: string | null;
}

/** Canonical calculator defaults (shared with iOS/Android). */
export const PRUNING_YIELD_DEFAULTS = {
  pruneMethod: "spur" as PruneMethod,
  bunchesPerBud: 1.5,
  budsPerSpur: 2,
  spursPerVine: 6,
  budsPerCane: 10,
  canesPerVine: 4,
  vinesPerHa: 0,
  bunchWeightGrams: 120,
};

const num = (v: unknown, fallback: number) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

export function mapSettingsRow(row: any): PruningYieldSettings {
  return {
    id: row.id,
    vineyardId: row.vineyard_id,
    paddockId: row.paddock_id,
    pruneMethod: row.prune_method === "cane" ? "cane" : "spur",
    bunchesPerBud: num(row.bunches_per_bud, PRUNING_YIELD_DEFAULTS.bunchesPerBud),
    budsPerSpur: num(row.buds_per_spur, PRUNING_YIELD_DEFAULTS.budsPerSpur),
    spursPerVine: num(row.spurs_per_vine, PRUNING_YIELD_DEFAULTS.spursPerVine),
    budsPerCane: num(row.buds_per_cane, PRUNING_YIELD_DEFAULTS.budsPerCane),
    canesPerVine: num(row.canes_per_vine, PRUNING_YIELD_DEFAULTS.canesPerVine),
    vinesPerHa: num(row.vines_per_ha, PRUNING_YIELD_DEFAULTS.vinesPerHa),
    bunchWeightGrams: num(row.bunch_weight_grams, PRUNING_YIELD_DEFAULTS.bunchWeightGrams),
    updatedAt: row.updated_at ?? null,
  };
}

/** All live saved settings for a vineyard, keyed by paddock id. */
export async function fetchPruningYieldSettings(
  vineyardId: string,
): Promise<Record<string, PruningYieldSettings>> {
  const { data, error } = await (supabase as any)
    .from(PRUNING_YIELD_SETTINGS_TABLE)
    .select(PRUNING_YIELD_SETTINGS_COLUMNS)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  const out: Record<string, PruningYieldSettings> = {};
  for (const row of data ?? []) {
    const s = mapSettingsRow(row);
    out[s.paddockId] = s;
  }
  return out;
}

/**
 * Upsert the shared settings for one block. Only input assumptions are
 * written; derived results are never persisted.
 */
export async function savePruningYieldSettings(
  input: PruningYieldSettings,
): Promise<PruningYieldSettings> {
  if (!input.vineyardId || !input.paddockId) {
    throw new Error("A block must be selected before saving pruning settings.");
  }
  // Canonical write (docs/pruning-yield-settings-contract.md §"How to write"):
  // UPSERT on the block key `(vineyard_id, paddock_id)` with
  // resolution=merge-duplicates — never a plain insert, never keyed on `id`.
  // A client `id` is minted for the insert case; concurrent clients converge on
  // the first row and the returned representation is authoritative. The upsert
  // also resurrects a soft-deleted row for the block.
  const payload = {
    id: crypto.randomUUID(),
    vineyard_id: input.vineyardId,
    paddock_id: input.paddockId,
    prune_method: input.pruneMethod,
    bunches_per_bud: input.bunchesPerBud,
    buds_per_spur: input.budsPerSpur,
    spurs_per_vine: input.spursPerVine,
    buds_per_cane: input.budsPerCane,
    canes_per_vine: input.canesPerVine,
    // null clears the override so clients re-derive from the block config.
    vines_per_ha: input.vinesPerHa > 0 ? input.vinesPerHa : null,
    bunch_weight_grams: input.bunchWeightGrams,
    client_updated_at: new Date().toISOString(),
  };

  const { data, error } = await (supabase as any)
    .from(PRUNING_YIELD_SETTINGS_TABLE)
    .upsert(payload, { onConflict: "vineyard_id,paddock_id" })
    .select(PRUNING_YIELD_SETTINGS_COLUMNS)
    .single();
  if (error) throw error;
  return mapSettingsRow(data);
}


/** Canonical defaults for a block with no shared saved settings. */
export function defaultSettingsForBlock(
  vineyardId: string,
  block: { id: string; areaHa?: number | null; vineCount?: number | null } | null,
): PruningYieldSettings {
  const vinesPerHa =
    block?.vineCount && block?.areaHa && block.areaHa > 0
      ? Math.round(block.vineCount / block.areaHa)
      : PRUNING_YIELD_DEFAULTS.vinesPerHa;
  return {
    vineyardId,
    paddockId: block?.id ?? "",
    ...PRUNING_YIELD_DEFAULTS,
    vinesPerHa,
  };
}
