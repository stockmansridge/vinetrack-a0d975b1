// One transactional Spray Trip worksheet amendment.
//
// The worksheet edits trip metadata and tank actuals together, so it issues ONE
// request: `save_spray_trip_worksheet_v1` (SQL 235). That function runs the
// existing audited corrections — `correct_spray_trip_metadata_v1` and
// `correct_spray_tank_actual_v1` — inside a single PostgreSQL transaction. Every
// requested change commits, or none does.
//
// Nothing here validates spray data, duplicates a database rule, writes a table
// directly, or touches trip activity, end time, tank sessions or planned values.
import { supabase } from "@/integrations/ios-supabase/client";
import { parseSprayReportPayload, type SprayReportPayloadV1 } from "@/lib/sprayReportV1";
import type { MetadataRequest, TankRequest } from "@/lib/spraySaveOrchestration";

export const WORKSHEET_UNAVAILABLE =
  "Saving spray corrections isn't available yet on this database. Your changes are still here — nothing was written.";

/** The composite function is missing: capability failure, before any mutation. */
export class WorksheetSaveUnavailableError extends Error {
  constructor(readonly diagnostic: string) {
    super(WORKSHEET_UNAVAILABLE);
    this.name = "WorksheetSaveUnavailableError";
  }
}

/** Refused: the trip or a tank actual moved on. Nothing was written. */
export class WorksheetConflictError extends Error {
  constructor(readonly diagnostic: string) {
    super("This trip was changed by someone else while you were editing.");
    this.name = "WorksheetConflictError";
  }
}

export interface WorksheetSaveResult {
  metadataVersion: number | null;
  report: SprayReportPayloadV1 | null;
}

function isUnavailable(error: { code?: string; message?: string } | null): boolean {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist")
  );
}

function isConflict(error: { code?: string; message?: string } | null): boolean {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "");
  return (
    code === "PT409" ||
    code === "40001" ||
    /WORKSHEET_VERSION_CONFLICT|version conflict|changed by someone else/i.test(msg)
  );
}

function metadataWire(req: MetadataRequest) {
  const c = req.correction;
  return {
    operationId: req.operationId,
    expectedVersion: req.expectedVersion,
    machineId: c.machineId,
    tractorId: c.tractorId,
    sprayEquipmentId: c.sprayEquipmentId,
    operatorUserId: c.operatorUserId,
    fuelConsumptionLPerHour: c.fuelConsumptionLPerHour,
    startEngineHours: c.startEngineHours,
    endEngineHours: c.endEngineHours,
  };
}

/** Each tank keeps its own stable correction operation id and identities. */
function tankWire(req: TankRequest) {
  const s = req.snapshot;
  return {
    operationId: req.operationId,
    actualId: s.actualId,
    sprayRecordId: req.sprayRecordId,
    tankSessionId: s.tankSessionId,
    tankNumber: s.tankNumber,
    expectedVersion: s.expectedVersion,
    waterVolumeL: s.waterVolumeL,
    chemicals: s.chemicals,
  };
}

/**
 * Issue one frozen worksheet attempt. Retrying re-sends the identical payload —
 * same worksheet operation id, same per-tank operation ids, same expected
 * versions — so the audited contracts de-duplicate it instead of recording a
 * second amendment.
 */
export async function saveWorksheetTransaction(input: {
  worksheetOperationId: string;
  tripId: string;
  metadata: MetadataRequest | null;
  tanks: TankRequest[];
}): Promise<WorksheetSaveResult> {
  const { data, error } = await (supabase as any).rpc("save_spray_trip_worksheet_v1", {
    p_operation_id: input.worksheetOperationId,
    p_trip_id: input.tripId,
    p_metadata: input.metadata ? metadataWire(input.metadata) : null,
    p_tanks: input.tanks.map(tankWire),
  });

  if (error) {
    const diagnostic = `save_spray_trip_worksheet_v1: ${error.code ?? "?"} ${error.message ?? ""}`.trim();
    if (isUnavailable(error)) throw new WorksheetSaveUnavailableError(diagnostic);
    if (isConflict(error)) throw new WorksheetConflictError(diagnostic);
    const err = new Error(error.message || "Your changes have not been saved. Please try again.");
    (err as any).code = error.code;
    throw err;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const meta = (row?.metadata ?? null) as any;
  const version =
    typeof meta?.correction?.version === "number"
      ? (meta.correction.version as number)
      : typeof meta?.version === "number"
        ? (meta.version as number)
        : null;
  const parsed = meta?.report ? parseSprayReportPayload(meta.report) : { payload: null };
  return { metadataVersion: version, report: parsed.payload };
}
