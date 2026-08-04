// Shared date presentation for every portal report table.
//
// Renders, inside one table cell:
//
//   Monday
//   03/08/2026
//   7:30 am–5:00 pm      (optional)
//
// Rules:
//  - Date-only values ("2026-08-03") are parsed as a LOCAL calendar day so a
//    UTC conversion can never shift the weekday.
//  - Timestamps are converted to the vineyard timezone (Region & Units
//    setting) before the weekday/date are derived; when no vineyard timezone
//    is configured the browser timezone is used.
//  - The displayed date keeps the vineyard's date format (AU DD/MM/YYYY by
//    default) via the shared region formatters.
//  - Sorting/filtering must keep using the raw value — this is display only.
import * as React from "react";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

export type ReportDateValue = Date | string | number | null | undefined;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HAS_TIME_RE = /[T ]\d{1,2}:\d{2}/;

export interface ParsedReportDate {
  date: Date;
  /** True when the source carried no time component. */
  dateOnly: boolean;
}

/** Parse safely: date-only strings become local calendar days (noon anchor). */
export function parseReportDate(value: ReportDateValue): ParsedReportDate | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : { date: value, dateOnly: false };
  }
  if (typeof value === "string") {
    const raw = value.trim();
    const m = DATE_ONLY_RE.exec(raw);
    if (m && !HAS_TIME_RE.test(raw)) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
      return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: true };
    }
  }
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: false };
}

function safeFormat(d: Date, opts: Intl.DateTimeFormatOptions, timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { ...opts, timeZone: timezone ?? undefined }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-AU", opts).format(d);
  }
}

/** Full weekday name in the applicable local timezone. */
export function reportWeekday(value: ReportDateValue, timezone?: string | null): string {
  const parsed = parseReportDate(value);
  if (!parsed) return "";
  return safeFormat(parsed.date, { weekday: "long" }, parsed.dateOnly ? null : timezone);
}

/** DD/MM/YYYY (AU) in the applicable local timezone. */
export function reportDateOnlyText(value: ReportDateValue, timezone?: string | null): string {
  const parsed = parseReportDate(value);
  if (!parsed) return "";
  return safeFormat(
    parsed.date,
    { day: "2-digit", month: "2-digit", year: "numeric" },
    parsed.dateOnly ? null : timezone,
  );
}

/** "Monday 03/08/2026" — for exports/aria labels. */
export function reportDateText(value: ReportDateValue, timezone?: string | null): string {
  const d = reportDateOnlyText(value, timezone);
  if (!d) return "";
  return `${reportWeekday(value, timezone)} ${d}`.trim();
}

/** `7:30 am` — accepts "07:30", "07:30:00" or a full timestamp. */
export function reportTimeText(value: ReportDateValue, timezone?: string | null): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const hm = /^(\d{1,2}):(\d{2})/.exec(value.trim());
    if (hm && !HAS_TIME_RE.test(value.trim().slice(5))) {
      const d = new Date(2000, 0, 1, Number(hm[1]), Number(hm[2]));
      return safeFormat(d, { hour: "numeric", minute: "2-digit" }, null).toLowerCase();
    }
  }
  const parsed = parseReportDate(value);
  if (!parsed || parsed.dateOnly) return "";
  return safeFormat(parsed.date, { hour: "numeric", minute: "2-digit" }, timezone).toLowerCase();
}

export interface ReportDateCellProps {
  value: ReportDateValue;
  startTime?: ReportDateValue;
  endTime?: ReportDateValue;
  /** IANA timezone override. Defaults to the vineyard Region & Units setting. */
  timezone?: string | null;
  /** Shown when the value is missing/invalid. */
  empty?: React.ReactNode;
  className?: string;
}

/**
 * Weekday + date (+ optional time range) inside a single report table cell.
 * Use everywhere a report renders a date — never re-implement weekday logic.
 */
export function ReportDateCell({
  value, startTime, endTime, timezone, empty = "—", className,
}: ReportDateCellProps) {
  const fmt = useRegionFormatters();
  const tz = timezone !== undefined ? timezone : fmt.settings.timezone ?? null;

  const dateText = reportDateOnlyText(value, tz);
  if (!dateText) return <span className="text-muted-foreground">{empty}</span>;

  const weekday = reportWeekday(value, tz);
  const start = reportTimeText(startTime, tz);
  const end = reportTimeText(endTime, tz);
  const timeLine = start && end ? `${start}–${end}` : start || end || "";

  return (
    <div className={`leading-tight whitespace-nowrap ${className ?? ""}`.trim()}>
      {weekday && <div className="text-[11px] text-muted-foreground">{weekday}</div>}
      <div>{dateText}</div>
      {timeLine && <div className="text-[11px] text-muted-foreground">{timeLine}</div>}
    </div>
  );
}

export default ReportDateCell;
