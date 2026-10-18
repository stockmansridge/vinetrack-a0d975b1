// Contour Row Mapping (Beta) — block freshness. The editor validates a draft
// against a snapshot of the block (boundary + operational row ids). Before
// every Save Draft (and on window focus) the block is re-read; if it moved,
// the save stops and the user explicitly rechecks. Read-only: never writes
// paddocks or the draft. NOTE: the save RPC does not lock the block, so a
// boundary change between this read and the save can still slip through.
import { fetchOne } from "@/lib/queries";
import { parsePolygonPoints, parseRows } from "@/lib/paddockGeometry";

export interface BlockSnapshot { boundaryKey: string; rowIdsKey: string; rowNumbersKey: string; rowGeometryKey: string }
export interface BlockDiff { boundaryChanged: boolean; rowIdentityChanged: boolean; rowNumbersChanged: boolean; rowGeometryChanged: boolean; /** any row change */ rowsChanged: boolean }

const r9 = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : null);

/** Canonical, property-order-independent snapshot of the block's operational inputs. */
export function blockSnapshot(paddock: any): BlockSnapshot {
  const b = parsePolygonPoints(paddock?.polygon_points).map((p) => [r9(p.lat), r9(p.lng)]);
  const rows = parseRows(paddock?.rows).map((r) => ({
    id: r.id ?? "", n: typeof r.number === "number" ? r.number : null,
    g: [r9(r.start?.lat), r9(r.start?.lng), r9(r.end?.lat), r9(r.end?.lng)],
  })).sort((a, c) => (a.id < c.id ? -1 : a.id > c.id ? 1 : (a.n ?? 0) - (c.n ?? 0)));
  return {
    boundaryKey: JSON.stringify(b),
    rowIdsKey: JSON.stringify(rows.map((r) => r.id)),
    rowNumbersKey: JSON.stringify(rows.map((r) => [r.id, r.n])),
    rowGeometryKey: JSON.stringify(rows.map((r) => [r.id, r.g])),
  };
}

export function diffBlock(a: BlockSnapshot, b: BlockSnapshot): BlockDiff {
  const rowIdentityChanged = a.rowIdsKey !== b.rowIdsKey;
  const rowNumbersChanged = a.rowNumbersKey !== b.rowNumbersKey;
  const rowGeometryChanged = a.rowGeometryKey !== b.rowGeometryKey;
  return { boundaryChanged: a.boundaryKey !== b.boundaryKey, rowIdentityChanged, rowNumbersChanged, rowGeometryChanged,
    rowsChanged: rowIdentityChanged || rowNumbersChanged || rowGeometryChanged };
}

export const blockChanged = (d: BlockDiff) => d.boundaryChanged || d.rowsChanged;

/** Plain-language list of what changed. */
export function describeBlockChange(d: BlockDiff): string[] {
  const out: string[] = [];
  if (d.boundaryChanged) out.push("The block boundary was changed");
  if (d.rowIdentityChanged) out.push("Operational rows were added or removed");
  if (d.rowNumbersChanged && !d.rowIdentityChanged) out.push("Operational row numbers were changed");
  if (d.rowGeometryChanged && !d.rowIdentityChanged) out.push("Operational row positions were changed");
  return out;
}

export class BlockFreshnessError extends Error {
  constructor(public kind: "network" | "scope", message: string) { super(message); }
}

/** Authoritative re-read of the block, scoped to the selected vineyard. */
export async function fetchCurrentBlock(vineyardId: string, paddockId: string): Promise<any> {
  let row: any;
  try { row = await fetchOne("paddocks", paddockId); }
  catch { throw new BlockFreshnessError("network", "Couldn't confirm the block is up to date (connection problem). Nothing was saved — try again."); }
  if (!row || row.id !== paddockId || row.vineyard_id !== vineyardId || row.deleted_at)
    throw new BlockFreshnessError("scope", "This block is no longer available in the selected vineyard. Nothing was saved — export a backup.");
  return row;
}

/** Draft vs operational row numbers (advisory only). */
export function compareNumbering(draftNumbers: number[], operationalNumbers: number[]) {
  const d = new Set(draftNumbers), o = new Set(operationalNumbers);
  return {
    draftCount: d.size, operationalCount: o.size,
    onlyInDraft: [...d].filter((n) => !o.has(n)).sort((a, b) => a - b),
    onlyOperational: [...o].filter((n) => !d.has(n)).sort((a, b) => a - b),
    same: d.size === o.size && [...d].every((n) => o.has(n)),
  };
}
