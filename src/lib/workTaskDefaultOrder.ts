import type { WorkTask } from "@/lib/workTasksQuery";
import { calendarDate, isWorkTaskCompleted } from "@/lib/workTaskCompletion";
import { isElScheduled, workTaskDateBounds } from "@/lib/workTaskSchedule";

/** Vineyard-local calendar day (YYYY-MM-DD) for `now`. */
export function localToday(timeZone?: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Default Work Tasks order (used only when no column sort is selected):
 * 1. To do before Completed (canonical is_finalized; there are no other statuses).
 * 2. E-L-scheduled before date-scheduled; E-L by numeric target stage, highest first.
 * 3. Date tasks by planned work date: To do = upcoming nearest first, then past
 *    (most recent first), then undated; Completed = most recent first.
 *    The hidden compatibility date is never used for E-L tasks.
 * 4. Ties: task id, so the order is deterministic.
 */
export function sortWorkTasksDefault<T extends WorkTask>(tasks: T[], timeZone?: string | null, now: Date = new Date()): T[] {
  const today = localToday(timeZone, now);
  const key = (t: T) => {
    const done = isWorkTaskCompleted(t);
    if (isElScheduled(t)) {
      const n = Number(t.target_el_stage);
      return { done, el: true, n: Number.isFinite(n) ? n : -Infinity, date: null as string | null };
    }
    const start = workTaskDateBounds(t, timeZone).start;
    return { done, el: false, n: 0, date: calendarDate(start) };
  };
  const dec = tasks.map((t) => ({ t, k: key(t) }));
  dec.sort((a, b) => {
    if (a.k.done !== b.k.done) return a.k.done ? 1 : -1;
    if (a.k.el !== b.k.el) return a.k.el ? -1 : 1;
    if (a.k.el) {
      if (a.k.n !== b.k.n) return b.k.n - a.k.n;
    } else {
      const ad = a.k.date, bd = b.k.date;
      if (ad !== bd) {
        if (!ad) return 1;
        if (!bd) return -1;
        if (a.k.done) return bd.localeCompare(ad);
        const au = ad >= today, bu = bd >= today;
        if (au !== bu) return au ? -1 : 1;
        return au ? ad.localeCompare(bd) : bd.localeCompare(ad);
      }
    }
    return String(a.t.id).localeCompare(String(b.t.id));
  });
  return dec.map((d) => d.t);
}
