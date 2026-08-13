// Per-row manual vine-count override — SQL 188 contract (CONSUMER ONLY).
//
// Rork/VineTrack mobile owns this contract. The portal consumes it exactly as
// documented in sql/188_piece_rate_pruning_costing.sql:
//
//   paddocks.rows is a JSONB array. Canonical element:
//     {
//       "id": "uuid",
//       "number": 12,
//       "startPoint": { "latitude": .., "longitude": .. },
//       "endPoint":   { "latitude": .., "longitude": .. },
//       "vineCountOverride": 182       // OPTIONAL. Absent = use calculated.
//     }
//
//   * OPTIONAL. Rows without the key stay valid and unchanged.
//   * Whole positive integer, or ABSENT. Never 0, never negative, never
//     fractional, never null-as-a-value (omit the key instead).
//   * effectiveVineCount(row) = vineCountOverride ?? round(rowLength / vineSpacing)
//   * Only the manual number is persisted; the effective value is always
//     derived at read time.
//
// INTERACTION WITH THE BLOCK-LEVEL paddocks.vine_count_override:
//   The two are INDEPENDENT and both preserved. The block override remains the
//   block total for water/spray/fertiliser/yield. rows[].vineCountOverride is
//   per-ROW truth for row-driven work (pruning piece rate). Neither overwrites
//   the other. Where a block total is needed FROM rows, use
//   SUM(effectiveVineCount(row)).
//
// ROUND-TRIP SAFETY (SQL 188 / geometry spec):
//   Rows must NEVER be rebuilt from a reduced front-end model. Every unknown
//   key, the row id and the geometry are preserved verbatim. Helpers here take
//   the raw JSON object and return a shallow copy with only the one key
//   changed.

import { parseRows, rowLengthMeters, type PaddockRow } from "./paddockGeometry";

/** The raw, untouched JSON object exactly as stored in paddocks.rows. */
export type RawPaddockRow = Record<string, any>;

const isFiniteNum = (n: any): n is number => typeof n === "number" && Number.isFinite(n);

/** Parse paddocks.rows preserving EVERY property of every element. */
export function parseRawRows(raw: any): RawPaddockRow[] {
  if (!raw) return [];
  let arr: any = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((r) => r && typeof r === "object");
}

/** The stored manual override, or null when absent/invalid. */
export function readVineCountOverride(row: RawPaddockRow | PaddockRow | null | undefined): number | null {
  const v = (row as any)?.vineCountOverride;
  if (!isFiniteNum(v)) return null;
  if (!Number.isInteger(v) || v <= 0) return null;
  return v;
}

/**
 * Validate a user-entered override string.
 * blank -> { ok, value: null } (means "no override", key omitted on save).
 */
export function parseVineCountOverrideInput(
  input: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = (input ?? "").trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false, error: "Whole numbers only" };
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "Must be a positive whole number" };
  return { ok: true, value: n };
}

/**
 * Return a copy of the raw row with the override set (or the key REMOVED when
 * null). All other keys — id, number, startPoint, endPoint and anything added
 * later by mobile — are preserved verbatim.
 */
export function withVineCountOverride(row: RawPaddockRow, value: number | null): RawPaddockRow {
  const next: RawPaddockRow = { ...row };
  if (value == null) delete next.vineCountOverride;
  else next.vineCountOverride = value;
  return next;
}

/**
 * Calculated (automatic) vine estimate for a single row.
 * SQL 188: round(rowLength / vineSpacing). Returns null when it cannot be
 * derived (no geometry or no vine spacing).
 */
export function calculatedRowVineCount(
  row: RawPaddockRow | PaddockRow,
  vineSpacingM: number | null | undefined,
  lengthOverrideM?: number | null,
): number | null {
  const spacing = Number(vineSpacingM);
  if (!isFiniteNum(spacing) || spacing <= 0) return null;
  const len = isFiniteNum(lengthOverrideM) && lengthOverrideM! > 0
    ? Number(lengthOverrideM)
    : rowLengthMeters(row as PaddockRow);
  if (!isFiniteNum(len) || len <= 0) return null;
  return Math.round(len / spacing);
}

/** effectiveVineCount(row) = vineCountOverride ?? calculated. */
export function effectiveRowVineCount(
  row: RawPaddockRow | PaddockRow,
  vineSpacingM: number | null | undefined,
  lengthOverrideM?: number | null,
): number | null {
  const override = readVineCountOverride(row);
  if (override != null) return override;
  return calculatedRowVineCount(row, vineSpacingM, lengthOverrideM);
}

/** Block total derived FROM rows: SUM(effectiveVineCount(row)). */
export function sumEffectiveRowVineCounts(
  rows: (RawPaddockRow | PaddockRow)[],
  vineSpacingM: number | null | undefined,
  lengthOverrideM?: number | null,
): number {
  return rows.reduce((s, r) => s + (effectiveRowVineCount(r, vineSpacingM, lengthOverrideM) ?? 0), 0);
}

/**
 * Merge freshly generated geometry onto the stored rows WITHOUT losing row
 * identity, overrides or unknown keys.
 *
 * Matching is by row `number` (the real-world row number), which is the only
 * stable business key across a regeneration. When a stored row matches, its
 * `id` and every extra property (including vineCountOverride) are kept and
 * only the geometry keys are refreshed.
 */
export function mergeGeneratedGeometry(
  stored: RawPaddockRow[],
  generated: RawPaddockRow[],
): RawPaddockRow[] {
  const byNumber = new Map<number, RawPaddockRow>();
  for (const r of stored) {
    const n = Number(r?.number);
    if (Number.isFinite(n)) byNumber.set(n, r);
  }
  return generated.map((g) => {
    const n = Number(g?.number);
    const prev = Number.isFinite(n) ? byNumber.get(n) : undefined;
    if (!prev) return { ...g };
    // Keep stored identity + unknown keys; refresh geometry from the generator.
    return {
      ...prev,
      ...g,
      id: prev.id ?? g.id,
    };
  });
}
