// Tractor, spray unit, operator and trip-specific fuel corrections.
//
// One controlled write path: `correct_spray_trip_metadata_v1` (SQL 228). The
// request is a COMPLETE correction snapshot — an explicit null clears the
// overlay — and the response carries the refreshed canonical report, which is
// the only thing the worksheet, list and exports may adopt afterwards.
//
// Frozen tanks, chemicals, rows, route, actuals, weather and program
// provenance are never touched here.
import { supabase } from "@/integrations/ios-supabase/client";
import { generateUuid } from "@/lib/uuid";
import { parseSprayReportPayload, type SprayReportPayloadV1 } from "@/lib/sprayReportV1";

export const TRIP_METADATA_CONFLICT =
  "This trip was changed by someone else while you were editing. Reload the trip and re-enter your changes.";
export const TRIP_METADATA_FUEL_ZERO =
  "Enter a fuel use greater than zero, or leave it blank to use the machine's usual rate.";

export interface TripMetadataCorrection {
  machineId: string | null;
  tractorId: string | null;
  sprayEquipmentId: string | null;
  operatorUserId: string | null;
  fuelConsumptionLPerHour: number | null;
  startEngineHours: number | null;
  endEngineHours: number | null;
}

export interface TripMetadataResult {
  version: number | null;
  report: SprayReportPayloadV1 | null;
}

export class TripMetadataConflictError extends Error {
  constructor() {
    super(TRIP_METADATA_CONFLICT);
    this.name = "TripMetadataConflictError";
  }
}

function isConflict(error: any): boolean {
  return (
    error?.code === "40001" ||
    /40001|serialization|version conflict/i.test(String(error?.message ?? ""))
  );
}

/** Blank means "no override"; zero is invalid, never free fuel. */
export function validateFuelRate(value: number | null): string | null {
  if (value == null) return null;
  if (!isFinite(value) || value <= 0) return TRIP_METADATA_FUEL_ZERO;
  return null;
}

export async function correctSprayTripMetadata(input: {
  tripId: string;
  expectedVersion: number;
  correction: TripMetadataCorrection;
  /** Reuse only when retrying the same Save. */
  operationId?: string;
}): Promise<TripMetadataResult> {
  const fuelError = validateFuelRate(input.correction.fuelConsumptionLPerHour);
  if (fuelError) throw new Error(fuelError);

  const { data, error } = await (supabase as any).rpc("correct_spray_trip_metadata_v1", {
    p_operation_id: input.operationId ?? generateUuid(),
    p_trip_id: input.tripId,
    p_expected_version: input.expectedVersion,
    p_machine_id: input.correction.machineId,
    p_tractor_id: input.correction.tractorId,
    p_spray_equipment_id: input.correction.sprayEquipmentId,
    p_operator_user_id: input.correction.operatorUserId,
    p_fuel_consumption_l_per_hour: input.correction.fuelConsumptionLPerHour,
    p_start_engine_hours: input.correction.startEngineHours,
    p_end_engine_hours: input.correction.endEngineHours,
  });

  if (error) {
    if (isConflict(error)) throw new TripMetadataConflictError();
    throw new Error(error.message || "Your changes have not been saved. Please try again.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  const version =
    typeof row?.correction?.version === "number" ? (row.correction.version as number) : null;
  const parsed = row?.report ? parseSprayReportPayload(row.report) : { payload: null };
  return { version, report: parsed.payload };
}
