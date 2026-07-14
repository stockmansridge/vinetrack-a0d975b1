// Derived pruning metrics — matches iOS/Android calculation contract.
// - Row equivalents = completedSegments / 4
// - Vines-per-row uses per-row length / vine_spacing when available,
//   otherwise falls back to totalVines / rowCount.
// - Working-day average uses distinct entry_date days, filtered to the
//   season's working_days when populated.
import type { PruningEntry, PruningRowSegment, PruningSeason } from "./pruningQuery";
import type { PaddockRow } from "./paddockGeometry";
import { deriveMetrics, rowLengthMeters } from "./paddockGeometry";

export interface RowIdentity {
  paddockRowId: string | null; // stable when configured
  rowNumber: number;
  rowLabel: string;
  order: number;
  lengthM: number;
  estimatedVines: number;
}

/** Return the canonical list of rows for a paddock, preserving stored
 *  order and non-sequential row numbers. Falls back to 1..rowCount only
 *  when paddocks.rows is empty AND a manual_row_count is supplied. */
export function buildRowIdentities(
  paddockRows: PaddockRow[],
  paddock: any,
  manualRowCount: number | null,
): RowIdentity[] {
  const metrics = deriveMetrics(paddock);
  const totalVines = metrics.vineCount ?? 0;
  const vineSpacing = Number(paddock?.vine_spacing) || 0;

  if (paddockRows.length > 0) {
    const rows = paddockRows
      .map((r, idx) => {
        const rowNumber = Number.isFinite(r.number) ? Number(r.number) : idx + 1;
        const lengthM = rowLengthMeters(r);
        let vines = 0;
        if (vineSpacing > 0 && lengthM > 0) vines = Math.floor(lengthM / vineSpacing);
        else if (totalVines && paddockRows.length) vines = Math.floor(totalVines / paddockRows.length);
        return {
          paddockRowId: r.id ?? null,
          rowNumber,
          rowLabel: String(rowNumber),
          order: idx,
          lengthM,
          estimatedVines: vines,
        } as RowIdentity;
      })
      // preserve stored order but expose sorted-by-number for display when identical
      .sort((a, b) => a.order - b.order);
    return rows;
  }

  const fallbackCount = Math.max(0, Math.floor(manualRowCount ?? 0));
  if (fallbackCount === 0) return [];
  const vinesPerRow = totalVines && fallbackCount ? Math.floor(totalVines / fallbackCount) : 0;
  return Array.from({ length: fallbackCount }, (_, i) => ({
    paddockRowId: null,
    rowNumber: i + 1,
    rowLabel: String(i + 1),
    order: i,
    lengthM: 0,
    estimatedVines: vinesPerRow,
  }));
}

export interface RowCompletionState {
  identity: RowIdentity;
  completed: Set<number>; // segment numbers 1..4
}

export function buildRowCompletion(
  identities: RowIdentity[],
  segments: PruningRowSegment[],
): RowCompletionState[] {
  // Index by paddock_row_id first (stable), fall back to row_number.
  // IMPORTANT: only count segments that are actually completed. Reversed entries
  // leave the row present with completed = false / pruning_entry_id = null.
  const byId = new Map<string, Set<number>>();
  const byNumber = new Map<number, Set<number>>();
  for (const s of segments) {
    const isCompleted =
      (s as any).completed === true &&
      (s as any).pruning_entry_id != null;
    if (!isCompleted) continue;
    if (s.paddock_row_id) {
      const set = byId.get(s.paddock_row_id) ?? new Set<number>();
      set.add(s.segment_number);
      byId.set(s.paddock_row_id, set);
    } else {
      const set = byNumber.get(s.row_number) ?? new Set<number>();
      set.add(s.segment_number);
      byNumber.set(s.row_number, set);
    }
  }
  return identities.map((id) => ({
    identity: id,
    completed:
      (id.paddockRowId && byId.get(id.paddockRowId)) ||
      byNumber.get(id.rowNumber) ||
      new Set<number>(),
  }));
}

export interface BlockProgress {
  totalRows: number;
  totalSegments: number;
  completedSegments: number;
  rowEquivalentsCompleted: number;
  percentComplete: number; // 0..1
  estimatedVinesTotal: number;
  estimatedVinesCompleted: number;
  workingDayAvgRowEquivalents: number | null;
  estimatedCompletionDate: string | null; // yyyy-mm-dd
  dueStatus: "on_track" | "at_risk" | "overdue" | "complete" | "no_due";
  daysRemaining: number | null;
}

const DAY_MS = 24 * 60 * 60 * 60 * 1000; // guard against DST via UTC math

function parseDate(s: string): Date {
  // yyyy-mm-dd → UTC midnight
  const [y, m, d] = s.split("-").map((n) => Number(n));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}
function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** iOS working_days uses ISO weekday (1=Mon..7=Sun). Match that on the
 *  portal — Date.getUTCDay returns 0=Sun..6=Sat so convert. */
function isoWeekday(d: Date): number {
  const wd = d.getUTCDay(); // 0..6
  return wd === 0 ? 7 : wd;
}

export function computeBlockProgress(
  identities: RowIdentity[],
  completion: RowCompletionState[],
  entries: PruningEntry[],
  season: PruningSeason,
  today: Date = new Date(),
): BlockProgress {
  const totalRows = identities.length;
  const totalSegments = totalRows * 4;
  const completedSegments = completion.reduce((s, r) => s + r.completed.size, 0);
  const rowEquivalentsCompleted = completedSegments / 4;
  const percentComplete = totalSegments ? completedSegments / totalSegments : 0;
  const estimatedVinesTotal = identities.reduce((s, r) => s + r.estimatedVines, 0);
  const estimatedVinesCompleted = entries.reduce((s, e) => s + (e.estimated_vines_completed ?? 0), 0);

  // Working-day average — group non-deleted entries by entry_date, sum row-equivalents.
  const byDay = new Map<string, number>();
  for (const e of entries) {
    byDay.set(e.entry_date, (byDay.get(e.entry_date) ?? 0) + (e.row_equivalents_completed ?? 0));
  }
  const days = Array.from(byDay.keys()).sort();
  const workingDays = new Set(season.working_days ?? []);
  const filtered = days.filter((d) => (workingDays.size ? workingDays.has(isoWeekday(parseDate(d))) : true));
  const workingDayAvg = filtered.length
    ? filtered.reduce((s, d) => s + (byDay.get(d) ?? 0), 0) / filtered.length
    : null;

  // Estimated completion date — advance one working day at a time until remaining rows are done.
  const remainingRE = Math.max(0, totalRows - rowEquivalentsCompleted);
  let estimatedCompletionDate: string | null = null;
  let daysRemaining: number | null = null;
  if (remainingRE === 0) {
    estimatedCompletionDate = fmtDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
    daysRemaining = 0;
  } else if (workingDayAvg && workingDayAvg > 0) {
    const daysNeeded = Math.ceil(remainingRE / workingDayAvg);
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    let counted = 0;
    let calDays = 0;
    while (counted < daysNeeded && calDays < 3650) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      calDays += 1;
      if (!workingDays.size || workingDays.has(isoWeekday(cursor))) counted += 1;
    }
    estimatedCompletionDate = fmtDate(cursor);
    daysRemaining = daysNeeded;
  }

  let dueStatus: BlockProgress["dueStatus"] = "no_due";
  const todayStr = fmtDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
  if (percentComplete >= 1) dueStatus = "complete";
  else if (season.due_date) {
    if (season.due_date < todayStr) dueStatus = "overdue";
    else if (estimatedCompletionDate && estimatedCompletionDate > season.due_date) dueStatus = "at_risk";
    else dueStatus = "on_track";
  }

  return {
    totalRows,
    totalSegments,
    completedSegments,
    rowEquivalentsCompleted,
    percentComplete,
    estimatedVinesTotal,
    estimatedVinesCompleted,
    workingDayAvgRowEquivalents: workingDayAvg,
    estimatedCompletionDate,
    dueStatus,
    daysRemaining,
  };
}

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const ISO_DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7];

export interface RowRangeParseResult {
  nums: number[];
  invalid: string[];
}

/**
 * Parse a comma-separated list of row numbers or ranges into the subset that
 * actually exists in `available`. Handles:
 *   - single rows:            "44"
 *   - ascending ranges:       "44-46"
 *   - descending ranges:      "46-44"
 *   - whitespace around dash: "44 - 46", "44 -46"
 *   - multiple parts:         "1-10, 15, 20-22"
 * Ignores duplicates and row numbers not present in `available` (never invents
 * missing rows such as 4 in [1,2,3,5,6]). Reports malformed tokens via
 * `invalid` so the UI can surface a validation message.
 */
export function parseRowRangesDetail(input: string, available: number[]): RowRangeParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { nums: [], invalid: [] };
  // Collapse whitespace around dashes so "44 - 46" behaves like "44-46".
  const normalised = trimmed.replace(/\s*-\s*/g, "-");
  const set = new Set(available);
  const out = new Set<number>();
  const invalid: string[] = [];
  for (const raw of normalised.split(/[,\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) { invalid.push(part); continue; }
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let n = lo; n <= hi; n++) if (set.has(n)) out.add(n);
  }
  return { nums: Array.from(out).sort((x, y) => x - y), invalid };
}

export function parseRowRanges(input: string, available: number[]): number[] {
  return parseRowRangesDetail(input, available).nums;
}

// re-export to silence unused warning in dev builds
export const _unused = DAY_MS;
