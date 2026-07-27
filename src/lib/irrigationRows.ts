// Row-based irrigation helpers (SQL 126) — display only.
//
// Nothing in here computes allocations or weightings: percentages, the
// weighting basis and warnings all come straight from the server. These
// helpers only normalise the shapes the RPCs can return and format rows for
// reading (e.g. "1–2, 5, 8").

export type WeightingBasis =
  | "emitter_count"
  | "vine_count"
  | "row_length"
  | "equal_rows"
  | (string & {});

const BASIS_LABELS: Record<string, string> = {
  emitter_count: "Emitter count",
  emitters: "Emitter count",
  vine_count: "Vine count",
  vines: "Vine count",
  row_length: "Row length",
  row_length_m: "Row length",
  length: "Row length",
  equal_rows: "Equal rows",
  equal: "Equal rows",
};

/** Human label for a server-returned weighting basis. Never derived locally. */
export function weightingBasisLabel(basis: string | null | undefined): string {
  if (!basis) return "—";
  return (
    BASIS_LABELS[basis] ??
    basis.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

export interface AvailableRow {
  row_id: string;
  row_number: number | null;
  row_label: string | null;
  block_id: string;
  block_name: string;
  variety_name: string | null;
  row_length_m: number | null;
  vine_count: number | null;
  emitter_count: number | null;
  /** SQL 127 basis metadata — never derived in the browser. */
  vine_count_basis: string | null;
  vine_count_is_estimated: boolean | null;
  emitter_count_basis: string | null;
  emitter_count_is_estimated: boolean | null;
  /** Whether the RPC payload carries usable mapped coordinates for this row. */
  has_start_point: boolean;
  has_end_point: boolean;
  /** Names of other valves already linked to this row (overlap warning source). */
  other_valve_names: string[];
}

export interface AvailableRowBlock {
  block_id: string;
  block_name: string;
  variety_name: string | null;
  rows: AvailableRow[];
}


const numOrNull = (v: unknown): number | null =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

const boolOrNull = (v: unknown): boolean | null =>
  v == null ? null : v === true || v === "true" || v === 1;

// --- SQL 127 basis metadata -------------------------------------------------

const VINE_BASIS_LABELS: Record<string, string> = {
  block_total_by_row_length: "Configured block total distributed by row length",
  block_vine_count_by_row_length: "Configured block total distributed by row length",
  block_total: "Configured block total distributed by row length",
  row_length_and_vine_spacing: "Estimated from row length and vine spacing",
  row_length_spacing: "Estimated from row length and vine spacing",
  vine_spacing: "Estimated from row length and vine spacing",
  row_length: "Estimated from row length and vine spacing",
  exact_row_count: "Exact row count",
  row_vine_count: "Exact row count",
  exact: "Exact row count",
  unavailable: "Unavailable",
  none: "Unavailable",
};

const EMITTER_BASIS_LABELS: Record<string, string> = {
  row_length_and_emitter_spacing: "Estimated from row length and emitter spacing",
  row_length_spacing: "Estimated from row length and emitter spacing",
  emitter_spacing: "Estimated from row length and emitter spacing",
  row_length: "Estimated from row length and emitter spacing",
  configured_exact_count: "Configured exact count",
  exact_emitter_count: "Configured exact count",
  exact: "Configured exact count",
  unavailable: "Unavailable",
  none: "Unavailable",
};

function basisLabel(map: Record<string, string>, basis: string | null | undefined): string | null {
  if (!basis) return null;
  return (
    map[basis] ?? basis.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** User-facing explanation of the server-returned vine-count basis. */
export const vineBasisLabel = (b: string | null | undefined) => basisLabel(VINE_BASIS_LABELS, b);
/** User-facing explanation of the server-returned emitter-count basis. */
export const emitterBasisLabel = (b: string | null | undefined) =>
  basisLabel(EMITTER_BASIS_LABELS, b);

/**
 * Formats a server-returned count. `≈` is used only when the backend marks the
 * value as estimated; null is never rendered as zero.
 */
export function formatEstimate(
  value: number | null | undefined,
  isEstimated: boolean | null | undefined,
): string | null {
  if (value == null) return null;
  const n = Math.round(Number(value)).toLocaleString();
  return isEstimated ? `≈${n}` : n;
}


/** True when the payload contains a usable lat/lng pair for a row endpoint. */
function hasPoint(...candidates: unknown[]): boolean {
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === "number" && Number.isFinite(c)) return true;
    if (typeof c === "string" && c.trim() !== "") return true;
    if (Array.isArray(c)) {
      if (c.length >= 2 && c.slice(0, 2).every((n) => Number.isFinite(Number(n)))) return true;
      continue;
    }
    if (typeof c === "object") {
      const o = c as Record<string, unknown>;
      const lat = numOrNull(o.lat ?? o.latitude ?? o.y);
      const lng = numOrNull(o.lng ?? o.lon ?? o.longitude ?? o.x);
      if (lat != null && lng != null) return true;
    }
  }
  return false;
}

/**
 * Descriptive block coverage: how much of a block's mapped rows are linked.
 * This is NOT the hydraulic allocation — that only ever comes from the server.
 */
export function blockCoveragePercent(selected: number, total: number): number | null {
  if (!total) return null;
  return (selected / total) * 100;
}


function otherValves(raw: any, currentValveId?: string | null): string[] {
  // Live SQL 126 shape: connected_valve_names + connected_valve_ids.
  const names: any[] = Array.isArray(raw?.connected_valve_names)
    ? raw.connected_valve_names
    : [];
  const ids: any[] = Array.isArray(raw?.connected_valve_ids) ? raw.connected_valve_ids : [];
  if (names.length > 0) {
    return names
      .map((n: any, i: number) => ({ name: String(n), id: ids[i] ? String(ids[i]) : null }))
      .filter((v) => !currentValveId || v.id !== currentValveId)
      .map((v) => v.name);
  }

  const source =
    raw?.other_valves ?? raw?.other_valve_names ?? raw?.conflicting_valves ?? null;
  if (!source) {
    const single = raw?.other_valve_name ?? raw?.existing_valve_name;
    return single ? [String(single)] : [];
  }
  if (!Array.isArray(source)) return [String(source)];
  return source
    .map((v: any) => (typeof v === "string" ? v : (v?.valve_name ?? v?.name ?? null)))
    .filter(Boolean)
    .map(String);
}

function normaliseRow(
  raw: any,
  block: { id: string; name: string; variety: string | null },
  currentValveId?: string | null,
): AvailableRow {
  return {
    row_id: String(raw?.row_id ?? raw?.id ?? raw?.paddock_row_id),
    row_number: numOrNull(raw?.row_number ?? raw?.number),
    row_label: raw?.row_label ?? raw?.label ?? null,
    block_id: String(raw?.block_id ?? raw?.paddock_id ?? block.id),
    block_name: String(raw?.block_name ?? raw?.paddock_name ?? block.name),
    variety_name: raw?.variety_name ?? raw?.variety ?? block.variety,
    row_length_m: numOrNull(
      raw?.row_length_metres ?? raw?.row_length_m ?? raw?.length_m ?? raw?.row_length,
    ),
    vine_count: numOrNull(raw?.vine_count ?? raw?.vines),
    emitter_count: numOrNull(raw?.emitter_count ?? raw?.emitters),
    vine_count_basis: raw?.vine_count_basis ?? null,
    vine_count_is_estimated: boolOrNull(raw?.vine_count_is_estimated),
    emitter_count_basis: raw?.emitter_count_basis ?? null,
    emitter_count_is_estimated: boolOrNull(raw?.emitter_count_is_estimated),

    has_start_point: hasPoint(
      raw?.start_point,
      raw?.startPoint,
      raw?.start_latitude,
      raw?.start_lat,
    ),
    has_end_point: hasPoint(raw?.end_point, raw?.endPoint, raw?.end_latitude, raw?.end_lat),
    other_valve_names: otherValves(raw, currentValveId),
  };
}

/**
 * Accepts either a flat row array or blocks-with-rows and returns block groups
 * keyed by the real paddock record (block_id / block_name), never by variety.
 * `currentValveId` is excluded from the overlap ("also on") warning.
 */
export function normaliseAvailableRows(
  payload: unknown,
  currentValveId?: string | null,
): AvailableRowBlock[] {
  const list: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.blocks)
      ? (payload as any).blocks
      : Array.isArray((payload as any)?.rows)
        ? (payload as any).rows
        : [];

  const groups = new Map<string, AvailableRowBlock>();
  const push = (row: AvailableRow) => {
    const existing = groups.get(row.block_id);
    if (existing) existing.rows.push(row);
    else
      groups.set(row.block_id, {
        block_id: row.block_id,
        block_name: row.block_name,
        variety_name: row.variety_name,
        rows: [row],
      });
  };

  for (const entry of list) {
    if (entry && Array.isArray(entry.rows)) {
      const block = {
        id: String(entry.block_id ?? entry.paddock_id ?? entry.id),
        name: String(entry.block_name ?? entry.paddock_name ?? entry.name ?? "Block"),
        variety: entry.variety_name ?? entry.variety ?? null,
      };
      for (const r of entry.rows) push(normaliseRow(r, block, currentValveId));
    } else if (entry) {
      push(normaliseRow(entry, { id: "unknown", name: "Block", variety: null }, currentValveId));
    }
  }

  const blocks = Array.from(groups.values());
  for (const b of blocks) {
    b.rows.sort((x, y) => (x.row_number ?? 0) - (y.row_number ?? 0));
  }
  blocks.sort((a, b) => a.block_name.localeCompare(b.block_name, undefined, { numeric: true }));
  return blocks;
}


/** Row UUIDs from list_irrigation_valve_rows — never inferred from row_start/row_end. */
export function extractSelectedRowIds(payload: unknown): string[] {
  const list: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.rows)
      ? (payload as any).rows
      : Array.isArray((payload as any)?.blocks)
        ? (payload as any).blocks.flatMap((b: any) => b?.rows ?? [])
        : [];
  return list
    .map((r: any) =>
      typeof r === "string" ? r : (r?.row_id ?? r?.paddock_row_id ?? r?.id ?? null),
    )
    .filter(Boolean)
    .map(String);
}

/** Compress only genuinely contiguous numbers: [1,2,5,8] → "1–2, 5, 8". */
export function formatRowRanges(numbers: Array<number | null | undefined>): string {
  const nums = Array.from(
    new Set(numbers.filter((n): n is number => Number.isFinite(n as number))),
  ).sort((a, b) => a - b);
  if (nums.length === 0) return "—";
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const cur = nums[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}–${prev}`);
    if (cur == null) break;
    start = cur;
    prev = cur;
  }
  return parts.join(", ");
}

export interface SnapshotRowBlock {
  block_id: string;
  block_name: string;
  row_numbers: number[];
  row_count: number;
  allocation_percentage: number | null;
  weighting_basis: string | null;
  /** SQL 127 snapshot values — frozen at the time the session was recorded. */
  selected_vine_count: number | null;
  selected_emitter_count: number | null;
  selected_row_length_metres: number | null;
  vine_count_basis: string | null;
  emitter_count_basis: string | null;
  vine_count_is_estimated: boolean | null;
  emitter_count_is_estimated: boolean | null;
}

/**
 * Reads the frozen row detail out of a session's configuration snapshot.
 * Returns null when the session was not row-based.
 */
export function snapshotRowBlocks(snapshot: any): {
  blocks: SnapshotRowBlock[];
  weighting_basis: string | null;
  row_count: number;
} | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const basis = snapshot.weighting_basis ?? null;
  const blocksRaw: any[] = Array.isArray(snapshot.blocks)
    ? snapshot.blocks
    : Array.isArray(snapshot.allocations)
      ? snapshot.allocations
      : [];

  const blocks: SnapshotRowBlock[] = [];
  for (const b of blocksRaw) {
    const rows: any[] = Array.isArray(b?.rows) ? b.rows : [];
    if (rows.length === 0) continue;
    blocks.push({
      block_id: String(b.block_id ?? b.paddock_id ?? ""),
      block_name: String(b.block_name ?? b.paddock_name ?? "Block"),
      row_numbers: rows
        .map((r: any) => numOrNull(typeof r === "object" ? (r.row_number ?? r.number) : r))
        .filter((n): n is number => n != null),
      row_count: numOrNull(b.row_count) ?? rows.length,
      allocation_percentage: numOrNull(b.allocation_percentage),
      weighting_basis: b.weighting_basis ?? basis,
      selected_vine_count: numOrNull(b.selected_vine_count ?? b.vine_count),
      selected_emitter_count: numOrNull(b.selected_emitter_count ?? b.emitter_count),
      selected_row_length_metres: numOrNull(
        b.selected_row_length_metres ?? b.row_length_metres,
      ),
      vine_count_basis: b.vine_count_basis ?? null,
      emitter_count_basis: b.emitter_count_basis ?? null,
      vine_count_is_estimated: boolOrNull(b.vine_count_is_estimated),
      emitter_count_is_estimated: boolOrNull(b.emitter_count_is_estimated),
    });
  }

  if (blocks.length === 0) {
    if (snapshot.allocation_method !== "rows" && !snapshot.uses_rows) return null;
    return { blocks: [], weighting_basis: basis, row_count: numOrNull(snapshot.row_count) ?? 0 };
  }
  return {
    blocks,
    weighting_basis: basis,
    row_count:
      numOrNull(snapshot.row_count) ?? blocks.reduce((s, b) => s + b.row_count, 0),
  };
}

// ---------------------------------------------------------------------------
// SQL 127 block summaries (server-authoritative — never computed locally)
// ---------------------------------------------------------------------------

export interface ServerRowBlockSummary {
  block_id: string;
  block_name: string | null;
  selected_row_count: number | null;
  total_block_row_count: number | null;
  selected_row_length_metres: number | null;
  total_block_row_length_metres: number | null;
  selected_vine_count: number | null;
  selected_emitter_count: number | null;
  vine_count_is_estimated: boolean | null;
  emitter_count_is_estimated: boolean | null;
  vine_count_basis: string | null;
  emitter_count_basis: string | null;
  row_coverage_percent: number | null;
  length_coverage_percent: number | null;
  allocation_percentage: number | null;
  weighting_basis: string | null;
  warnings: string[];
}

export interface ServerRowSummary {
  blocks: Map<string, ServerRowBlockSummary>;
  weighting_basis: string | null;
  selected_vine_count: number | null;
  selected_emitter_count: number | null;
  vine_count_is_estimated: boolean | null;
  emitter_count_is_estimated: boolean | null;
  row_count: number | null;
  warnings: string[];
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : (x?.message ?? x?.warning ?? null))).filter(Boolean).map(String)
    : v
      ? [String(v)]
      : [];

/**
 * Reads the SQL 127 block-summary payload returned by
 * list_irrigation_valve_rows / set_irrigation_valve_rows. Any field the backend
 * does not return stays null — the portal never substitutes a computed value.
 */
export function normaliseServerRowSummary(payload: unknown): ServerRowSummary {
  const root: any = payload && typeof payload === "object" ? payload : {};
  const blocksRaw: any[] = Array.isArray(root.blocks)
    ? root.blocks
    : Array.isArray(root.block_summaries)
      ? root.block_summaries
      : [];

  const blocks = new Map<string, ServerRowBlockSummary>();
  for (const b of blocksRaw) {
    const id = String(b?.block_id ?? b?.paddock_id ?? "");
    if (!id) continue;
    blocks.set(id, {
      block_id: id,
      block_name: b?.block_name ?? b?.paddock_name ?? null,
      selected_row_count: numOrNull(b?.selected_row_count ?? b?.row_count),
      total_block_row_count: numOrNull(b?.total_block_row_count),
      selected_row_length_metres: numOrNull(b?.selected_row_length_metres),
      total_block_row_length_metres: numOrNull(b?.total_block_row_length_metres),
      selected_vine_count: numOrNull(b?.selected_vine_count),
      selected_emitter_count: numOrNull(b?.selected_emitter_count),
      vine_count_is_estimated: boolOrNull(b?.vine_count_is_estimated),
      emitter_count_is_estimated: boolOrNull(b?.emitter_count_is_estimated),
      vine_count_basis: b?.vine_count_basis ?? null,
      emitter_count_basis: b?.emitter_count_basis ?? null,
      row_coverage_percent: numOrNull(b?.row_coverage_percent),
      length_coverage_percent: numOrNull(b?.length_coverage_percent),
      allocation_percentage: numOrNull(b?.allocation_percentage),
      weighting_basis: b?.weighting_basis ?? root?.weighting_basis ?? null,
      warnings: stringList(b?.warnings),
    });
  }

  return {
    blocks,
    weighting_basis: root?.weighting_basis ?? null,
    selected_vine_count: numOrNull(root?.selected_vine_count),
    selected_emitter_count: numOrNull(root?.selected_emitter_count),
    vine_count_is_estimated: boolOrNull(root?.vine_count_is_estimated),
    emitter_count_is_estimated: boolOrNull(root?.emitter_count_is_estimated),
    row_count: numOrNull(root?.row_count ?? root?.selected_row_count),
    warnings: stringList(root?.warnings),
  };
}

// ---------------------------------------------------------------------------
// SQL 129 saved-row snapshots
// ---------------------------------------------------------------------------
//
// `list_irrigation_valve_rows` returns a flat array of saved rows, each already
// carrying the backend's own `vine_count` / `emitter_count` estimate and its
// basis. The portal only adds those server values together — it never derives a
// count from spacing, length or anything else, and a row the backend could not
// estimate is reported as unavailable rather than counted as zero.

export interface SavedRowEstimate {
  /** Sum of the server values that are present. Null when none are. */
  total: number | null;
  /** How many saved rows carried a server value. */
  rows_with_value: number;
  /** How many saved rows the backend could not estimate. */
  rows_missing: number;
  is_estimated: boolean | null;
  basis: string | null;
}

export interface SavedRowsBlockSummary {
  block_id: string;
  block_name: string;
  row_count: number;
  row_numbers: number[];
  row_length_metres: number | null;
  vines: SavedRowEstimate;
  emitters: SavedRowEstimate;
}

export interface SavedRowsSummary {
  row_count: number;
  row_numbers: number[];
  weighting_basis: string | null;
  vines: SavedRowEstimate;
  emitters: SavedRowEstimate;
  blocks: Map<string, SavedRowsBlockSummary>;
}

const EMPTY_ESTIMATE: SavedRowEstimate = {
  total: null,
  rows_with_value: 0,
  rows_missing: 0,
  is_estimated: null,
  basis: null,
};

function accumulate(
  rows: any[],
  valueKey: "vine_count" | "emitter_count",
  estimatedKey: "vine_count_is_estimated" | "emitter_count_is_estimated",
  basisKey: "vine_count_basis" | "emitter_count_basis",
): SavedRowEstimate {
  let total = 0;
  let withValue = 0;
  let missing = 0;
  let estimated: boolean | null = null;
  let basis: string | null = null;
  for (const r of rows) {
    const v = numOrNull(r?.[valueKey]);
    if (v == null) {
      missing += 1;
      continue;
    }
    total += v;
    withValue += 1;
    if (r?.[estimatedKey] === true) estimated = true;
    else if (estimated == null && r?.[estimatedKey] === false) estimated = false;
    if (basis == null && r?.[basisKey]) basis = String(r[basisKey]);
  }
  return {
    total: withValue > 0 ? total : null,
    rows_with_value: withValue,
    rows_missing: missing,
    is_estimated: estimated,
    basis,
  };
}

/** Flattens the saved-rows payload into a plain array of row records. */
export function savedRowRecords(payload: unknown): any[] {
  const list: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.rows)
      ? (payload as any).rows
      : Array.isArray((payload as any)?.blocks)
        ? (payload as any).blocks.flatMap((b: any) => b?.rows ?? [])
        : [];
  return list.filter((r) => r && typeof r === "object" && r.is_active !== false);
}

/** Server-value roll-up of a valve's saved rows (SQL 129). */
export function summariseSavedRows(payload: unknown): SavedRowsSummary {
  const rows = savedRowRecords(payload);
  const blocks = new Map<string, SavedRowsBlockSummary>();

  const byBlock = new Map<string, any[]>();
  for (const r of rows) {
    const id = String(r.block_id ?? r.paddock_id ?? "unknown");
    const bucket = byBlock.get(id);
    if (bucket) bucket.push(r);
    else byBlock.set(id, [r]);
  }

  for (const [id, list] of byBlock) {
    const lengths = list.map((r) => numOrNull(r.row_length_metres)).filter((n): n is number => n != null);
    blocks.set(id, {
      block_id: id,
      block_name: String(list[0]?.block_name ?? list[0]?.paddock_name ?? "Block"),
      row_count: list.length,
      row_numbers: list
        .map((r) => numOrNull(r.row_number))
        .filter((n): n is number => n != null),
      row_length_metres: lengths.length === list.length && lengths.length > 0
        ? lengths.reduce((s, n) => s + n, 0)
        : null,
      vines: accumulate(list, "vine_count", "vine_count_is_estimated", "vine_count_basis"),
      emitters: accumulate(
        list,
        "emitter_count",
        "emitter_count_is_estimated",
        "emitter_count_basis",
      ),
    });
  }

  return {
    row_count: rows.length,
    row_numbers: rows.map((r) => numOrNull(r.row_number)).filter((n): n is number => n != null),
    weighting_basis:
      rows.find((r) => r.weighting_basis)?.weighting_basis ??
      (payload as any)?.weighting_basis ??
      null,
    vines: rows.length
      ? accumulate(rows, "vine_count", "vine_count_is_estimated", "vine_count_basis")
      : EMPTY_ESTIMATE,
    emitters: rows.length
      ? accumulate(rows, "emitter_count", "emitter_count_is_estimated", "emitter_count_basis")
      : EMPTY_ESTIMATE,
    blocks,
  };
}

/**
 * Renders a saved estimate honestly: the available total always shows, with the
 * unavailable row count alongside it. Only a total with no server values at all
 * reads as unavailable.
 */
export function savedEstimateLines(
  estimate: SavedRowEstimate | null | undefined,
  totalRows: number,
  noun: string,
): { primary: string; secondary: string | null } {
  if (!estimate || estimate.rows_with_value === 0) {
    return {
      primary: "Not available",
      secondary:
        estimate && estimate.rows_missing > 0
          ? `${estimate.rows_missing} row${estimate.rows_missing === 1 ? "" : "s"} unavailable`
          : null,
    };
  }
  const value = formatEstimate(estimate.total, estimate.is_estimated ?? true)!;
  const partial = estimate.rows_missing > 0;
  return {
    primary: partial
      ? `${value} ${noun} across ${estimate.rows_with_value} of ${totalRows} rows`
      : `${value} ${noun}`,
    secondary: partial
      ? `${estimate.rows_missing} row${estimate.rows_missing === 1 ? "" : "s"} unavailable`
      : null,
  };
}
