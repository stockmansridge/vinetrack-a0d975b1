// Stage 3C — READ-ONLY season history for the Resistance Check.
//
// Reads recorded sprays (`spray_records`) — the applications that actually
// happened. Planned `spray_jobs` are deliberately NOT history: a plan is not an
// application, and counting one would consume a group's seasonal allowance for
// a spray that may never leave the shed.
import { supabase } from "@/integrations/ios-supabase/client";
import {
  buildResistanceEvents,
  eventInputFromSprayRecord,
  type ResistanceEventSourceResult,
} from "./resistanceEventSource";
import type { ResistanceSeasonCalendar } from "./resistanceSeason";

export interface ResistanceHistoryResult extends ResistanceEventSourceResult {
  /** Raw rows considered, for diagnostics only. */
  recordCount: number;
}

/**
 * Fetch and project every recorded spray for the vineyard.
 *
 * The full history is returned unfiltered by season: cross-season rules
 * (CropLife Powdery Guideline 2) need the previous season's tail, and the
 * ENGINE — not the query — decides what is in scope.
 */
export async function fetchResistanceHistory(
  vineyardId: string,
  seasonCalendar: ResistanceSeasonCalendar,
): Promise<ResistanceHistoryResult> {
  const { data, error } = await supabase
    .from("spray_records")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;

  const rows = (data ?? []) as Record<string, any>[];
  const projected = buildResistanceEvents(
    rows.map(eventInputFromSprayRecord),
    seasonCalendar,
  );
  return { ...projected, recordCount: rows.length };
}
