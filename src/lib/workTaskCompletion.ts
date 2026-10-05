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

export const workDateOf = (t: Pick<WorkTask, "start_date" | "date">): string | null =>
  calendarDate(t.start_date ?? t.date ?? null);

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
 * User-facing Completed Date: end_date → local date of finalized_at → null.
 * Only meaningful for completed tasks; never invents a date.
 */
export function displayCompletedDate(
  t: Pick<WorkTask, "is_finalized" | "end_date" | "finalized_at">,
  timeZone?: string | null,
): string | null {
  if (!isWorkTaskCompleted(t)) return null;
  const end = calendarDate(t.end_date);
  if (end) return end;
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
  if (!completedDate) return "Choose a Completed Date.";
  if (workDate && completedDate < workDate) return "Completed Date cannot be before the Work Date.";
  if (completedDate > today) return "Completed Date cannot be in the future.";
  return null;
}

/** Payload for the explicit Complete action. */
export const completePayload = (completedDate: string, userId: string | null, nowIso: string) => ({
  is_finalized: true,
  end_date: completedDate,
  finalized_at: nowIso,
  finalized_by: userId,
});

/** Payload for Reopen. */
export const reopenPayload = () => ({
  is_finalized: false,
  end_date: null,
  finalized_at: null,
  finalized_by: null,
});

/** Payload for correcting the Completed Date; audit fields are untouched. */
export const completedDatePayload = (completedDate: string) => ({
  is_finalized: true,
  end_date: completedDate,
});
