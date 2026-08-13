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
//  - Costs come from the canonical task labour cost helper (SQL 188):
//    piece_rate tasks use work_tasks.piece_rate_total_cost, all other tasks
//    sum work_task_labour_lines.total_cost. The two are NEVER added.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { parseVarietyAllocations } from "@/lib/paddockGeometry";
import type { PruningEntry } from "@/lib/pruningQuery";
import { allocateActivityShares } from "@/lib/pruningActivityAllocation";
import { taskLabourCost } from "@/lib/pieceRateCosting";

export interface PruningActivityRow {
  id: string;
  entry: PruningEntry;
  /** SQL 166 parent activity id, when this entry belongs to one. */
  activityId: string | null;
  date: string;                 // ISO yyyy-mm-dd
  /** Canonical season year: ALWAYS the linked pruning_seasons row. Null when
   *  the entry has no resolvable season link — never derived from the date. */
  seasonYear: number | null;
  /** Season id stored on the entry (may point at a missing/foreign season). */
  pruningSeasonId: string | null;
  /** True when a pruning_seasons row was found for pruningSeasonId. */
  hasSeasonLink: boolean;
  /** Season year we would expect for this entry (calendar year of the work).
   *  Used ONLY to flag integrity problems, never to display the season. */
  expectedSeasonYear: number | null;
  /** Human-readable reasons the stored season data looks inconsistent. */
  seasonIssues: string[];
  seasonMismatch: boolean;
  /** Best-effort platform metadata if the backend records it. */
  sourcePlatform: string | null;
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
  /** True when work_task_id points at a task that no longer exists. */
  workTaskMissing: boolean;
  /** Title/description stored on the parent pruning activity, when present. */
  activityTitle: string | null;
  labourCost: number | null;    // null when there is no linked Work Task
  hourlyRate: number | null;    // labour cost / labour hours
  notes: string;

  /** auth.users id of the user who recorded the entry (pruning_entries.created_by). */
  createdById: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isReversed: boolean;
  /** SQL 168: quarters marked skipped, not pruned. Excluded from labour,
   *  cost, vines-pruned and productivity everywhere in the portal. */
  isSkipped: boolean;

  // ---- Parent-activity grouping (SQL 166) ----
  /** Stable grouping key: the parent activity id, or the entry id for legacy rows. */
  groupKey: string;
  /** How many allocations (blocks) the parent activity has. */
  activityBlockCount: number;
  /** 1-based index of this allocation inside its parent activity. */
  allocationIndex: number;
  /** True for the allocation that carries the activity-total display. */
  isPrimaryAllocation: boolean;
  /** Share of the activity's total row equivalents (0–1). */
  allocationShare: number;
  /** Informational labour hours allocated to this block. */
  allocatedHours: number;
  /** Informational labour cost allocated to this block. */
  allocatedCost: number | null;
  /** Parent activity labour hours (same on every allocation of the activity). */
  activityHours: number | null;
  /** Parent activity labour cost (same on every allocation of the activity). */
  activityCost: number | null;
  /** Meaningful, user-facing label for the activity — never an identifier. */
  activityLabel: string;
  /** Where activityLabel came from, so the UI can badge it. */
  activityLabelKind: "task" | "activity" | "generated" | "none" | "unavailable";

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

/** Calendar year the pruning work was performed — the canonical season year
 *  rule shared with iOS/Android. Used only to DETECT integrity problems. */
export function expectedSeasonYearForDate(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const y = Number(String(isoDate).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

/** Best-effort platform metadata; the backend may not record it yet. */
function readPlatform(row: any): string | null {
  const v =
    row?.source_platform ?? row?.created_platform ?? row?.platform ??
    row?.created_via ?? row?.device_platform ?? null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

interface PaddockLite { id: string; name: string | null; variety_allocations: any }
interface SegmentLite { pruning_entry_id: string | null; row_number: number; segment_number: number }
interface TaskLite {
  id: string; task_type: string | null; description: string | null; status: string | null;
  costing_method?: string | null;
  piece_rate_per_vine?: number | string | null;
  piece_vine_count?: number | null;
  piece_rate_total_cost?: number | string | null;
}
interface LabourLite { work_task_id: string; total_hours: number | null; total_cost: number | null }

/** A report row before the parent-activity allocation pass runs. */
export type BaseActivityRow = Omit<
  PruningActivityRow,
  | "groupKey" | "activityBlockCount" | "allocationIndex" | "isPrimaryAllocation"
  | "allocationShare" | "allocatedHours" | "allocatedCost"
  | "activityHours" | "activityCost" | "activityLabel" | "activityLabelKind"
>;

/**
 * Resolves the user-facing activity label for one parent activity's rows.
 * Never returns an identifier or a date — the table already has a Date column.
 * Priority: linked Work Task title, stored activity title, then "Pruning".
 */
export function resolveActivityLabel(members: BaseActivityRow[]): {
  activityLabel: string;
  activityLabelKind: PruningActivityRow["activityLabelKind"];
} {
  const first = members[0];
  if (!first) return { activityLabel: "Not linked", activityLabelKind: "none" };

  // SQL 168: skipped work is never labour — it always reads as "Skipped".
  if (members.every((r) => r.isSkipped)) {
    return { activityLabel: "Skipped", activityLabelKind: "generated" };
  }

  const taskRow = members.find((r) => r.workTaskId && !r.workTaskMissing && r.workTaskLabel);
  if (taskRow) return { activityLabel: taskRow.workTaskLabel!, activityLabelKind: "task" };

  const titled = members.find((r) => r.activityTitle && r.activityTitle.trim());
  if (titled) return { activityLabel: titled.activityTitle!.trim(), activityLabelKind: "activity" };

  const deleted = members.find((r) => r.workTaskMissing);
  if (deleted && !first.activityId) {
    return { activityLabel: "Deleted work task", activityLabelKind: "unavailable" };
  }

  if (first.activityId) {
    return { activityLabel: "Pruning", activityLabelKind: "generated" };
  }
  if (deleted) return { activityLabel: "Deleted work task", activityLabelKind: "unavailable" };
  return { activityLabel: "Pruning", activityLabelKind: "generated" };
}




/**
 * Groups allocations by parent activity and splits the parent's labour hours
 * and labour cost across the blocks by share of row equivalents. The parent
 * totals are attached to every allocation but flagged so the report renders
 * them once only (on the primary allocation).
 */
export function applyActivityAllocations(baseRows: BaseActivityRow[]): PruningActivityRow[] {
  const groups = new Map<string, BaseActivityRow[]>();
  baseRows.forEach((r) => {
    const key = r.activityId ?? `entry:${r.id}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  });

  const byId = new Map<string, PruningActivityRow>();

  groups.forEach((members, groupKey) => {
    // Order allocations deterministically so "primary" is stable.
    const ordered = [...members].sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id),
    );

    // The parent activity carries the labour; on SQL 166 activities only one
    // allocation row stores it, so summing recovers the parent total and stays
    // correct for legacy single-entry rows.
    const activityHours = ordered.some((r) => r.labourHours != null)
      ? ordered.reduce((s, r) => s + (r.labourHours ?? 0), 0)
      : null;
    const costRows = ordered.filter((r) => r.labourCost != null);
    // A single Work Task shared by every allocation must not be counted twice.
    const seenTasks = new Set<string>();
    let activityCost: number | null = null;
    costRows.forEach((r) => {
      const key = r.workTaskId ?? `row:${r.id}`;
      if (seenTasks.has(key)) return;
      seenTasks.add(key);
      activityCost = (activityCost ?? 0) + (r.labourCost ?? 0);
    });

    const split = allocateActivityShares(
      ordered.map((r) => ({
        id: r.id,
        rowEquivalents: r.rowEquivalents,
        serverShare: (r.entry as any)?.allocation_share_of_row_equivalents ?? null,
        serverHours: (r.entry as any)?.allocation_share_labour_hours_informational ?? null,
      })),
      activityHours,
      activityCost,
    );
    const splitById = new Map(split.map((s) => [s.id, s]));
    const { activityLabel, activityLabelKind } = resolveActivityLabel(ordered);

    ordered.forEach((r, i) => {
      const s = splitById.get(r.id);
      byId.set(r.id, {
        ...r,
        activityLabel,
        activityLabelKind,
        groupKey,
        activityBlockCount: ordered.length,
        allocationIndex: i + 1,

        isPrimaryAllocation: i === 0,
        allocationShare: s?.share ?? 1,
        allocatedHours: s?.hours ?? 0,
        allocatedCost: activityCost == null ? null : s?.cost ?? 0,
        activityHours,
        activityCost,
      });
    });
  });

  // Preserve the original ordering of the query result.
  return baseRows.map((r) => byId.get(r.id)!).filter(Boolean);
}



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
          supabase.from("work_tasks").select("id, task_type, description, status, costing_method, piece_rate_per_vine, piece_vine_count, piece_rate_total_cost")
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

      const baseRows = entries.map((e) => {
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

        const isSkipped = (e as any).is_skipped === true;
        const labourHours = isSkipped
          ? null
          : e.labour_hours == null ? null : Number(e.labour_hours) || 0;
        const vines = isSkipped ? 0 : Number(e.estimated_vines_completed ?? 0);
        const rowEq = Number(e.row_equivalents_completed ?? 0);

        const task = e.work_task_id ? taskById.get(e.work_task_id) ?? null : null;
        const taskLabour = e.work_task_id ? labourByTask.get(e.work_task_id) ?? null : null;
        // Canonical task labour cost (SQL 188): piece-rate snapshot OR labour
        // lines — never the sum of both.
        const canonicalCost = task
          ? taskLabourCost(task, taskLabour ? taskLabour.cost : null)
          : null;
        const labourCost = isSkipped ? null : canonicalCost;
        const rateHours = labourHours && labourHours > 0
          ? labourHours
          : taskLabour && taskLabour.hours > 0 ? taskLabour.hours : null;

        const seasonYear = season?.season_year ?? null;
        const expectedSeasonYear = expectedSeasonYearForDate(e.entry_date);
        const seasonIssues: string[] = [];
        if (season) {
          if (season.paddock_id && season.paddock_id !== e.paddock_id) {
            seasonIssues.push("Linked pruning season belongs to a different block.");
          }
          if (seasonYear != null && expectedSeasonYear != null && seasonYear !== expectedSeasonYear) {
            seasonIssues.push(
              `Linked season year ${seasonYear} does not match the year the work was recorded (${expectedSeasonYear}).`,
            );
          }
          if (
            seasonYear != null && e.vintage_year != null &&
            e.vintage_year !== seasonYear && e.vintage_year !== seasonYear + 1
          ) {
            seasonIssues.push(
              `Stored vintage ${e.vintage_year} is not consistent with season ${seasonYear}.`,
            );
          }
        }

        return {
          id: e.id,
          entry: e,
          activityId: (e as any).pruning_activity_id ?? null,
          date: e.entry_date,
          seasonYear,
          pruningSeasonId: e.pruning_season_id ?? null,
          hasSeasonLink: !!season,
          expectedSeasonYear,
          seasonIssues,
          seasonMismatch: seasonIssues.length > 0,
          sourcePlatform: readPlatform(e),
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
          durationMinutes: durationMinutesBetween(e.start_time, e.finish_time),
          vinesPerHour: labourHours && labourHours > 0 ? vines / labourHours : null,
          rowEqPerHour: labourHours && labourHours > 0 ? rowEq / labourHours : null,
          workTaskId: e.work_task_id,
          workTaskLabel: task
            ? (task.task_type?.trim() || task.description?.trim() || "Work Task")
            : e.work_task_id ? "Deleted work task" : null,
          workTaskStatus: task?.status ?? null,
          workTaskMissing: !!e.work_task_id && !task,
          activityTitle:
            (e as any).activity_title ?? (e as any).activity_name ??
            (e as any).activity_description ?? (e as any).title ?? null,

          labourCost,
          hourlyRate: labourCost != null && rateHours ? labourCost / rateHours : null,
          notes: e.notes ?? "",
          createdById: e.created_by ?? null,
          createdAt: e.created_at ?? null,
          updatedAt: e.updated_at ?? null,
          isReversed: !!e.deleted_at,
          isSkipped,
        } satisfies BaseActivityRow;
      });

      return applyActivityAllocations(baseRows);
    },

  });
}
