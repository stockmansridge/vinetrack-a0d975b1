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
