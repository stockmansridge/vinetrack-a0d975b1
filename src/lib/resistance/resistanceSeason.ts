// Stage 3C — seasons. Port of `ResistanceSeason.swift`.
//
// Australian viticulture runs across the new year. Counting "applications this
// season" by calendar year would reset every seasonal maximum on 31 December,
// mid-canopy — the easiest way to silently licence a rotation the strategy
// forbids. VineTrack already stores a shared per-vineyard season start
// (month/day, sql/108); this is the domain abstraction over that setting and
// adds no database column.

export interface ResistanceSeason {
  /** Display and comparison identity, e.g. `"2026/27"`. */
  id: string;
  startYear: number;
  startEpochMs: number;
  /** Exclusive: the instant the following season begins. */
  endEpochMs: number;
}

export const seasonContains = (season: ResistanceSeason, epochMs: number): boolean =>
  epochMs >= season.startEpochMs && epochMs < season.endEpochMs;

/** `2026` -> `"2026/27"`. */
export function seasonIdForStartYear(startYear: number): string {
  const tail = String(((startYear + 1) % 100 + 100) % 100).padStart(2, "0");
  return `${startYear}/${tail}`;
}

export const DEFAULT_SEASON_START_MONTH = 7;
export const DEFAULT_SEASON_START_DAY = 1;
export const DEFAULT_SEASON_TIME_ZONE = "Australia/Adelaide";

export interface ResistanceSeasonCalendar {
  /** 1-12. Defaults to July, the conventional Australian viticultural boundary. */
  startMonth: number;
  /** 1-31. */
  startDay: number;
  timeZoneIdentifier: string;
}

export function makeSeasonCalendar(
  input: Partial<ResistanceSeasonCalendar> = {},
): ResistanceSeasonCalendar {
  return {
    startMonth: input.startMonth ?? DEFAULT_SEASON_START_MONTH,
    startDay: input.startDay ?? DEFAULT_SEASON_START_DAY,
    timeZoneIdentifier: input.timeZoneIdentifier || DEFAULT_SEASON_TIME_ZONE,
  };
}

/**
 * Offset of `timeZone` from UTC, in ms, at the given instant. Season boundaries
 * are local-calendar facts: a spray at 9am on 1 July is in the new season for
 * the grower standing in the vineyard, whatever UTC thinks.
 */
function zoneOffsetMs(timeZone: string, atEpochMs: number): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(atEpochMs));
  } catch {
    return 0; // Unknown identifier — fall back to UTC, as Swift does.
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(atEpochMs / 1000) * 1000;
}

/** Local-midnight instant of the season start date in the given calendar year. */
function startEpochMs(calendar: ResistanceSeasonCalendar, year: number): number {
  const month = Math.min(Math.max(calendar.startMonth, 1), 12);
  const day = Math.max(calendar.startDay, 1);
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Two passes settle DST: the offset must be the one in force at the result.
  let guess = naive - zoneOffsetMs(calendar.timeZoneIdentifier, naive);
  guess = naive - zoneOffsetMs(calendar.timeZoneIdentifier, guess);
  return guess;
}

/** Local calendar year of an instant. */
function localYear(calendar: ResistanceSeasonCalendar, epochMs: number): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: calendar.timeZoneIdentifier,
        year: "numeric",
      }).format(new Date(epochMs)),
    );
  } catch {
    return new Date(epochMs).getUTCFullYear();
  }
}

export function seasonStarting(
  calendar: ResistanceSeasonCalendar,
  startYear: number,
): ResistanceSeason {
  return {
    id: seasonIdForStartYear(startYear),
    startYear,
    startEpochMs: startEpochMs(calendar, startYear),
    endEpochMs: startEpochMs(calendar, startYear + 1),
  };
}

/** The season containing `epochMs`. */
export function seasonForEpochMs(
  calendar: ResistanceSeasonCalendar,
  epochMs: number,
): ResistanceSeason {
  const calendarYear = localYear(calendar, epochMs);
  const thisYearStart = startEpochMs(calendar, calendarYear);
  const startYear = epochMs >= thisYearStart ? calendarYear : calendarYear - 1;
  return seasonStarting(calendar, startYear);
}

export const previousSeason = (
  calendar: ResistanceSeasonCalendar,
  season: ResistanceSeason,
): ResistanceSeason => seasonStarting(calendar, season.startYear - 1);

export const nextSeason = (
  calendar: ResistanceSeasonCalendar,
  season: ResistanceSeason,
): ResistanceSeason => seasonStarting(calendar, season.startYear + 1);
