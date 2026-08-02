// Pruning Activity Report data layer.
//
// Read-only. Joins the canonical pruning tables (pruning_entries,
// pruning_row_segments, pruning_seasons) to blocks, linked Work Tasks and
// their labour lines so the report can present one row per recorded
// pruning entry.
//
// Contract notes:
//  - `season_year` comes from pruning_seasons (the pruning calendar year).
//  - `vintage_year` is the server-resolved production vintage stored on the
//    entry by SQL 119 — never derived from entry_date on the client.
//  - Reversed entries have `deleted_at` set. They are fetched so the report
//    can optionally show them, but are excluded by default.
//  - Costs come from work_task_labour_lines of the linked Work Task. No
//    costing is invented client-side.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { parseVarietyAllocations } from "@/lib/paddockGeometry";
import type { PruningEntry } from "@/lib/pruningQuery";

export interface PruningActivityRow {
  id: string;
  entry: PruningEntry;
  date: string;                 // ISO yyyy-mm-dd
  seasonYear: number | null;
  vintageYear: number | null;
  paddockId: string;
  blockName: string;
  variety: string;
  worker: string;
  method: string;
  /** Distinct rows touched by this entry. */
  rowNumbers: number[];
  rowsLabel: string;            // "12–18, 24"
  rowCount: number;
  quarters: number;             // completed row segments recorded by this entry
  rowEquivalents: number;
  vines: number;
  labourHours: number | null;
  startTime: string | null;
  finishTime: string | null;
  /** Elapsed minutes between start and finish (overnight-aware). Null when unknown. */
  durationMinutes: number | null;
  vinesPerHour: number | null;
  rowEqPerHour: number | null;
  workTaskId: string | null;
  workTaskLabel: string | null;
  workTaskStatus: string | null;
  labourCost: number | null;    // null when there is no linked Work Task
  hourlyRate: number | null;    // labour cost / labour hours
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
  isReversed: boolean;
}

/** Minutes between two time/timestamp values; rolls over midnight. */
export function durationMinutesBetween(start: string | null, finish: string | null): number | null {
  const toMinutes = (v: string | null): number | null => {
    if (!v) return null;
    const raw = v.trim();
    if (raw.includes("T") || (raw.includes(" ") && raw.length > 10)) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }
    const hm = /^(\d{1,2}):(\d{2})/.exec(raw);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    return null;
  };
  const a = toMinutes(start);
  const b = toMinutes(finish);
  if (a == null || b == null) return null;
  const diff = b - a;
  return diff >= 0 ? diff : diff + 24 * 60;
}


/** Compact a sorted list of row numbers into "1–4, 7, 10–12". */
export function formatRowRanges(rows: number[]): string {
  const nums = Array.from(new Set(rows.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
  if (!nums.length) return "—";
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(", ");
}

interface SeasonLite { id: string; paddock_id: string; season_year: number }
interface PaddockLite { id: string; name: string | null; variety_allocations: any }
interface SegmentLite { pruning_entry_id: string | null; row_number: number; segment_number: number }
interface TaskLite { id: string; task_type: string | null; description: string | null }
interface LabourLite { work_task_id: string; total_hours: number | null; total_cost: number | null }

export function usePruningActivity(vineyardId: string | null) {
  return useQuery({
    queryKey: ["pruning", "activity-report", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<PruningActivityRow[]> => {
      const vid = vineyardId!;
      const [entriesRes, segmentsRes, seasonsRes, paddocksRes, tasksRes, labourRes] =
        await Promise.all([
          supabase.from("pruning_entries").select("*").eq("vineyard_id", vid)
            .order("entry_date", { ascending: false }),
          supabase.from("pruning_row_segments")
            .select("pruning_entry_id, row_number, segment_number")
            .eq("vineyard_id", vid),
          supabase.from("pruning_seasons").select("id, paddock_id, season_year")
            .eq("vineyard_id", vid),
          supabase.from("paddocks").select("id, name, variety_allocations")
            .eq("vineyard_id", vid).is("deleted_at", null),
          supabase.from("work_tasks").select("id, task_type, description")
            .eq("vineyard_id", vid).is("deleted_at", null),
          supabase.from("work_task_labour_lines")
            .select("work_task_id, total_hours, total_cost")
            .eq("vineyard_id", vid).is("deleted_at", null),
        ]);

      for (const res of [entriesRes, segmentsRes, seasonsRes, paddocksRes, tasksRes, labourRes]) {
        if (res.error) throw res.error;
      }

      const entries = (entriesRes.data ?? []) as PruningEntry[];
      const segments = (segmentsRes.data ?? []) as SegmentLite[];
      const seasons = (seasonsRes.data ?? []) as SeasonLite[];
      const paddocks = (paddocksRes.data ?? []) as PaddockLite[];
      const tasks = (tasksRes.data ?? []) as TaskLite[];
      const labour = (labourRes.data ?? []) as LabourLite[];

      const seasonById = new Map(seasons.map((s) => [s.id, s]));
      const paddockById = new Map(paddocks.map((p) => [p.id, p]));
      const taskById = new Map(tasks.map((t) => [t.id, t]));

      const labourByTask = new Map<string, { hours: number; cost: number }>();
      labour.forEach((l) => {
        if (!l.work_task_id) return;
        const acc = labourByTask.get(l.work_task_id) ?? { hours: 0, cost: 0 };
        acc.hours += Number(l.total_hours ?? 0);
        acc.cost += Number(l.total_cost ?? 0);
        labourByTask.set(l.work_task_id, acc);
      });

      const segsByEntry = new Map<string, SegmentLite[]>();
      segments.forEach((s) => {
        if (!s.pruning_entry_id) return;
        const list = segsByEntry.get(s.pruning_entry_id);
        if (list) list.push(s);
        else segsByEntry.set(s.pruning_entry_id, [s]);
      });

      return entries.map((e) => {
        const season = seasonById.get(e.pruning_season_id) ?? null;
        const paddock = paddockById.get(e.paddock_id) ?? null;
        const allocations = parseVarietyAllocations(paddock?.variety_allocations);
        const variety = allocations
          .map((a) => a.variety)
          .filter((v): v is string => !!v)
          .join(", ") || "—";

        const segs = segsByEntry.get(e.id) ?? [];
        const rowNumbers = Array.from(new Set(segs.map((s) => Number(s.row_number))))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);

        const labourHours =
          e.labour_hours == null ? null : Number(e.labour_hours) || 0;
        const vines = Number(e.estimated_vines_completed ?? 0);
        const rowEq = Number(e.row_equivalents_completed ?? 0);

        const task = e.work_task_id ? taskById.get(e.work_task_id) ?? null : null;
        const taskLabour = e.work_task_id ? labourByTask.get(e.work_task_id) ?? null : null;
        const labourCost = taskLabour ? taskLabour.cost : null;
        const rateHours = labourHours && labourHours > 0
          ? labourHours
          : taskLabour && taskLabour.hours > 0 ? taskLabour.hours : null;

        return {
          id: e.id,
          entry: e,
          date: e.entry_date,
          seasonYear: season?.season_year ?? null,
          vintageYear: e.vintage_year ?? null,
          paddockId: e.paddock_id,
          blockName: paddock?.name ?? "—",
          variety,
          worker: e.worker_or_crew?.trim() || "—",
          method: e.pruning_method || "—",
          rowNumbers,
          rowsLabel: formatRowRanges(rowNumbers),
          rowCount: rowNumbers.length,
          quarters: segs.length,
          rowEquivalents: rowEq,
          vines,
          labourHours,
          startTime: e.start_time,
          finishTime: e.finish_time,
          vinesPerHour: labourHours && labourHours > 0 ? vines / labourHours : null,
          rowEqPerHour: labourHours && labourHours > 0 ? rowEq / labourHours : null,
          workTaskId: e.work_task_id,
          workTaskLabel: task
            ? (task.task_type?.trim() || task.description?.trim() || "Work Task")
            : e.work_task_id ? "Work Task" : null,
          labourCost,
          hourlyRate: labourCost != null && rateHours ? labourCost / rateHours : null,
          notes: e.notes ?? "",
          isReversed: !!e.deleted_at,
        } satisfies PruningActivityRow;
      });
    },
  });
}
