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
 * Length in metres of ANY row shape — canonical iOS (`startPoint`/`endPoint`),
 * legacy (`start`/`end`, `points`) or an explicit `length_m`. Uses the single
 * canonical geometry pipeline (parseRows + rowLengthMeters) so there is only
 * ever one distance implementation in the portal.
 */
export function rawRowLengthMeters(row: RawPaddockRow | PaddockRow): number {
  const direct = rowLengthMeters(row as PaddockRow);
  if (isFiniteNum(direct) && direct > 0) return direct;
  const [normalised] = parseRows([row]);
  if (!normalised) return 0;
  return rowLengthMeters(normalised);
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
    : rawRowLengthMeters(row);
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

// ---------------------------------------------------------------------------
// AUTHORITATIVE PHYSICAL VINE COUNT — iOS / Android / SQL 263 parity.
//
//   1. valid positive paddocks.vine_count_override
//   2. else, when at least one valid rows[].vineCountOverride exists, the
//      COMPLETE row-effective total (manual where set, calculated otherwise) —
//      only if EVERY row resolves to a count. A partial total is rejected.
//   3. else the caller's non-row fallback (calculated block count for
//      summaries / Bunch Count; saved vines_per_ha × area for Pruning Yield).
//
// Automatic per-row counts use the mobile/SQL physical row contract:
//   round_half_away_from_zero(startPoint→endPoint length ÷ vine_spacing)
//   with equirectangular metres: 111,320 m per degree latitude and
//   longitude scaled by cos(polygon centroid latitude).
// row_length_overrides are deliberately NOT used here (mobile/SQL do not).
// Never written back to storage.
// ---------------------------------------------------------------------------

const M_PER_DEG_LAT = 111320;

const roundHalfAwayFromZero = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

function pointOf(p: any): { lat: number; lng: number } | null {
  if (!p || typeof p !== "object") return null;
  const lat = p.latitude ?? p.lat;
  const lng = p.longitude ?? p.lng;
  return isFiniteNum(lat) && isFiniteNum(lng) ? { lat, lng } : null;
}

/** Mean latitude of the block polygon (SQL 263 centroid), or null. */
export function polygonCentroidLatitude(polygonRaw: any): number | null {
  let arr: any = polygonRaw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { return null; }
  }
  if (!Array.isArray(arr)) return null;
  const lats = arr.map(pointOf).filter(Boolean).map((p) => p!.lat);
  return lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
}

/** Mobile/SQL row length (metres) from startPoint/endPoint, or null. */
export function physicalRowLengthMeters(row: RawPaddockRow, centroidLat: number | null): number | null {
  const a = pointOf(row?.startPoint ?? row?.start);
  const b = pointOf(row?.endPoint ?? row?.end);
  if (!a || !b) return null;
  const lat0 = centroidLat ?? (a.lat + b.lat) / 2;
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dx = (b.lng - a.lng) * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const len = Math.hypot(dx, dy);
  return Number.isFinite(len) ? len : null;
}

/** Automatic per-row count, mobile/SQL contract. Null when not calculable. */
export function physicalCalculatedRowVineCount(
  row: RawPaddockRow,
  vineSpacingM: unknown,
  centroidLat: number | null,
): number | null {
  const spacing = Number(vineSpacingM);
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  const len = physicalRowLengthMeters(row, centroidLat);
  if (len == null || len <= 0) return null;
  return roundHalfAwayFromZero(len / spacing);
}

/** Valid positive block override, or null (zero/negative/invalid ignored). */
export function validBlockVineCountOverride(paddock: any): number | null {
  const v = Number(paddock?.vine_count_override);
  if (paddock?.vine_count_override == null || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v);
}

/**
 * Complete row-effective total, or null when there is no valid manual row
 * override OR any untouched row cannot be calculated (partial = rejected).
 * All-manual rows need neither geometry nor vine spacing.
 */
export function completeRowEffectiveVineCount(paddock: any): number | null {
  const rows = parseRawRows(paddock?.rows);
  if (!rows.length) return null;
  if (!rows.some((r) => readVineCountOverride(r) != null)) return null;
  const centroidLat = polygonCentroidLatitude(paddock?.polygon_points);
  let total = 0;
  for (const r of rows) {
    const v = readVineCountOverride(r) ?? physicalCalculatedRowVineCount(r, paddock?.vine_spacing, centroidLat);
    if (v == null) return null;
    total += v;
  }
  return total;
}

export type AuthoritativeVineSource = "block_override" | "row_effective" | "fallback";

/** Physical vine override only (block or complete rows), or null. */
export function physicalVineCountOverride(
  paddock: any,
): { count: number; source: "block_override" | "row_effective" } | null {
  const block = validBlockVineCountOverride(paddock);
  if (block != null) return { count: block, source: "block_override" };
  const rows = completeRowEffectiveVineCount(paddock);
  if (rows != null) return { count: rows, source: "row_effective" };
  return null;
}

/** block override → complete row total → caller's fallback. */
export function authoritativeVineCount(
  paddock: any,
  fallback: number | null,
): { count: number | null; source: AuthoritativeVineSource } {
  const physical = physicalVineCountOverride(paddock);
  if (physical) return physical;
  return { count: fallback, source: "fallback" };
}

/**
 * USER-FACING vine-count summary (display only — iOS/Android parity).
 * Delegates to authoritativeVineCount with the calculated block count as the
 * fallback. Never used by spray/irrigation/fertiliser/piece-rate.
 */
export function summaryVineCount(
  paddock: any,
  calculatedBlockCount: number | null,
): number | null {
  return authoritativeVineCount(paddock, calculatedBlockCount).count;
}
