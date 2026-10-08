// Work Task completion contract (Portal / iOS / Android).
//
//   is_finalized   → source of truth: false = To do, true = Completed
//   start_date     → Work Date (never changed by completion)
//   end_date       → business Completed Date (user-chosen, may be backdated)
//   finalized_at   → audit timestamp of the actual Complete press
//   finalized_by   → user who pressed Complete
//
// The legacy `status` column is never used as the visible completion state.
import type { WorkTask } from "./workTasksQuery";

export type WorkTaskCompletionState = "completed" | "todo";

export const isWorkTaskCompleted = (t: Pick<WorkTask, "is_finalized">): boolean =>
  t.is_finalized === true;

export const completionState = (t: Pick<WorkTask, "is_finalized">): WorkTaskCompletionState =>
  isWorkTaskCompleted(t) ? "completed" : "todo";

export const completionLabel = (t: Pick<WorkTask, "is_finalized">): string =>
  isWorkTaskCompleted(t) ? "Completed" : "To do";

/**
 * Business calendar date (YYYY-MM-DD) of a stored work date. These fields are
 * vineyard calendar dates, so the leading date component is kept verbatim —
 * never timezone-converted. Returns null for anything that isn't a date.
 */
export function calendarDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Planned Work Date. E-L scheduled tasks have none (legacy `date` is only an anchor). */
export const workDateOf = (t: Pick<WorkTask, "start_date" | "date"> & { schedule_basis?: string | null }): string | null =>
  t.schedule_basis === "el_stage" ? calendarDate(t.start_date ?? null) : calendarDate(t.start_date ?? t.date ?? null);

/** Calendar date (YYYY-MM-DD) of an instant in the given time zone. */
export function localDateOf(iso: string, timeZone?: string | null): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export const todayLocal = (timeZone?: string | null, now: Date = new Date()): string =>
  localDateOf(now.toISOString(), timeZone) ?? now.toISOString().slice(0, 10);

/**
 * User-facing Completed Date: end_date → local date of completed_at → finalized_at → null.
 * Only meaningful for completed tasks; never invents a date.
 */
export function displayCompletedDate(
  t: Pick<WorkTask, "is_finalized" | "end_date" | "finalized_at"> & { completed_at?: string | null },
  timeZone?: string | null,
): string | null {
  if (!isWorkTaskCompleted(t)) return null;
  const end = calendarDate(t.end_date);
  if (end) return end;
  // completed_at / finalized_at are real instants → vineyard-local calendar day.
  if (t.completed_at) return localDateOf(t.completed_at, timeZone);
  // finalized_at is a real instant → vineyard-local calendar day.
  if (t.finalized_at) return localDateOf(t.finalized_at, timeZone);
  return null;
}

/** Returns an error message, or null when the Completed Date is valid. */
export function validateCompletedDate(
  completedDate: string,
  workDate: string | null,
  today: string,
): string | null {
  const c = calendarDate(completedDate);
  const w = calendarDate(workDate);
  const t = calendarDate(today) ?? today;
  if (!c) return "Choose a Completed Date.";
  if (w && c < w) return "Completed Date cannot be before the Work Date.";
  if (c > t) return "Completed Date cannot be in the future.";
  return null;
}

/** Payload for the explicit Complete action. */
export const completePayload = (completedDate: string, userId: string | null, nowIso: string) => ({
  is_finalized: true,
  end_date: completedDate,
  finalized_at: nowIso,
  finalized_by: userId,
  // Shared completion identity: the authenticated user who explicitly completed it.
  completed_by: userId,
  completed_at: nowIso,
});

/** Payload for Reopen. Clears completion identity; assigned_to is never touched. */
export const reopenPayload = () => ({
  is_finalized: false,
  end_date: null,
  finalized_at: null,
  finalized_by: null,
  completed_by: null,
  completed_at: null,
});

/** Payload for correcting the Completed Date; audit fields are untouched. */
export const completedDatePayload = (completedDate: string) => ({
  is_finalized: true,
  end_date: completedDate,
});


export type CompletedBySource = "completed_by" | "trip_operator" | "finalized_by" | "unknown";

/**
 * Who completed a task, in trust order:
 *   completed_by → the single, same-vineyard linked trip operator (historical,
 *   only when unambiguous) → finalized_by (the user who pressed Complete) → unknown.
 * Never uses assigned_to, updated_by, person_name or spray created_by.
 */
export function resolveCompletedBy(
  t: Pick<WorkTask, "is_finalized" | "completed_by" | "finalized_by" | "vineyard_id">,
  linkedTrips: ReadonlyArray<{ vineyard_id?: string | null; operator_user_id?: string | null }> = [],
): { userId: string | null; source: CompletedBySource } {
  if (!isWorkTaskCompleted(t)) return { userId: null, source: "unknown" };
  if (t.completed_by) return { userId: t.completed_by, source: "completed_by" };
  if (linkedTrips.length > 0) {
    const sameVineyard = linkedTrips.every((tr) => !t.vineyard_id || tr.vineyard_id === t.vineyard_id);
    const ids = new Set(linkedTrips.map((tr) => tr.operator_user_id ?? ""));
    if (sameVineyard && ids.size === 1 && !ids.has("")) {
      return { userId: [...ids][0], source: "trip_operator" };
    }
  }
  if (t.finalized_by) return { userId: t.finalized_by, source: "finalized_by" };
  return { userId: null, source: "unknown" };
}

/** Table cell text for the Assigned to column. */
export function assignmentCellLabel(
  t: Pick<WorkTask, "is_finalized" | "completed_by" | "finalized_by" | "vineyard_id" | "assigned_to"> & { assigned_external_resource_id?: string | null },
  linkedTrips: ReadonlyArray<{ vineyard_id?: string | null; operator_user_id?: string | null }>,
  nameOf: (userId: string) => string | null,
  externalNameOf: (id: string) => string | null = () => null,
): string {
  if (isWorkTaskCompleted(t)) {
    const { userId } = resolveCompletedBy(t, linkedTrips);
    const name = userId ? nameOf(userId) : null;
    return `Completed by ${name || "unknown"}`;
  }
  if (t.assigned_external_resource_id) return externalNameOf(t.assigned_external_resource_id) || "Unknown crew / contractor";
  return t.assigned_to ? nameOf(t.assigned_to) || "Unknown member" : "Unassigned";
}

/** Single shared bright, accessible green for every Work Task "Completed" badge (list + details). */
export const COMPLETED_BADGE_CLASS = "border-transparent bg-success text-success-foreground hover:bg-success/90 font-semibold";
