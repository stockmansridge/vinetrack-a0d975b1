// Query + write helpers for the shared fertiliser_records +
// fertiliser_record_allocations tables (SQL 110, corrected by SQL 111).
//
// - product_id references saved_chemicals(id) — no separate product table.
// - Writes go via ordinary inserts under the vineyard's RLS; owner/manager/
//   supervisor/operator may insert or update.
// - Soft delete is enforced via the shared RPC soft_delete_fertiliser_record
//   (owner/manager/supervisor only). Hard delete is blocked in the database.
// - All writes are keyed on stable client-generated UUIDs so retries are
//   idempotent (allocations use `upsert(onConflict:"id")`).
import { supabase } from "@/integrations/ios-supabase/client";
import type {
  FertiliserCalculationMode,
  FertiliserForm,
  FertiliserRecordStatus,
} from "@/lib/fertiliserCalc";

export interface FertiliserRecord {
  id: string;
  vineyard_id: string;
  product_id: string | null;
  product_name: string;
  form: FertiliserForm | string;
  calculation_mode: FertiliserCalculationMode | string;
  record_status: FertiliserRecordStatus | string;
  application_date: string;
  block_names: string[];
  total_area_ha: number;
  total_vines: number;
  application_rate: number;
  application_rate_unit: string;
  total_product_required: number;
  product_unit: string;
  pack_size: number | null;
  pack_count: number | null;
  estimated_product_cost: number | null;
  labour_cost: number | null;
  machinery_cost: number | null;
  total_job_cost: number | null;
  notes: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  client_updated_at: string | null;
  sync_version: number;
  // Convenience only — added client-side after joining with product_id in the
  // saved_chemicals lookup for display purposes. Never persisted.
  work_task_id?: string | null;
}

export interface FertiliserAllocation {
  id: string;
  fertiliser_record_id: string;
  vineyard_id: string;
  paddock_id: string;
  area_ha: number;
  vine_count: number;
  application_rate: number;
  product_required: number;
  allocated_cost: number | null;
  created_at: string;
  updated_at: string;
}

const nowIso = () => new Date().toISOString();

export async function fetchFertiliserRecords(vineyardId: string): Promise<FertiliserRecord[]> {
  const { data, error } = await supabase
    .from("fertiliser_records")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("application_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FertiliserRecord[];
}

export async function fetchFertiliserAllocations(
  fertiliserRecordId: string,
): Promise<FertiliserAllocation[]> {
  const { data, error } = await supabase
    .from("fertiliser_record_allocations")
    .select("*")
    .eq("fertiliser_record_id", fertiliserRecordId);
  if (error) throw error;
  return (data ?? []) as FertiliserAllocation[];
}

export interface SaveFertiliserAllocationInput {
  id: string;
  paddock_id: string;
  area_ha: number;
  vine_count: number;
  application_rate: number;
  product_required: number;
  allocated_cost: number | null;
}

export interface SaveFertiliserRecordInput {
  id: string;
  vineyard_id: string;
  product_id: string | null;
  product_name: string;
  form: FertiliserForm;
  calculation_mode: FertiliserCalculationMode;
  record_status: FertiliserRecordStatus;
  application_date: string;
  block_names: string[];
  total_area_ha: number;
  total_vines: number;
  application_rate: number;
  application_rate_unit: string;
  total_product_required: number;
  product_unit: string;
  pack_size: number | null;
  pack_count: number | null;
  estimated_product_cost: number | null;
  labour_cost: number | null;
  machinery_cost: number | null;
  total_job_cost: number | null;
  notes: string;
  allocations: SaveFertiliserAllocationInput[];
  user_id: string | null;
  /** When known, forwarded so sync_version can be incremented on update. */
  current_sync_version?: number;
}

/**
 * Upsert the fertiliser record + reconcile its allocation rows in an
 * idempotent way. Stable UUIDs are required upstream so retries after a
 * partial failure repair state rather than duplicate rows.
 */
export async function saveFertiliserRecord(
  input: SaveFertiliserRecordInput,
): Promise<{ record: FertiliserRecord; allocations: FertiliserAllocation[] }> {
  const iso = nowIso();
  const recordPayload: any = {
    id: input.id,
    vineyard_id: input.vineyard_id,
    product_id: input.product_id ?? null,
    product_name: input.product_name ?? "",
    form: input.form,
    calculation_mode: input.calculation_mode,
    record_status: input.record_status,
    application_date: input.application_date,
    block_names: input.block_names ?? [],
    total_area_ha: input.total_area_ha ?? 0,
    total_vines: input.total_vines ?? 0,
    application_rate: input.application_rate ?? 0,
    application_rate_unit: input.application_rate_unit ?? "kg/ha",
    total_product_required: input.total_product_required ?? 0,
    product_unit: input.product_unit ?? "kg",
    pack_size: input.pack_size,
    pack_count: input.pack_count,
    estimated_product_cost: input.estimated_product_cost,
    labour_cost: input.labour_cost,
    machinery_cost: input.machinery_cost,
    total_job_cost: input.total_job_cost,
    notes: input.notes ?? "",
    updated_by: input.user_id ?? null,
    client_updated_at: iso,
    sync_version: (input.current_sync_version ?? 0) + 1,
  };
  // Only send created_by on the first write; on retries the row already exists.
  if ((input.current_sync_version ?? 0) === 0) {
    recordPayload.created_by = input.user_id ?? null;
  }

  const { data: recData, error: recErr } = await supabase
    .from("fertiliser_records")
    .upsert(recordPayload, { onConflict: "id" })
    .select("*")
    .single();
  if (recErr) throw recErr;
  const record = recData as FertiliserRecord;

  // Reconcile allocations: upsert desired rows, delete rows no longer selected.
  const desiredIds = new Set(input.allocations.map((a) => a.id));
  const existing = await fetchFertiliserAllocations(input.id);
  const toRemove = existing.filter((a) => !desiredIds.has(a.id));
  if (toRemove.length) {
    const { error } = await supabase
      .from("fertiliser_record_allocations")
      .delete()
      .in(
        "id",
        toRemove.map((a) => a.id),
      );
    if (error) throw error;
  }
  const allocPayloads = input.allocations.map((a) => ({
    id: a.id,
    fertiliser_record_id: input.id,
    vineyard_id: input.vineyard_id,
    paddock_id: a.paddock_id,
    area_ha: a.area_ha ?? 0,
    vine_count: a.vine_count ?? 0,
    application_rate: a.application_rate ?? 0,
    product_required: a.product_required ?? 0,
    allocated_cost: a.allocated_cost,
    updated_at: iso,
  }));
  let allocations: FertiliserAllocation[] = [];
  if (allocPayloads.length) {
    const { data, error } = await supabase
      .from("fertiliser_record_allocations")
      .upsert(allocPayloads, { onConflict: "id" })
      .select("*");
    if (error) throw error;
    allocations = (data ?? []) as FertiliserAllocation[];
  }

  return { record, allocations };
}

/**
 * Soft delete via the shared RPC. Only owner/manager/supervisor may call it;
 * RLS decides — no client-side pre-check.
 */
export async function softDeleteFertiliserRecord(id: string): Promise<void> {
  const { error } = await supabase.rpc("soft_delete_fertiliser_record", { p_id: id } as any);
  if (error) throw error;
}
