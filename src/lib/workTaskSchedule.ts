// Work Task scheduling basis (shared schema: work_tasks.schedule_basis / target_el_stage).
//
//   schedule_basis = 'date'      → Work Date / Range (start_date/end_date), unchanged behaviour.
//   schedule_basis = 'el_stage'  → scheduled by target E-L growth stage (1..43).
//
// For E-L tasks the legacy `date` column is a NOT NULL compatibility anchor
// only (defaults to the creation instant). It is never shown or used as a
// scheduled/actual work date. Once completed, the actual business date comes
// from the completion contract (end_date → completed_at → finalized_at, in the
// vineyard's local calendar).
import type { WorkTask } from "./workTasksQuery";
import { GROWTH_STAGES } from "./vspWaterRate";
import { calendarDate, displayCompletedDate, isWorkTaskCompleted } from "./workTaskCompletion";

export type ScheduleBasis = "date" | "el_stage";
export const EL_TARGET_MIN = 1;
export const EL_TARGET_MAX = 43;

type SchedFields = Pick<WorkTask, "schedule_basis" | "target_el_stage">;

export const scheduleBasisOf = (t: Partial<SchedFields> | null | undefined): ScheduleBasis =>
  t?.schedule_basis === "el_stage" ? "el_stage" : "date";

export const isElScheduled = (t: Partial<SchedFields> | null | undefined) => scheduleBasisOf(t) === "el_stage";

/** Canonical E-L stages (same list as Growth Stage records) limited to 1..43. */
export const EL_TARGET_OPTIONS: { value: number; label: string }[] = GROWTH_STAGES
  .map((g) => ({ value: Number(g.code.replace(/^EL/i, "")), desc: g.label.split(" — ").slice(1).join(" — ") }))
  .filter((g) => Number.isInteger(g.value) && g.value >= EL_TARGET_MIN && g.value <= EL_TARGET_MAX)
  .map((g) => ({ value: g.value, label: formatElStage(g.value, g.desc) }));

function formatElStage(n: number, desc?: string | null) {
  const nn = String(n).padStart(2, "0");
  return desc ? `E-L ${nn} — ${desc}` : `E-L ${nn}`;
}

/** "E-L 23 — 50% caps off" from the canonical list; bare "E-L NN" if unlabeled. */
export function elStageLabel(n: number | null | undefined): string | null {
  if (n == null || !Number.isInteger(n)) return null;
  return EL_TARGET_OPTIONS.find((o) => o.value === n)?.label ?? formatElStage(n);
}

export function validateSchedule(basis: ScheduleBasis, startDate: string, el: number | null): string | null {
  if (basis === "el_stage") {
    if (el == null || !Number.isInteger(el) || el < EL_TARGET_MIN || el > EL_TARGET_MAX) return "Choose a target E-L growth stage.";
    return null;
  }
  return startDate ? null : "Task date is required. Please choose a date before creating the task.";
}

/**
 * Schedule part of a save payload. E-L mode explicitly clears the obsolete
 * planned start_date and never sends a user Work Date; `date` is left to the
 * existing stored value (edit) or the database default (create). end_date is a
 * completion field and is never touched here.
 */
export function schedulePayload(basis: ScheduleBasis, startDate: string, el: number | null, existingDate?: string | null) {
  if (basis === "el_stage") {
    return { schedule_basis: "el_stage" as const, target_el_stage: el, start_date: null, date: existingDate ?? undefined };
  }
  return { schedule_basis: "date" as const, target_el_stage: null, start_date: startDate || null, date: startDate || existingDate || null };
}

/**
 * Date bounds for filtering/sorting/export. Pending E-L tasks have NO date
 * (never the legacy anchor); completed E-L tasks use the actual completion day.
 */
export function workTaskDateBounds(
  t: WorkTask, timeZone?: string | null,
): { start: string | null; end: string | null } {
  if (isElScheduled(t)) {
    const d = isWorkTaskCompleted(t) ? displayCompletedDate(t, timeZone) : null;
    return { start: d, end: d };
  }
  const start = t.start_date ?? t.date ?? null;
  return { start, end: t.end_date ?? start };
}

/** Table cell model for the Date / Range column. */
export function scheduleCell(t: WorkTask, timeZone?: string | null): { stage: string | null; date: string | null; endDate: string | null } {
  if (isElScheduled(t)) {
    return { stage: elStageLabel(t.target_el_stage ?? null) ?? "E-L stage", date: isWorkTaskCompleted(t) ? displayCompletedDate(t, timeZone) : null, endDate: null };
  }
  const s = calendarDate(t.start_date ?? t.date ?? null);
  const e = isWorkTaskCompleted(t) ? displayCompletedDate(t, timeZone) : calendarDate(t.end_date ?? null);
  return { stage: null, date: s ?? e, endDate: s && e && s !== e ? e : null };
}
