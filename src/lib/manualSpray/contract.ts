// Manual spray entry — backend contract boundary.
//
// Rork owns the shared backend contract. The Portal must NOT invent a second
// way to store a manual spray, so every production write funnels through the
// named functions below. Until they exist in the shared project, the Portal
// keeps the save / edit / delete actions unavailable and says why.
//
// Probed 9 September 2026 against the shared project: none of these functions
// resolve, and `spray_records` carries no source/provenance column.
import { supabase } from "@/integrations/ios-supabase/client";
import { toBaseAmount } from "@/lib/manualSpray/units";
import { MANUAL_SPRAY_SOURCE, type ManualSprayDraft } from "@/lib/manualSpray/domain";

/** Function names agreed for the handoff. Never call anything else. */
export const MANUAL_SPRAY_RPC = {
  save: "save_manual_spray_v1",
  delete: "delete_manual_spray_v1",
  report: "get_spray_report_v1",
} as const;

/** Exact contract gaps blocking production use. Shown verbatim to the user. */
export const MANUAL_SPRAY_CONTRACT_GAPS: string[] = [
  "save_manual_spray_v1 — atomic completed-application save (trip + spray record + tank actuals) is not deployed.",
  "delete_manual_spray_v1 — coordinated soft delete of a manual application is not deployed.",
  "A persistent manual source/provenance field on spray_records (and in the canonical report payload) does not exist.",
  "The historical weather preview contract is unsettled: the Portal reads `filled`, the deployed spray-weather-recovery function returns `captured`.",
];

export const MANUAL_SPRAY_UNAVAILABLE_MESSAGE =
  "Saving manual sprays is waiting on the shared backend. You can fill this form in, but it can't be saved yet.";

export interface ManualSprayContractStatus {
  available: boolean;
  gaps: string[];
}

/**
 * Ask the shared project whether the save function exists. PostgREST answers
 * PGRST202 when the function is absent from the schema cache; any other
 * outcome (including a permission refusal) means it is deployed.
 */
export async function probeManualSprayContract(): Promise<ManualSprayContractStatus> {
  try {
    const { error } = await supabase.rpc(MANUAL_SPRAY_RPC.save as any, {} as any);
    const missing = (error as { code?: string } | null)?.code === "PGRST202";
    return missing
      ? { available: false, gaps: MANUAL_SPRAY_CONTRACT_GAPS }
      : { available: true, gaps: [] };
  } catch {
    return { available: false, gaps: MANUAL_SPRAY_CONTRACT_GAPS };
  }
}

/* --------------------------------------------------------------- payload */

export interface ManualSprayPayload {
  application_id: string;
  vineyard_id: string;
  source: typeof MANUAL_SPRAY_SOURCE;
  name: string;
  start_at: string | null;
  end_at: string | null;
  tractor_id: string | null;
  operator_user_id: string | null;
  spray_equipment_id: string | null;
  start_engine_hours: number | null;
  end_engine_hours: number | null;
  block_ids: string[];
  tanks: Array<{
    tank_id: string;
    tank_number: number;
    /** Water in litres, exactly as recorded. Null stays null. */
    water_litres: number | null;
    chemicals: Array<{
      line_id: string;
      saved_chemical_id: string | null;
      product_name: string;
      category: string | null;
      physical_form: string;
      /** Persisted base amount: mL for liquids/volume, g for solids/mass. */
      base_amount: number | null;
      base_unit: "mL" | "g" | null;
      entered_amount: number | null;
      entered_unit: string | null;
      snapshot: Record<string, unknown> | null;
      snapshot_at: string | null;
    }>;
  }>;
  weather: ManualSprayDraft["weather"];
  notes: string | null;
}

/** Deterministic mapping from a validated draft to the agreed wire payload. */
export function toManualSprayPayload(draft: ManualSprayDraft): ManualSprayPayload {
  return {
    application_id: draft.id,
    vineyard_id: draft.vineyardId,
    source: MANUAL_SPRAY_SOURCE,
    name: draft.name.trim(),
    start_at: draft.startAt,
    end_at: draft.endAt,
    tractor_id: draft.tractorId,
    operator_user_id: draft.operatorUserId,
    spray_equipment_id: draft.sprayEquipmentId,
    start_engine_hours: draft.startEngineHours,
    end_engine_hours: draft.endEngineHours,
    block_ids: [...draft.blockIds],
    tanks: draft.tanks.map((t) => ({
      tank_id: t.id,
      tank_number: t.displayNumber,
      water_litres: t.waterLitres,
      chemicals: t.chemicals.map((c) => {
        const base = toBaseAmount(c.amount, c.unit);
        return {
          line_id: c.id,
          saved_chemical_id: c.savedChemicalId,
          product_name: c.productName.trim(),
          category: c.category,
          physical_form: c.physicalForm,
          base_amount: base ? base.base : null,
          base_unit: base ? base.baseUnit : null,
          entered_amount: c.amount,
          entered_unit: c.unit,
          snapshot: c.snapshot ?? null,
          snapshot_at: c.snapshotAt ?? null,
        };
      }),
    })),
    weather: draft.weather,
    notes: draft.notes.trim() || null,
  };
}

/* -------------------------------------------------------- save / delete */

export type ManualSpraySaveOutcome =
  | { kind: "unavailable"; message: string; gaps: string[] }
  | { kind: "saved"; applicationId: string }
  | { kind: "refused"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "uncertain"; message: string };

const UNCERTAIN_PATTERNS = [/failed to fetch/i, /network/i, /timeout/i, /aborted/i];

export const isUncertainManualFailure = (e: unknown): boolean => {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? "");
  return UNCERTAIN_PATTERNS.some((p) => p.test(m));
};

/**
 * One logical save. The payload and its identities are supplied frozen by the
 * caller, so a retry re-sends exactly the same request and can never create a
 * second application.
 */
export async function saveManualSpray(payload: ManualSprayPayload): Promise<ManualSpraySaveOutcome> {
  const status = await probeManualSprayContract();
  if (!status.available) {
    return { kind: "unavailable", message: MANUAL_SPRAY_UNAVAILABLE_MESSAGE, gaps: status.gaps };
  }
  try {
    const { error } = await supabase.rpc(MANUAL_SPRAY_RPC.save as any, { p_payload: payload } as any);
    if (error) {
      if (error.code === "40001" || /conflict/i.test(error.message)) {
        return { kind: "conflict", message: "This spray was changed somewhere else. Reopen it before saving again." };
      }
      if (isUncertainManualFailure(error)) {
        return { kind: "uncertain", message: "The connection dropped — this spray may already be saved. Check the list before trying again." };
      }
      return { kind: "refused", message: error.message };
    }
    return { kind: "saved", applicationId: payload.application_id };
  } catch (e) {
    if (isUncertainManualFailure(e)) {
      return { kind: "uncertain", message: "The connection dropped — this spray may already be saved. Check the list before trying again." };
    }
    return { kind: "refused", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteManualSpray(applicationId: string): Promise<ManualSpraySaveOutcome> {
  const status = await probeManualSprayContract();
  if (!status.available) {
    return { kind: "unavailable", message: MANUAL_SPRAY_UNAVAILABLE_MESSAGE, gaps: status.gaps };
  }
  try {
    const { error } = await supabase.rpc(MANUAL_SPRAY_RPC.delete as any, { p_application_id: applicationId } as any);
    if (error) {
      if (isUncertainManualFailure(error)) {
        return { kind: "uncertain", message: "The connection dropped — this spray may already be deleted." };
      }
      return { kind: "refused", message: error.message };
    }
    return { kind: "saved", applicationId };
  } catch (e) {
    return isUncertainManualFailure(e)
      ? { kind: "uncertain", message: "The connection dropped — this spray may already be deleted." }
      : { kind: "refused", message: e instanceof Error ? e.message : String(e) };
  }
}
