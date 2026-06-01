// Read-only query helpers for `tractor_fuel_logs` on the iOS Supabase project.
//
// Phase 1: portal is read-only. Writes happen from iPhone. We never store
// `litres_per_hour` — it is derived display-only from previous full fills
// for the same tractor (matching the iOS calculation).

import { supabase } from "@/integrations/ios-supabase/client";

export interface TractorFuelLog {
  id: string;
  vineyard_id: string;
  tractor_id: string | null;
  fill_datetime: string | null;
  litres_added: number | null;
  engine_hours: number | null;
  operator_user_id: string | null;
  operator_name: string | null;
  cost_per_litre: number | null;
  total_cost: number | null;
  filled_to_full: boolean | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  client_updated_at: string | null;
  sync_version: number | null;
}

export interface TractorRef {
  id: string;
  name: string | null;
}

export async function fetchTractorFuelLogsForVineyard(
  vineyardId: string,
): Promise<TractorFuelLog[]> {
  const { data, error } = await supabase
    .from("tractor_fuel_logs")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("fill_datetime", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TractorFuelLog[];
}

export async function fetchTractorsForVineyard(
  vineyardId: string,
): Promise<TractorRef[]> {
  const { data, error } = await supabase
    .from("tractors")
    .select("id, name")
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as TractorRef[];
}

export type LhrStatus = "calculated" | "estimate" | "cannot_calculate";

export interface LhrResult {
  litresPerHour: number | null;
  status: LhrStatus;
  reason?: string;
}

/**
 * Compute L/hr for a fuel log using the previous fill for the same tractor.
 * Logs MUST be sorted ascending by fill_datetime when calling this; we look
 * up the previous log via the provided index map.
 *
 * Mirrors iOS logic:
 *   - need engine_hours on both
 *   - delta = current.engine_hours - previous.engine_hours
 *   - delta must be > 0
 *   - litres_per_hour = current.litres_added / delta
 *   - if either fill is not filled_to_full → estimate
 */
export function computeLitresPerHour(
  current: TractorFuelLog,
  previous: TractorFuelLog | null,
): LhrResult {
  if (!previous) {
    return { litresPerHour: null, status: "cannot_calculate", reason: "no previous fill" };
  }
  const curHrs = current.engine_hours;
  const prevHrs = previous.engine_hours;
  if (curHrs == null || prevHrs == null) {
    return { litresPerHour: null, status: "cannot_calculate", reason: "engine hours missing" };
  }
  const delta = curHrs - prevHrs;
  if (delta <= 0) {
    return {
      litresPerHour: null,
      status: "cannot_calculate",
      reason: delta === 0 ? "zero engine-hour delta" : "engine hours went backwards",
    };
  }
  const litres = current.litres_added;
  if (litres == null || litres <= 0) {
    return { litresPerHour: null, status: "cannot_calculate", reason: "no litres recorded" };
  }
  const lhr = litres / delta;
  const bothFull = current.filled_to_full === true && previous.filled_to_full === true;
  return { litresPerHour: lhr, status: bothFull ? "calculated" : "estimate" };
}

/**
 * Given a list of logs (any order), return a map of log.id → LhrResult
 * using the previous full/partial fill for the same tractor in chronological
 * order.
 */
export function buildLhrMap(logs: TractorFuelLog[]): Map<string, LhrResult> {
  const map = new Map<string, LhrResult>();
  const byTractor = new Map<string, TractorFuelLog[]>();
  for (const log of logs) {
    if (!log.tractor_id) continue;
    const arr = byTractor.get(log.tractor_id) ?? [];
    arr.push(log);
    byTractor.set(log.tractor_id, arr);
  }
  for (const arr of byTractor.values()) {
    arr.sort((a, b) => (a.fill_datetime ?? "").localeCompare(b.fill_datetime ?? ""));
    for (let i = 0; i < arr.length; i++) {
      const prev = i > 0 ? arr[i - 1] : null;
      map.set(arr[i].id, computeLitresPerHour(arr[i], prev));
    }
  }
  // Logs without a tractor: no calculation possible.
  for (const log of logs) {
    if (!log.tractor_id) map.set(log.id, { litresPerHour: null, status: "cannot_calculate", reason: "no tractor" });
  }
  return map;
}
