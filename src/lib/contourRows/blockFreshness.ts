// Contour Row Mapping (Beta) — block freshness. The editor validates a draft
// against a snapshot of the block (boundary + operational row ids). Before
// every Save Draft (and on window focus) the block is re-read; if it moved,
// the save stops and the user explicitly rechecks. Read-only: never writes
// paddocks or the draft. NOTE: the save RPC does not lock the block, so a
// boundary change between this read and the save can still slip through.
import { fetchOne } from "@/lib/queries";
import { parsePolygonPoints, parseRows } from "@/lib/paddockGeometry";

export interface BlockSnapshot { boundaryKey: string; rowIdsKey: string }
export interface BlockDiff { boundaryChanged: boolean; rowsChanged: boolean }

export function blockSnapshot(paddock: any): BlockSnapshot {
  const b = parsePolygonPoints(paddock?.polygon_points).map((p) => [p.lat, p.lng]);
  const ids = parseRows(paddock?.rows).map((r) => r.id ?? "").sort();
  return { boundaryKey: JSON.stringify(b), rowIdsKey: JSON.stringify(ids) };
}

export function diffBlock(a: BlockSnapshot, b: BlockSnapshot): BlockDiff {
  return { boundaryChanged: a.boundaryKey !== b.boundaryKey, rowsChanged: a.rowIdsKey !== b.rowIdsKey };
}

export const blockChanged = (d: BlockDiff) => d.boundaryChanged || d.rowsChanged;

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
