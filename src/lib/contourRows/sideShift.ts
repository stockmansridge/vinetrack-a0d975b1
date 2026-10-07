// Rigid side shift ("nudge") of one row group in block-local metres.
// Moves the group's reference trace and every row-part vertex by the same
// metre vector, perpendicular to the start→end direction. Masks, other
// groups, ids, numbers, provenance and canonical links are untouched.
import type { RowGroup } from "./draft";
import { type LatLng, type Projection, isFiniteLL, projectionForPolygon } from "./geometry";

export type ShiftSide = "left" | "right";
export const SHIFT_LIMITS = { minM: 0.01, maxM: 10, defaultM: 0.1 };

export interface ShiftDirection {
  /** Unit vector start→end in block-local metres (x east, y north). */
  ux: number; uy: number;
  source: "trace" | "row";
  rowNumber?: number;
  /** For source "row": the exact points used as start and end (for a map cue). */
  start?: LatLng; end?: LatLng;
}

const MIN_CHORD_M = 0.5;

function chord(pts: LatLng[], proj: Projection): { ux: number; uy: number; start: LatLng; end: LatLng } | null {
  const ok = pts.filter(isFiniteLL);
  if (ok.length < 2) return null;
  const a = proj.toXY(ok[0]), b = proj.toXY(ok[ok.length - 1]);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len >= MIN_CHORD_M ? { ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, start: ok[0], end: ok[ok.length - 1] } : null;
}

/** Trace start→end; for traceless (imported) groups, the first usable row's first→last point. */
export function shiftDirection(g: RowGroup, proj: Projection): ShiftDirection | null {
  const t = chord(g.referenceTrace, proj);
  if (t) return { ux: t.ux, uy: t.uy, source: "trace" };
  for (const r of [...g.rows].sort((a, b) => a.number - b.number)) {
    const pts = r.parts.flatMap((p) => p.points);
    const c = chord(pts, proj);
    if (c) return { ...c, source: "row", rowNumber: r.number };
  }
  return null;
}

/** Block-local projection used for all shifts (centroid of the boundary). */
export const shiftProjection = (boundary: LatLng[], fallback: LatLng) =>
  projectionForPolygon(boundary.length ? boundary : [fallback]);

export function shiftGroup(g: RowGroup, proj: Projection, metres: number, side: ShiftSide): RowGroup {
  if (!(metres >= SHIFT_LIMITS.minM && metres <= SHIFT_LIMITS.maxM)) throw new Error(`Enter a shift between ${SHIFT_LIMITS.minM} and ${SHIFT_LIMITS.maxM} m.`);
  const dir = shiftDirection(g, proj);
  if (!dir) throw new Error("This group has no trace or row long enough to give a direction.");
  // Left of travel = (-uy, ux).
  const s = side === "left" ? 1 : -1;
  const vx = -dir.uy * metres * s, vy = dir.ux * metres * s;
  const mv = (p: LatLng): LatLng => { const q = proj.toXY(p); return proj.toLL({ x: q.x + vx, y: q.y + vy }); };
  return {
    ...g,
    referenceTrace: g.referenceTrace.map(mv),
    rows: g.rows.map((r) => ({ ...r, parts: r.parts.map((p) => ({ ...p, points: p.points.map(mv) })) })),
  };
}

/** Small, stable content hash (cyrb53) so undo keeps no second copy of the group. */
export function hashGroup(g: RowGroup): string {
  const str = JSON.stringify(g);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${str.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

/** Single "undo last shift" entry: valid only while the group is still exactly the shifted result. */
export interface ShiftUndo { groupId: string; before: RowGroup; afterHash: string }
export const makeShiftUndo = (before: RowGroup, after: RowGroup): ShiftUndo => ({ groupId: before.id, before, afterHash: hashGroup(after) });
export function canUndoShift(entry: ShiftUndo | null, g: RowGroup | null): boolean {
  return !!g && !!entry && entry.groupId === g.id && entry.afterHash === hashGroup(g);
}
