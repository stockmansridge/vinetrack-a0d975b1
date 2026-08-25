// Authoritative Tractor write path (Portal).
//
// A logical tractor is TWO physical rows that must never drift:
//
//   public.tractors                       (user-facing configuration)
//   public.vineyard_machines              (machine_type = 'tractor',
//                                          legacy_tractor_id = tractors.id)
//
// The Portal must not perform two independent browser writes — a failure
// between them is exactly how unlinked tractor-machines (integrity check C9)
// and fuel-rate drift appear. Both rows are written by ONE server-side
// function, owned and deployed by Rork:
//
// SQL 209 functions, owned and deployed by Rork:
//
//   public.portal_upsert_tractor(...)  RETURNS TABLE (tractor_id uuid, machine_id uuid, ...)
//   public.portal_archive_tractor(uuid) RETURNS TABLE (...)
//
// Both return SETOF rows, so supabase-js resolves `data` to an ARRAY of rows.

//
// There is deliberately NO client-side fallback. If the RPC is unavailable the
// save FAILS with a clear message: writing `tractors` alone would create a
// tractor-only record with no linked machine mirror, which is precisely the
// defect being removed.
//
// iOS compatibility: these functions are additive. iOS continues to write
// `tractors` / `vineyard_machines` directly and its sync is unaffected.

import { supabase } from "@/integrations/ios-supabase/client";

export interface TractorWriteInput {
  /** Omit/null to create. */
  id?: string | null;
  vineyard_id: string;
  name: string;
  brand: string | null;
  model: string | null;
  model_year: number | null;
  /** null / 0 means "not set" — never invent a rate. */
  fuel_usage_l_per_hour: number | null;
  serial_number: string | null;
  vin_number: string | null;
  user_id: string | null;
}

export interface TractorWriteResult {
  tractor_id: string;
  machine_id: string | null;
}

const RPC_MISSING = /PGRST202|could not find the function|schema cache/i;

const isRpcMissing = (err: { code?: string | null; message?: string | null } | null) =>
  !!err && RPC_MISSING.test(`${err.code ?? ""} ${err.message ?? ""}`);

export const TRACTOR_RPC_UNAVAILABLE =
  "Tractor saving is temporarily unavailable: the server-side tractor write function is not deployed yet. " +
  "No record was created — a tractor must always be saved together with its linked machine record.";

export const TRACTOR_ARCHIVE_RPC_UNAVAILABLE =
  "Tractor archiving is temporarily unavailable: the server-side tractor archive function is not deployed yet. " +
  "Nothing was changed.";

export const TRACTOR_RPC_MALFORMED =
  "Tractor save did not return a linked tractor and machine record. " +
  "The save could not be confirmed — please retry.";

/** SQL 209 returns SETOF rows: supabase-js gives an array. Take the first row. */
export function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  if (data && typeof data === "object") return data as T;
  return null;
}

export async function saveTractor(input: TractorWriteInput): Promise<TractorWriteResult> {
  const rpc = await supabase.rpc("portal_upsert_tractor", {
    p_tractor_id: input.id ?? null,
    p_vineyard_id: input.vineyard_id,
    p_name: input.name,
    p_brand: input.brand,
    p_model: input.model,
    p_model_year: input.model_year,
    p_fuel_usage_l_per_hour: input.fuel_usage_l_per_hour,
    p_serial_number: input.serial_number,
    p_vin_number: input.vin_number,
  });

  if (rpc.error) {
    if (isRpcMissing(rpc.error)) throw new Error(TRACTOR_RPC_UNAVAILABLE);
    throw rpc.error;
  }

  const row = firstRpcRow<{ tractor_id?: string | null; machine_id?: string | null }>(rpc.data);
  const tractorId = row?.tractor_id ?? null;
  const machineId = row?.machine_id ?? null;
  if (!tractorId || !machineId) throw new Error(TRACTOR_RPC_MALFORMED);

  return { tractor_id: tractorId, machine_id: machineId };
}


export async function archiveTractor(id: string): Promise<void> {
  const atomic = await supabase.rpc("portal_archive_tractor", { p_tractor_id: id });
  if (!atomic.error) return;
  if (!isRpcMissing(atomic.error)) throw atomic.error;
  throw new Error(TRACTOR_ARCHIVE_RPC_UNAVAILABLE);
}
