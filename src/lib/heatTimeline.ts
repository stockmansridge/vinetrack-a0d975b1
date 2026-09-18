// Ripeness Heatmap timeline logic — pure, so the slider, markers, previous /
// next buttons and playback can never become disconnected: they all resolve
// through these helpers against one list of observation dates.

const dayKey = (iso: string) => String(iso).slice(0, 10);
const toMs = (day: string) => Date.parse(`${dayKey(day)}T00:00:00Z`);

/** Resolve the currently displayed date: the selection when it still exists in
 *  the list, otherwise the latest available date (null when there are none). */
export function resolveSelectedDay(days: string[], selected: string | null): string | null {
  if (!days.length) return null;
  if (selected && days.includes(selected)) return selected;
  return days[days.length - 1];
}

/** Snap an arbitrary date to the nearest available observation date. */
export function snapToNearestDay(days: string[], target: string): string | null {
  if (!days.length) return null;
  const t = toMs(target);
  if (!Number.isFinite(t)) return days[days.length - 1];
  let best = days[0];
  let bestDist = Infinity;
  for (const d of days) {
    const dist = Math.abs(toMs(d) - t);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** Clamp a slider index to a real observation date. */
export function dayAtIndex(days: string[], index: number): string | null {
  if (!days.length) return null;
  const i = Math.max(0, Math.min(days.length - 1, Math.round(index)));
  return days[i];
}

export function dayIndex(days: string[], day: string | null): number {
  if (!day) return Math.max(0, days.length - 1);
  const i = days.indexOf(day);
  return i >= 0 ? i : Math.max(0, days.length - 1);
}

/** Previous / next observation date. Returns the current date at the ends. */
export function stepDay(days: string[], current: string | null, dir: 1 | -1): string | null {
  const cur = resolveSelectedDay(days, current);
  if (!cur) return null;
  const i = days.indexOf(cur);
  const next = i + dir;
  if (next < 0 || next > days.length - 1) return cur;
  return days[next];
}

/** One playback tick. Playback stops at the latest available date. */
export function advancePlayback(
  days: string[],
  current: string | null,
): { day: string | null; playing: boolean } {
  const cur = resolveSelectedDay(days, current);
  if (!cur) return { day: null, playing: false };
  const i = days.indexOf(cur);
  if (i >= days.length - 1) return { day: cur, playing: false };
  return { day: days[i + 1], playing: true };
}

/** Where playback should begin — restart from the first date when the latest
 *  date is already displayed. */
export function playbackStartDay(days: string[], current: string | null): string | null {
  const cur = resolveSelectedDay(days, current);
  if (!cur || days.length < 2) return cur;
  return days.indexOf(cur) >= days.length - 1 ? days[0] : cur;
}

/** Marker / slider position as a percentage across the timeline. */
export function dayOffsetPct(days: string[], day: string): number {
  const i = days.indexOf(day);
  if (i < 0 || days.length < 2) return 0;
  return (i / (days.length - 1)) * 100;
}
