import { iosSupabase } from "@/integrations/ios-supabase/client";

// SQL 257 counts distinct creators/vineyards on records CREATED in the window,
// not actors who edited/deleted them. Keep this read-only query identical.
const TABLES = new Set(["trips", "pins", "spray_records", "spray_jobs", "saved_chemicals", "saved_spray_presets", "work_tasks", "paddocks", "vineyard_machines", "tractors", "spray_equipment", "saved_inputs", "vineyard_members", "damage_records", "picking_records", "fertiliser_records", "pruning_entries", "maintenance_logs", "fuel_purchases", "tractor_fuel_logs", "yield_estimation_sessions", "resistance_plans", "grape_allocations"]);
export type ParticipantKind = "vineyards" | "users";
export interface Participant { id: string; records: number }
export function aggregateParticipants(rows: Record<string, unknown>[], column: string): Participant[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const id = row[column];
    if (typeof id === "string" && id) totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  return [...totals].map(([id, records]) => ({ id, records })).sort((a, b) => b.records - a.records || a.id.localeCompare(b.id));
}
export function reconcileParticipants(rows: Participant[], expected: number) {
  if (rows.length !== expected) throw new Error("The available records do not match the dashboard count. Access may be restricted or activity has changed. Refresh the dashboard and try again.");
  return rows;
}
export async function fetchActionParticipants(action: string, kind: ParticipantKind, days: number | null, expected: number, signal?: AbortSignal) {
  if (!TABLES.has(action)) throw new Error("This activity is not supported.");
  const since = days == null ? null : new Date(Date.now() - days * 86400000).toISOString();
  const columns = kind === "vineyards" ? ["vineyard_id"] : ["created_by", "created_by_user_id", "user_id"];
  for (const column of columns) {
    const records: Record<string, unknown>[] = [];
    for (let page = 0; page < 100; page++) {
      let query = (iosSupabase as any).from(action).select(column).order("created_at", { ascending: true }).range(page * 1000, page * 1000 + 999);
      if (since) query = query.gte("created_at", since);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) {
        if (error.code === "42703" || error.code === "PGRST204") break;
        throw new Error("Activity details are unavailable with your current access. No permissions have been changed.");
      }
      records.push(...(data ?? []));
      if ((data ?? []).length < 1000) return reconcileParticipants(aggregateParticipants(records, column), expected);
      if (page === 99) throw new Error("This activity is too large to list safely. Choose a shorter period.");
    }
  }
  throw new Error("This record type does not expose the required attribution.");
}