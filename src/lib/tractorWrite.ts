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
// function, proposed as SQL 209:
//
//   public.portal_upsert_tractor(...)  -> jsonb { tractor_id, machine_id }
//   public.portal_archive_tractor(uuid)
//
// Until SQL 209 is executed the RPC does not exist. We then fall back to the
// historical single-table write so tractor management keeps working, and we
// report `mirrorPending: true` so the UI can tell the user the linked machine
// record will be created when the migration runs. The fallback NEVER writes a
// vineyard_machines row itself — a Portal-created unlinked tractor-machine is
// precisely the defect being removed.
//
// iOS compatibility: these functions are additive. iOS continues to write
// `tractors` / `vineyard_machines` directly and its sync is unaffected; the
// probe in the Stage 0 audit confirmed no existing RPC of any of these names,
// so no signature is being overloaded or changed.

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
  /** true when SQL 209 is not deployed yet and no linked mirror was written. */
  mirrorPending: boolean;
}

const RPC_MISSING = /PGRST202|could not find the function|schema cache/i;

const isRpcMissing = (err: { code?: string | null; message?: string | null } | null) =>
  !!err && RPC_MISSING.test(`${err.code ?? ""} ${err.message ?? ""}`);

export async function saveTractor(input: TractorWriteInput): Promise<TractorWriteResult> {
  const nowIso = new Date().toISOString();
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

  if (!rpc.error) {
    const row = (rpc.data ?? {}) as { tractor_id?: string; machine_id?: string };
    return {
      tractor_id: row.tractor_id ?? input.id ?? "",
      machine_id: row.machine_id ?? null,
      mirrorPending: false,
    };
  }
  if (!isRpcMissing(rpc.error)) throw rpc.error;

  // ---- Fallback: SQL 209 not deployed. Single-table write, mirror deferred.
  const shared = {
    name: input.name,
    brand: input.brand,
    model: input.model,
    model_year: input.model_year,
    fuel_usage_l_per_hour: input.fuel_usage_l_per_hour,
    serial_number: input.serial_number,
    vin_number: input.vin_number,
    updated_by: input.user_id,
    client_updated_at: nowIso,
  };

  if (input.id) {
    const { error } = await supabase
      .from("tractors")
      .update(shared)
      .eq("id", input.id)
      .eq("vineyard_id", input.vineyard_id);
    if (error) throw error;
    return { tractor_id: input.id, machine_id: null, mirrorPending: true };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("tractors").insert({
    id,
    vineyard_id: input.vineyard_id,
    created_by: input.user_id,
    ...shared,
  });
  if (error) throw error;
  return { tractor_id: id, machine_id: null, mirrorPending: true };
}

export interface TractorArchiveResult {
  mirrorPending: boolean;
}

export async function archiveTractor(id: string): Promise<TractorArchiveResult> {
  const atomic = await supabase.rpc("portal_archive_tractor", { p_tractor_id: id });
  if (!atomic.error) return { mirrorPending: false };
  if (!isRpcMissing(atomic.error)) throw atomic.error;

  const legacy = await supabase.rpc("soft_delete_tractor", { p_id: id });
  if (legacy.error) throw legacy.error;
  return { mirrorPending: true };
}
