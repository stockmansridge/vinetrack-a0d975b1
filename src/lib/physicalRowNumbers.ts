// Physical vine-row numbering validation (single shared rule).
//
// Physical block rows (paddocks.rows[*].number) are WHOLE numbers. The
// geometry writer spec (docs/paddock-geometry-writer-spec.md §3) defines
// `number` as an integer that "may start at any positive integer
// (rowStartNumber, default 1)". The shared pruning summary casts it to
// Postgres `integer`, so the upper bound is int4.
//
// SCOPE: physical rows only. Trip driving-path / aisle identifiers (e.g. 24.5),
// row offsets, spacing, GPS and pruning segments are NOT validated here.
//
// Inputs are never rounded, truncated or defaulted — invalid input is an error.

export const PHYSICAL_ROW_NUMBER_MIN = 1;
export const PHYSICAL_ROW_NUMBER_MAX = 2147483647; // Postgres int4

export const START_ROW_ERROR = "Starting row number must be a whole number.";
export const ROW_COUNT_ERROR = "Number of rows must be a positive whole number.";
export const ROW_RANGE_ERROR =
  `Row numbers must be between ${PHYSICAL_ROW_NUMBER_MIN} and ${PHYSICAL_ROW_NUMBER_MAX.toLocaleString("en-AU")}.`;

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

/** Strict decimal text → number. Accepts "12", "1.0", " 7 "; rejects "", "1e3", "abc", "1.5". */
function parseWholeText(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) && Number.isInteger(input) ? input : null;
  if (typeof input !== "string") return null;
  const t = input.trim();
  if (!/^[+-]?\d+(\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

export function isPhysicalRowNumber(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= PHYSICAL_ROW_NUMBER_MIN &&
    n <= PHYSICAL_ROW_NUMBER_MAX
  );
}

export function parseStartRowNumber(input: unknown): ParseResult {
  const n = parseWholeText(input);
  if (n == null) return { ok: false, error: START_ROW_ERROR };
  if (!isPhysicalRowNumber(n)) return { ok: false, error: ROW_RANGE_ERROR };
  return { ok: true, value: n };
}

export function parseRowCount(input: unknown): ParseResult {
  const n = parseWholeText(input);
  if (n == null || n < 1 || n > PHYSICAL_ROW_NUMBER_MAX) return { ok: false, error: ROW_COUNT_ERROR };
  return { ok: true, value: n };
}

/** Validate start + count together (the last row must stay in range). */
export function validateRowNumbering(
  start: unknown,
  count: unknown,
): { ok: true; start: number; count: number } | { ok: false; startError?: string; countError?: string } {
  const s = parseStartRowNumber(start);
  const c = parseRowCount(count);
  if (!s.ok || !c.ok) {
    return { ok: false, startError: s.ok ? undefined : s.error, countError: c.ok ? undefined : c.error };
  }
  if (s.value + c.value - 1 > PHYSICAL_ROW_NUMBER_MAX) return { ok: false, countError: ROW_RANGE_ERROR };
  return { ok: true, start: s.value, count: c.value };
}

export interface InvalidRowNumber {
  index: number;
  id: string | null;
  number: unknown;
}

/** List rows whose `number` is not a valid physical whole row number. */
export function findInvalidRowNumbers(rows: unknown): InvalidRowNumber[] {
  let arr: unknown = rows;
  if (typeof rows === "string") {
    try { arr = JSON.parse(rows); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out: InvalidRowNumber[] = [];
  arr.forEach((r, index) => {
    const n = (r as any)?.number;
    if (!isPhysicalRowNumber(n)) out.push({ index, id: (r as any)?.id ?? null, number: n });
  });
  return out;
}

export class InvalidPhysicalRowsError extends Error {
  constructor(public readonly invalid: InvalidRowNumber[], label?: string) {
    const sample = invalid.slice(0, 3).map((i) => JSON.stringify(i.number)).join(", ");
    super(
      `${label ? `${label}: ` : ""}row numbers must be whole numbers (found ${sample}${invalid.length > 3 ? ", …" : ""}).`,
    );
    this.name = "InvalidPhysicalRowsError";
  }
}

/** Save-boundary guard: throw if a patch/insert carries invalid `rows`. No-op when `rows` is absent. */
export function assertValidRowsPayload(payload: Record<string, any> | null | undefined, label?: string): void {
  if (!payload || !("rows" in payload) || payload.rows == null) return;
  const invalid = findInvalidRowNumbers(payload.rows);
  if (invalid.length) throw new InvalidPhysicalRowsError(invalid, label);
}

/** Detect the shared summary's integer-cast failure on a physical row number. */
export function isFractionalRowCastError(message: unknown): boolean {
  return typeof message === "string" && /invalid input syntax for type integer: "-?\d+\.\d+"/.test(message);
}

/**
 * Turn the raw summary error into an actionable message ONLY when it is the
 * integer-cast failure and loaded block data actually contains invalid
 * physical row numbers. Otherwise the original message is returned unchanged.
 */
export function describePruningSummaryError(
  message: string | null | undefined,
  blocks: ReadonlyArray<{ id: string; name: string | null; rows: unknown }>,
): string | null {
  if (!message || !isFractionalRowCastError(message)) return message ?? null;
  const affected = blocks
    .map((b) => ({ b, bad: findInvalidRowNumbers(b.rows) }))
    .filter((x) => x.bad.length > 0);
  if (affected.length === 0) return message;
  const list = affected
    .map(({ b, bad }) => `${b.name ?? b.id} (${bad.slice(0, 5).map((i) => String(i.number)).join(", ")}${bad.length > 5 ? ", …" : ""})`)
    .join("; ");
  return `Pruning totals can't be calculated because ${affected.length === 1 ? "this block has" : "these blocks have"} row numbers that aren't whole numbers: ${list}. Physical row numbers must be whole numbers — the block's row numbering needs correcting. (${message})`;
}
