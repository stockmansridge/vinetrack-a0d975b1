// Derived pruning metrics — SHARED CROSS-PLATFORM CONTRACT.
//
// This module MUST produce identical unrounded totals to the iOS and
// Android pruning trackers. Any change here needs a matching change in
// Swift and Kotlin, verified against docs/pruning-calc-contract.md.
//
// Contract (v1, 2026-07-14):
//   1. Vine-per-row precedence:
//      a. paddock.vine_count_override    (authoritative paddock total,
//         distributed proportionally across rows by row length; falls
//         back to even split when row lengths are unknown).
//      b. derived total = floor(sum(rowLength) / vine_spacing) at the
//         paddock level, then distributed proportionally.
//      c. manual_row_count fallback with 0 vines/row when neither above
//         is available.
//      Per-row values are kept as floats — no rounding until the block
//      total is displayed. This eliminates per-row floor() drift.
//   2. Row equivalents = completedSegments / 4.
//   3. Vines completed for a block = round(paddockVineTotal *
//      completedSegments / (rowCount * 4)) — one final rounding, never
//      sum(round(each quarter)).
//   4. Vineyard progress = Σ completedSegments / Σ totalSegments
//      (row-equivalent weighted). Vine totals are for display only.
//   5. Vines/day = Σ vinesDone / distinctEntryDaysFilteredByWorkingDays,
//      aggregated at the vineyard level across all blocks.
//   6. Vines/labour-hour = Σ vinesDone / Σ labour_hours.
//   7. Projected completion = today + ceil(remainingRE /
//      vineyardWorkingDayAvgRE) advanced by the season's working_days
//      list, in the vineyard's local date (date-only arithmetic).
import type { PruningEntry, PruningRowSegment, PruningSeason } from "./pruningQuery";
import type { PaddockRow } from "./paddockGeometry";
import { deriveMetrics, rowLengthMeters } from "./paddockGeometry";

export interface RowIdentity {
  paddockRowId: string | null; // stable when configured
  rowNumber: number;
  rowLabel: string;
  order: number;
  lengthM: number;
  /** Float — proportional share of the paddock's authoritative vine total. */
  estimatedVines: number;
}

/** Return the canonical list of rows for a paddock, preserving stored
 *  order and non-sequential row numbers. Per-row vine counts are floats
 *  representing that row's proportional share of the paddock's
 *  authoritative vine total, so summing them exactly reproduces the
 *  paddock total without floor() drift. Falls back to 1..rowCount only
 *  when paddocks.rows is empty AND a manual_row_count is supplied. */
export function buildRowIdentities(
  paddockRows: PaddockRow[],
  paddock: any,
  manualRowCount: number | null,
): RowIdentity[] {
  const metrics = deriveMetrics(paddock);
  const paddockVineTotal = metrics.vineCount ?? 0;

  if (paddockRows.length > 0) {
    const lengths = paddockRows.map((r) => rowLengthMeters(r));
    const totalLen = lengths.reduce((s, l) => s + l, 0);
    return paddockRows
      .map((r, idx) => {
        const rowNumber = Number.isFinite(r.number) ? Number(r.number) : idx + 1;
        const lengthM = lengths[idx];
        let vines = 0;
        if (paddockVineTotal > 0) {
          vines = totalLen > 0
            ? paddockVineTotal * (lengthM / totalLen)
            : paddockVineTotal / paddockRows.length;
        }
        return {
          paddockRowId: r.id ?? null,
          rowNumber,
          rowLabel: String(rowNumber),
          order: idx,
          lengthM,
          estimatedVines: vines,
        } as RowIdentity;
      })
      .sort((a, b) => a.order - b.order);
  }

  const fallbackCount = Math.max(0, Math.floor(manualRowCount ?? 0));
  if (fallbackCount === 0) return [];
  const vinesPerRow = paddockVineTotal && fallbackCount ? paddockVineTotal / fallbackCount : 0;
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
    // Shared contract with iOS/Android: a quarter is done iff completed === true.
    // Do NOT also require pruning_entry_id — cross-platform records (and some
    // legacy rows) may leave it null while completed remains true. Reversal
    // sets completed = false, so this stays consistent with the reverse flow.
    if ((s as any).completed !== true) continue;
    // Index by BOTH paddock_row_id and row_number. Some records only have
    // one or the other, and paddock row ids can change when a block's rows
    // are regenerated — falling back to row_number keeps green quarters
    // visible instead of silently orphaning completed segments.
    if (s.paddock_row_id) {
      const set = byId.get(s.paddock_row_id) ?? new Set<number>();
      set.add(s.segment_number);
      byId.set(s.paddock_row_id, set);
    }
    if (Number.isFinite(s.row_number)) {
      const set = byNumber.get(s.row_number) ?? new Set<number>();
      set.add(s.segment_number);
      byNumber.set(s.row_number, set);
    }
  }
  return identities.map((id) => {
    const byIdMatch = id.paddockRowId ? byId.get(id.paddockRowId) : null;
    const byNumMatch = byNumber.get(id.rowNumber);
    let completed: Set<number>;
    if (byIdMatch && byNumMatch) {
      completed = new Set<number>([...byIdMatch, ...byNumMatch]);
    } else {
      completed = byIdMatch ?? byNumMatch ?? new Set<number>();
    }
    return { identity: id, completed };
  });

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
  // Row-equivalent weighted progress — shared contract with iOS/Android.
  const percentComplete = totalSegments ? completedSegments / totalSegments : 0;
  // Paddock authoritative vine total: sum of per-row shares (float), one
  // final rounding for display. Reconciles with paddock.vine_count.
  const exactVinesTotal = identities.reduce((s, r) => s + r.estimatedVines, 0);
  const estimatedVinesTotal = Math.round(exactVinesTotal);
  // Vines completed = Σ(exact quarter vines from completed rows), one rounding.
  let exactVinesCompleted = 0;
  for (const r of completion) {
    if (r.completed.size === 0) continue;
    exactVinesCompleted += r.identity.estimatedVines * (r.completed.size / 4);
  }
  const estimatedVinesCompleted = Math.round(exactVinesCompleted);
  void entries; // per-entry estimated_vines_completed is intentionally unused

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

/** Vineyard-level projection using the shared contract. Uses aggregated
 *  row equivalents across all blocks and the union of season working
 *  days so a single vineyard date is projected regardless of which block
 *  finishes last. Date-only arithmetic in UTC — no timezone shift. */
export function projectVineyardCompletion(args: {
  totalRowEquivalents: number;
  completedRowEquivalents: number;
  distinctWorkingDays: number;
  workingDaysOfWeek: number[]; // iso 1..7; empty = all days count
  today?: Date;
}): { estimatedCompletionDate: string | null; daysRemaining: number | null; avgRE: number | null } {
  const today = args.today ?? new Date();
  const remainingRE = Math.max(0, args.totalRowEquivalents - args.completedRowEquivalents);
  if (remainingRE === 0) {
    return {
      estimatedCompletionDate: fmtDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))),
      daysRemaining: 0,
      avgRE: null,
    };
  }
  if (args.distinctWorkingDays <= 0) return { estimatedCompletionDate: null, daysRemaining: null, avgRE: null };
  const avg = args.completedRowEquivalents / args.distinctWorkingDays;
  if (avg <= 0) return { estimatedCompletionDate: null, daysRemaining: null, avgRE: avg };
  const workingSet = new Set(args.workingDaysOfWeek);
  const daysNeeded = Math.ceil(remainingRE / avg);
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let counted = 0;
  let calDays = 0;
  while (counted < daysNeeded && calDays < 3650) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    calDays += 1;
    if (!workingSet.size || workingSet.has(isoWeekday(cursor))) counted += 1;
  }
  return { estimatedCompletionDate: fmtDate(cursor), daysRemaining: daysNeeded, avgRE: avg };
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
