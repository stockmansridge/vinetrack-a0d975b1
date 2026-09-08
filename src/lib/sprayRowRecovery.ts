// Row/block recovery for a spray trip.
//
// The shared action ACCEPTS evidence-backed assignments — it does not generate
// them. The portal therefore submits only assignments that already carry a
// stable block id plus a row identity and their original evidence, exactly as
// supplied. It never invents a block assignment, a row identity or a
// confidence score, and it never rewrites `originalEvidence`.
import { supabase } from "@/integrations/ios-supabase/client";
import { generateUuid } from "@/lib/uuid";
import type { SprayReportRow } from "@/lib/sprayReportV1";

export type RowAssignmentSource =
  | "recorded_path_identity"
  | "saved_plan_identity"
  | "session_boundary_order"
  | "gps_geometry_intersection";

export interface RowAssignmentEvidence {
  blockId: string;
  blockName: string;
  rowIdentity: string;
  rowNumber: number | null;
  tankSessionId: string | null;
  tankNumber: number | null;
  status: "Complete" | "Partial" | "Skipped/Not complete" | "Not recorded";
  assignmentSource: RowAssignmentSource;
  confidence: number;
  originalEvidence: Record<string, unknown>;
}

export const ROW_RECOVERY_NO_EVIDENCE =
  "There isn't enough recorded evidence to work out which rows belong to which block.";

/** GPS/geometry evidence below 0.90 confidence is never submitted. */
export function isSubmittableAssignment(a: RowAssignmentEvidence): boolean {
  if (!a.blockId || !a.rowIdentity) return false;
  if (a.assignmentSource === "gps_geometry_intersection" && a.confidence < 0.9) return false;
  return true;
}

export async function recoverSprayRowAssignments(input: {
  tripId: string;
  assignments: RowAssignmentEvidence[];
  operationId?: string;
}): Promise<void> {
  const assignments = input.assignments.filter(isSubmittableAssignment);
  if (!assignments.length) throw new Error(ROW_RECOVERY_NO_EVIDENCE);
  const { error } = await (supabase as any).rpc("recover_spray_row_assignments_v1", {
    p_operation_id: input.operationId ?? generateUuid(),
    p_trip_id: input.tripId,
    p_assignments: assignments,
  });
  if (error) throw new Error(error.message);
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
