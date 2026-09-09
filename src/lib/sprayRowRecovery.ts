// Row/block recovery for a spray trip.
//
// All matching, precedence and confidence rules live in the authorised
// `spray-row-recovery` action. The portal never derives a block assignment,
// a row identity or a confidence score, and never rewrites evidence: it asks
// the action to run for a trip and reports the outcome plainly.
import { supabase } from "@/integrations/ios-supabase/client";
import { generateUuid } from "@/lib/uuid";
import type { SprayReportRow } from "@/lib/sprayReportV1";

export type RowAssignmentSource =
  | "recorded_path_identity"
  | "saved_plan_identity"
  | "session_boundary_order"
  | "gps_geometry_intersection";

export const ROW_RECOVERY_NO_EVIDENCE =
  "There isn't enough recorded evidence to work out which rows belong to which block.";
export const ROW_RECOVERY_FAILED =
  "Row and block recovery couldn't run just now. Recorded rows are unchanged — try again shortly.";
export const ROW_RECOVERY_NOT_PERMITTED =
  "You don't have permission to recover row and block assignments for this trip.";

export type RowRecoveryOutcome =
  | { kind: "recovered"; assigned: number; message: string }
  | { kind: "none"; message: string }
  | { kind: "not_permitted"; message: string }
  | { kind: "failed"; message: string; diagnostic: string };

export interface RowRecoveryResponse {
  assigned?: number;
  recovered?: number;
  unresolved?: number;
  status?: string;
}

/**
 * Ask the authorised recovery action to attribute rows to blocks for a trip.
 * The action derives and validates the evidence; nothing is generated here.
 */
export async function recoverSprayRowAssignments(input: {
  tripId: string;
  operationId?: string;
}): Promise<RowRecoveryOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke("spray-row-recovery", {
      body: { tripId: input.tripId, operationId: input.operationId ?? generateUuid() },
    });
    if (error) {
      const msg = error.message ?? "";
      if (/403|forbidden|not_authori[sz]ed|permission/i.test(msg)) {
        return { kind: "not_permitted", message: ROW_RECOVERY_NOT_PERMITTED };
      }
      return {
        kind: "failed",
        message: ROW_RECOVERY_FAILED,
        diagnostic: `spray-row-recovery invoke failed: ${msg}`,
      };
    }
    const res = (data ?? {}) as RowRecoveryResponse;
    if (res.status === "not_authorized" || res.status === "forbidden") {
      return { kind: "not_permitted", message: ROW_RECOVERY_NOT_PERMITTED };
    }
    const assigned =
      typeof res.assigned === "number"
        ? res.assigned
        : typeof res.recovered === "number"
          ? res.recovered
          : 0;
    if (assigned > 0) {
      return {
        kind: "recovered",
        assigned,
        message: `${assigned} ${assigned === 1 ? "row was" : "rows were"} matched to a block.`,
      };
    }
    return { kind: "none", message: ROW_RECOVERY_NO_EVIDENCE };
  } catch (e) {
    return {
      kind: "failed",
      message: ROW_RECOVERY_FAILED,
      diagnostic: `spray-row-recovery threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Plain-English provenance for a canonical row. */
export function rowProvenanceLabel(r: SprayReportRow): string {
  const parts: string[] = [];
  switch (r.source) {
    case "recorded_path_identity":
      parts.push("Recorded on the tracked path");
      break;
    case "saved_plan_identity":
      parts.push("From the saved plan");
      break;
    case "session_boundary_order":
      parts.push("Worked out from tank change points");
      break;
    case "gps_geometry_intersection":
      parts.push("Worked out from the recorded location");
      break;
    default:
      parts.push(
        r.source
          ? r.source.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase())
          : "Not recorded",
      );
  }
  if (r.isDerived) parts.push("calculated");
  if (typeof r.confidence === "number" && r.confidence < 1) {
    parts.push(`${Math.round(r.confidence * 100)}% confidence`);
  }
  return parts.join(" · ");
}
