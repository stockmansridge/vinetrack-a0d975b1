// Detailed Picking Log — shared VineTrack contract (sql/180 + sql/184).
//
// The portal CONSUMES the canonical contract already implemented by iOS and
// Android. No portal-specific structures, no schema/RLS/RPC changes.
//
//   Table  public.picking_records                (soft delete via deleted_at)
//   View   public.picking_yield_totals           (block + variety aggregation)
//   View   public.picking_yield_planting_totals  (planting-group aggregation)
//   RPC    soft_delete_picking_record(p_id uuid)
//
// sql/184 adds the planting-group identity to picking_records:
//   planting_group_key      text     — deterministic block-scoped group key
//   variety_allocation_ids  uuid[]   — member sections at time of recording
//   rootstock               text     — historical display snapshot
//
// Server-authoritative columns that the portal MUST NOT write:
//   vintage (BEFORE trigger from picked_at), grape_value (generated column),
//   created_at / updated_at / updated_by / sync_version.
import { supabase } from "@/integrations/ios-supabase/client";


export type SugarUnitValue = "brix" | "baume";

export interface PickingRecord {
  id: string;
  vineyard_id: string;
  picked_at: string;
  /** Server-derived (season-end year). Read-only for the portal. */
  vintage: number | null;
  paddock_id: string;
  paddock_name: string | null;
  variety_id: string | null;
  variety_key: string | null;
  variety_name: string | null;
  clone: string | null;
  /**
   * Authoritative planting identity (sql/184) — the deterministic, block-scoped
   * planting-group key: `variety|cloneKey|rootstockKey`, lower-cased/trimmed.
   * Nullable: legacy picks stay "Planting not linked" until explicitly assigned.
   */
  planting_group_key: string | null;
  /** Member `variety_allocations[].id` sections at the time of recording (audit). */
  variety_allocation_ids: string[] | null;
  /** Historical rootstock display snapshot. */
  rootstock: string | null;

  weight_kg: number;
  sugar_value: number | null;
  sugar_unit: SugarUnitValue | null;
  ph: number | null;
  ta_g_l: number | null;
  purpose: string | null;
  sold: boolean | null;
  sold_to: string | null;
  price_per_tonne: number | null;
  /** Server-generated: (weight_kg / 1000) * price_per_tonne when sold. */
  grape_value: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
}

export interface PickingYieldTotal {
  vineyard_id: string;
  vintage: number | null;
  paddock_id: string;
  paddock_name: string | null;
  variety_name: string | null;
  pick_count: number | null;
  total_weight_kg: number | null;
  actual_yield_tonnes: number | null;
  first_picked_at: string | null;
  last_picked_at: string | null;
  total_grape_value: number | null;
}

/**
 * `public.picking_yield_planting_totals` (sql/184) — the same aggregation as
 * `picking_yield_totals` with the planting-group dimension added, so
 * allocation/group-level actuals are server-computed rather than re-derived.
 */
export interface PickingYieldPlantingTotal extends PickingYieldTotal {
  planting_group_key: string | null;
  clone: string | null;
  rootstock: string | null;
}

export async function fetchPickingRecords(vineyardId: string): Promise<PickingRecord[]> {
  const { data, error } = await (supabase as any)
    .from("picking_records")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("picked_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PickingRecord[];
}

export async function fetchPickingYieldTotals(vineyardId: string): Promise<PickingYieldTotal[]> {
  const { data, error } = await (supabase as any)
    .from("picking_yield_totals")
    .select("*")
    .eq("vineyard_id", vineyardId);
  if (error) throw error;
  return (data ?? []) as PickingYieldTotal[];
}

/** Planting-group level totals (block + variety + clone + rootstock). */
export async function fetchPickingPlantingTotals(
  vineyardId: string,
): Promise<PickingYieldPlantingTotal[]> {
  const { data, error } = await (supabase as any)
    .from("picking_yield_planting_totals")
    .select("*")
    .eq("vineyard_id", vineyardId);
  if (error) throw error;
  return (data ?? []) as PickingYieldPlantingTotal[];
}

export interface CreatePickingRecordInput {
  vineyardId: string;
  /** yyyy-MM-dd (local calendar day, as iOS/Android encode it). */
  pickedAt: string;
  paddockId: string;
  paddockName: string;
  varietyId?: string | null;
  varietyKey?: string | null;
  varietyName?: string | null;
  clone?: string | null;
  /** Deterministic planting-group key for the selected planting (sql/184). */
  plantingGroupKey?: string | null;
  /** Member `variety_allocations[].id` sections behind the selected group. */
  varietyAllocationIds?: string[] | null;
  /** Rootstock display snapshot for the selected planting. */
  rootstock?: string | null;
  weightKg: number;
  sugarValue?: number | null;
  sugarUnit?: SugarUnitValue | null;
  ph?: number | null;
  taGL?: number | null;
  purpose?: string | null;
  sold?: boolean;
  soldTo?: string | null;
  pricePerTonne?: number | null;
  notes?: string | null;
}

/**
 * Planting identity written on every create/update. sql/184 is deployed, so
 * these columns are part of the canonical contract — a write that the backend
 * rejects is a real error and is surfaced instead of being silently retried
 * without the planting fields.
 */
function plantingFields(input: {
  plantingGroupKey?: string | null;
  varietyAllocationIds?: string[] | null;
  rootstock?: string | null;
}) {
  const ids = (input.varietyAllocationIds ?? []).filter((id) => !!id && id.trim().length > 0);
  return {
    planting_group_key: input.plantingGroupKey?.trim() || null,
    variety_allocation_ids: ids.length ? ids : null,
    rootstock: input.rootstock?.trim() || null,
  };
}

async function writePickingRecord(
  run: () => Promise<{ data: any; error: any }>,
  /** SQL 185: re-read used when the write returns an EMPTY representation. */
  onEmpty?: () => Promise<PickingRecord>,
): Promise<PickingRecord> {
  const { data, error } = await run();
  if (error) throw error;
  if (!data) {
    // Stale write: a newer client_updated_at already won. Never retry —
    // surface the authoritative server row instead.
    if (onEmpty) return onEmpty();
    throw new Error("This pick was updated on another device. Reload and try again.");
  }
  return data as PickingRecord;
}

/** Read one pick by id (used to resolve stale-write responses). */
async function readPickingRecord(id: string): Promise<PickingRecord> {
  const { data, error } = await (supabase as any)
    .from("picking_records")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This pick is no longer available.");
  return data as PickingRecord;
}



/**
 * Insert one pick. Every save is a NEW row — a Block + Variety + Vintage may
 * have many picks, and matching combinations must never overwrite each other.
 */
export async function createPickingRecord(
  input: CreatePickingRecordInput,
): Promise<PickingRecord> {
  if (!input.pickedAt) throw new Error("A pick date is required");
  if (!input.paddockId) throw new Error("A block is required");
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    throw new Error("Weight must be greater than zero");
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const sold = !!input.sold;
  const sugarValue =
    input.sugarValue != null && Number.isFinite(input.sugarValue) ? input.sugarValue : null;

  // NOTE: `vintage` and `grape_value` are deliberately absent — the server
  // derives/generates them and the write fails if they are sent.
  const row = {
    vineyard_id: input.vineyardId,
    picked_at: input.pickedAt,
    paddock_id: input.paddockId,
    paddock_name: (input.paddockName ?? "").trim(),
    variety_id: input.varietyId ?? null,
    variety_key: input.varietyKey ?? null,
    variety_name: (input.varietyName ?? "").trim(),
    clone: input.clone?.trim() || null,
    // Planting-group identity + historical snapshots (sql/184).
    ...plantingFields(input),

    weight_kg: input.weightKg,
    sugar_value: sugarValue,
    // The unit is always stored with the value so history is never reinterpreted.
    sugar_unit: sugarValue == null ? null : input.sugarUnit ?? null,
    ph: input.ph ?? null,
    ta_g_l: input.taGL ?? null,
    purpose: (input.purpose ?? "").trim(),
    sold,
    sold_to: sold ? input.soldTo?.trim() || null : null,
    price_per_tonne: sold ? input.pricePerTonne ?? null : null,
    notes: (input.notes ?? "").trim(),
    created_by: userId,
    client_updated_at: new Date().toISOString(),
  };

  return writePickingRecord(() =>
    (supabase as any).from("picking_records").insert(row).select("*").single(),
  );

}


export interface UpdatePickingRecordInput extends Omit<CreatePickingRecordInput, "vineyardId"> {
  id: string;
}

/**
 * Update ONE existing pick in place (same row id — never an insert).
 *
 * Server-owned columns are deliberately never written: `vintage` is re-derived
 * by the BEFORE trigger from the new `picked_at`, `grape_value` is a generated
 * column recomputed from weight_kg / price_per_tonne, and
 * updated_at / updated_by / sync_version are maintained by the backend.
 * RLS on picking_records remains the authority for who may write.
 */
export async function updatePickingRecord(
  input: UpdatePickingRecordInput,
): Promise<PickingRecord> {
  if (!input.id) throw new Error("A picking record is required");
  if (!input.pickedAt) throw new Error("A pick date is required");
  if (!input.paddockId) throw new Error("A block is required");
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    throw new Error("Weight must be greater than zero");
  }

  // Sale fields follow the same rules as creating a sold pick.
  const sold = !!input.sold;
  const sugarValue =
    input.sugarValue != null && Number.isFinite(input.sugarValue) ? input.sugarValue : null;

  const patch = {
    picked_at: input.pickedAt,
    paddock_id: input.paddockId,
    paddock_name: (input.paddockName ?? "").trim(),
    variety_id: input.varietyId ?? null,
    variety_key: input.varietyKey ?? null,
    variety_name: (input.varietyName ?? "").trim(),
    clone: input.clone?.trim() || null,
    // Editing may (re)assign the exact planting group — the group key and its
    // member allocation ids are written, not just the clone display text.
    ...plantingFields(input),

    weight_kg: input.weightKg,
    sugar_value: sugarValue,
    sugar_unit: sugarValue == null ? null : input.sugarUnit ?? null,
    ph: input.ph ?? null,
    ta_g_l: input.taGL ?? null,
    purpose: (input.purpose ?? "").trim(),
    sold,
    // Switching a sold pick back to internal use clears the sale fields so no
    // stale buyer or price stays attached to retained fruit.
    sold_to: sold ? input.soldTo?.trim() || null : null,
    price_per_tonne: sold ? input.pricePerTonne ?? null : null,
    notes: (input.notes ?? "").trim(),
    client_updated_at: new Date().toISOString(),
  };

  return writePickingRecord(
    () =>
      (supabase as any)
        .from("picking_records")
        .update(patch)
        .eq("id", input.id)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle(),
    () => readPickingRecord(input.id),
  );

}




/** Soft delete only — hard deletes are blocked by RLS for every client. */
export async function softDeletePickingRecord(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc("soft_delete_picking_record", { p_id: id });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Precedence: detailed picking totals SUPERSEDE Basic actual yield for the
// same Block + Variety + Vintage. They are never added together.
// ---------------------------------------------------------------------------

export interface ActualYieldEntry {
  blockId: string | null;
  blockName?: string | null;
  variety: string | null;
  /** Clone display snapshot stored on the pick (planting identity hint). */
  clone?: string | null;
  /** Rootstock display snapshot. */
  rootstock?: string | null;
  /** Authoritative planting identity (sql/184) when the pick is linked. */
  plantingGroupKey?: string | null;
  /** Member allocation sections recorded with the pick (audit only). */
  varietyAllocationIds?: string[] | null;
  vintage: number | null;
  tonnes: number | null;
  areaHa?: number | null;
  source?: "basic" | "detailed";
  /** Number of individual picks behind a detailed entry. */
  pickCount?: number | null;
}

/**
 * Detailed picks aggregated per planting.
 *
 * `planting_group_key` is the authoritative identity when present; the
 * clone/rootstock snapshots are only the legacy fallback so historical picks
 * are still split rather than collapsed onto one same-variety planting.
 */
export function aggregatePickingRecordsByPlanting(
  records: PickingRecord[],
): ActualYieldEntry[] {
  const byKey = new Map<string, ActualYieldEntry>();
  for (const r of records) {
    if (!r.paddock_id || !Number.isFinite(Number(r.weight_kg))) continue;
    const clone = r.clone?.trim() || null;
    const rootstock = r.rootstock?.trim() || null;
    const groupKey = r.planting_group_key?.trim() || null;
    const identity = groupKey ? `group:${norm(groupKey)}` : `${norm(clone)}|${norm(rootstock)}`;
    const k = `${pickingKey(r.paddock_id, r.variety_name, r.vintage)}|${identity}`;
    const tonnes = Number(r.weight_kg) / 1000;
    const cur = byKey.get(k);
    if (cur) {
      cur.tonnes = (cur.tonnes ?? 0) + tonnes;
      cur.pickCount = (cur.pickCount ?? 0) + 1;
    } else {
      byKey.set(k, {
        blockId: r.paddock_id,
        blockName: r.paddock_name ?? null,
        variety: r.variety_name?.trim() || null,
        clone,
        rootstock,
        plantingGroupKey: groupKey,
        varietyAllocationIds: r.variety_allocation_ids ?? null,
        vintage: r.vintage ?? null,
        tonnes,
        source: "detailed",
        pickCount: 1,
      });
    }
  }

  return Array.from(byKey.values());
}



const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export function pickingKey(
  blockId: string | null | undefined,
  variety: string | null | undefined,
  vintage: number | null | undefined,
): string {
  return `${norm(blockId)}|${norm(variety)}|${vintage ?? ""}`;
}

/** Detailed entries derived from the server aggregation view. */
export function detailedActualsFromTotals(totals: PickingYieldTotal[]): ActualYieldEntry[] {
  return totals
    .filter((t) => t.paddock_id)
    .map((t) => ({
      blockId: t.paddock_id,
      blockName: t.paddock_name ?? null,
      variety: t.variety_name?.trim() || null,
      vintage: t.vintage ?? null,
      tonnes:
        t.actual_yield_tonnes != null
          ? Number(t.actual_yield_tonnes)
          : t.total_weight_kg != null
          ? Number(t.total_weight_kg) / 1000
          : null,
      source: "detailed" as const,
      pickCount: t.pick_count != null ? Number(t.pick_count) : null,
    }));
}

/**
 * Planting-group level detailed entries from `picking_yield_planting_totals`.
 * Block + variety totals are unchanged — this view only adds the planting
 * dimension so allocation-level actuals are server-computed.
 */
export function detailedActualsFromPlantingTotals(
  totals: PickingYieldPlantingTotal[],
): ActualYieldEntry[] {
  return totals
    .filter((t) => t.paddock_id)
    .map((t) => ({
      blockId: t.paddock_id,
      blockName: t.paddock_name ?? null,
      variety: t.variety_name?.trim() || null,
      clone: t.clone?.trim() || null,
      rootstock: t.rootstock?.trim() || null,
      plantingGroupKey: t.planting_group_key?.trim() || null,
      vintage: t.vintage ?? null,
      tonnes:
        t.actual_yield_tonnes != null
          ? Number(t.actual_yield_tonnes)
          : t.total_weight_kg != null
          ? Number(t.total_weight_kg) / 1000
          : null,
      source: "detailed" as const,
      pickCount: t.pick_count != null ? Number(t.pick_count) : null,
    }));
}



/** Client-side fallback aggregation with the identical contract rule. */
export function aggregatePickingRecords(records: PickingRecord[]): ActualYieldEntry[] {
  const byKey = new Map<string, ActualYieldEntry>();
  for (const r of records) {
    if (!r.paddock_id || !Number.isFinite(Number(r.weight_kg))) continue;
    const k = pickingKey(r.paddock_id, r.variety_name, r.vintage);
    const cur = byKey.get(k);
    const tonnes = Number(r.weight_kg) / 1000;
    if (cur) {
      cur.tonnes = (cur.tonnes ?? 0) + tonnes;
      cur.pickCount = (cur.pickCount ?? 0) + 1;
    }
    else
      byKey.set(k, {
        blockId: r.paddock_id,
        blockName: r.paddock_name ?? null,
        variety: r.variety_name?.trim() || null,
        vintage: r.vintage ?? null,
        tonnes,
        source: "detailed",
        pickCount: 1,
      });
  }
  return Array.from(byKey.values());
}

/**
 * Canonical precedence merge. Basic entries are dropped when detailed picks
 * exist for the same Block + Variety + Vintage; a variety-less Basic entry is
 * dropped when ANY detailed pick exists for that Block + Vintage (it would
 * otherwise double count the same fruit).
 */
export function supersedeActualYield(
  basic: ActualYieldEntry[],
  detailed: ActualYieldEntry[],
): ActualYieldEntry[] {
  const exact = new Set(detailed.map((d) => pickingKey(d.blockId, d.variety, d.vintage)));
  const blockVintage = new Set(detailed.map((d) => `${norm(d.blockId)}|${d.vintage ?? ""}`));
  const keptBasic = basic.filter((b) => {
    if (exact.has(pickingKey(b.blockId, b.variety, b.vintage))) return false;
    if (!norm(b.variety) && blockVintage.has(`${norm(b.blockId)}|${b.vintage ?? ""}`)) return false;
    return true;
  });
  return [
    ...keptBasic.map((b) => ({ ...b, source: b.source ?? ("basic" as const) })),
    ...detailed.map((d) => ({ ...d, source: "detailed" as const })),
  ];
}
