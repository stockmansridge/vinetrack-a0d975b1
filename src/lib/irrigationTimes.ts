// Irrigation Records — SQL 130 start/end time support.
//
// TIMEZONE POLICY
// ---------------
// The portal has no per-vineyard IANA timezone field today, so all irrigation
// wall-clock times are interpreted in the BROWSER'S LOCAL TIMEZONE and sent to
// the backend as offset-qualified ISO 8601 strings (e.g.
// `2026-11-14T22:00:00+11:00`). We never append `Z` to a naive local datetime
// and we never parse a local clock time as UTC. The offset is derived from the
// actual constructed local Date, so daylight-saving transitions resolve to the
// offset in force on that calendar day and the selected wall-clock time is
// preserved exactly.
//
// Duration is always derived from the two absolute timestamps (rounded to whole
// minutes) so the portal and the backend agree on `p_duration_minutes`.

/** Backend cap: seven days. */
export const MAX_DURATION_MINUTES = 10_080;

export const TIME_ERRORS = {
  equal: "End time must be different from start time.",
  zero: "Irrigation duration must be greater than zero.",
  endWithoutStart: "End time requires a start time.",
  mismatch: "Duration does not match the selected start and end times.",
  tooLong: "Irrigation duration cannot exceed seven days.",
  badStart: "Enter a valid start time.",
  badEnd: "Enter a valid end time.",
} as const;

/** `HH:MM` (24h, from `<input type="time">`) → minutes since midnight. */
export function parseClockTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** Local Date for `YYYY-MM-DD` + minutes-since-midnight, `dayOffset` days later. */
export function localDateTime(
  isoDate: string,
  minutesSinceMidnight: number,
  dayOffset = 0,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]) + dayOffset,
    Math.floor(minutesSinceMidnight / 60),
    minutesSinceMidnight % 60,
    0,
    0,
  );
  return isNaN(d.getTime()) ? null : d;
}

/**
 * ISO 8601 with the local UTC offset in force at that instant — never `Z`,
 * never a naive string.
 */
export function toOffsetISOString(d: Date): string {
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** An absolute timestamp → the local `HH:MM` clock value for a time input. */
export function clockValueFromISO(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An absolute timestamp → the local `YYYY-MM-DD` date. */
export function dateValueFromISO(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface SessionTimeResult {
  /** Absolute ISO timestamp for the start, or null when no start entered. */
  startedAt: string | null;
  /** Absolute ISO timestamp for the finish, or null. */
  finishedAt: string | null;
  /** Whole minutes between start and finish — authoritative when both set. */
  durationMinutes: number | null;
  /** True when the finish falls on the day after the session date. */
  overnight: boolean;
  /** Blocking validation message, if any. */
  error: string | null;
  /** Local Date for the calculated finish (used for helper text). */
  finishDate: Date | null;
}

/**
 * Resolve start/end clock entries against the session date.
 *
 * - Both times: end <= start rolls to the following day (equal is rejected),
 *   and the duration is calculated and authoritative.
 * - Start only: duration stays user-controlled; `finishDate` is the calculated
 *   finish used for helper text only.
 */
export function resolveSessionTimes(input: {
  sessionDate: string;
  startTime: string;
  endTime: string;
  /** Manually entered duration, used only when end time is blank. */
  durationMinutes?: number | null;
}): SessionTimeResult {
  const empty: SessionTimeResult = {
    startedAt: null,
    finishedAt: null,
    durationMinutes: null,
    overnight: false,
    error: null,
    finishDate: null,
  };

  const hasStart = input.startTime.trim() !== "";
  const hasEnd = input.endTime.trim() !== "";

  if (!hasStart && !hasEnd) return empty;
  if (!hasStart && hasEnd) return { ...empty, error: TIME_ERRORS.endWithoutStart };

  const startMins = parseClockTime(input.startTime);
  if (startMins == null) return { ...empty, error: TIME_ERRORS.badStart };

  const start = localDateTime(input.sessionDate, startMins);
  if (!start) return { ...empty, error: TIME_ERRORS.badStart };
  const startedAt = toOffsetISOString(start);

  if (!hasEnd) {
    // Start + duration: the finish is helper text only, never submitted.
    const mins = input.durationMinutes ?? null;
    let finishDate: Date | null = null;
    if (mins != null && Number.isFinite(mins) && mins > 0) {
      finishDate = new Date(start.getTime() + mins * 60_000);
    }
    return {
      startedAt,
      finishedAt: null,
      durationMinutes: mins,
      overnight: !!finishDate && finishDate.getDate() !== start.getDate(),
      error: null,
      finishDate,
    };
  }

  const endMins = parseClockTime(input.endTime);
  if (endMins == null) return { ...empty, startedAt, error: TIME_ERRORS.badEnd };
  if (endMins === startMins) {
    return { ...empty, startedAt, error: TIME_ERRORS.equal };
  }

  const overnight = endMins < startMins;
  const finish = localDateTime(input.sessionDate, endMins, overnight ? 1 : 0);
  if (!finish) return { ...empty, startedAt, error: TIME_ERRORS.badEnd };

  const durationMinutes = Math.round((finish.getTime() - start.getTime()) / 60_000);
  if (durationMinutes <= 0) return { ...empty, startedAt, error: TIME_ERRORS.zero };
  if (durationMinutes > MAX_DURATION_MINUTES) {
    return { ...empty, startedAt, error: TIME_ERRORS.tooLong };
  }

  return {
    startedAt,
    finishedAt: toOffsetISOString(finish),
    durationMinutes,
    overnight,
    error: null,
    finishDate: finish,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** `8:30 am` in the browser's local timezone. */
export function formatClock(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(/\s?([AP])M/i, (_x, p) => ` ${String(p).toLowerCase()}m`);
}

/** `8:30 am, 14 November 2026`. */
export function formatClockWithDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${formatClock(d)}, ${date}`;
}

/** True when the finish lands on a later calendar day than the start. */
export function isNextDay(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): boolean {
  if (!startedAt || !finishedAt) return false;
  const a = new Date(startedAt);
  const b = new Date(finishedAt);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

/** `8:30 am–11:45 am` or `10:00 pm–2:00 am next day`. Empty when no times. */
export function formatTimeRange(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): string {
  if (!startedAt || !finishedAt) return "";
  const range = `${formatClock(startedAt)}–${formatClock(finishedAt)}`;
  return isNextDay(startedAt, finishedAt) ? `${range} next day` : range;
}
