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
}

const MIN_CHORD_M = 0.5;

function chord(pts: LatLng[], proj: Projection): { ux: number; uy: number } | null {
  const ok = pts.filter(isFiniteLL);
  if (ok.length < 2) return null;
  const a = proj.toXY(ok[0]), b = proj.toXY(ok[ok.length - 1]);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len >= MIN_CHORD_M ? { ux: (b.x - a.x) / len, uy: (b.y - a.y) / len } : null;
}

/** Trace start→end; for traceless (imported) groups, the first usable row's first→last point. */
export function shiftDirection(g: RowGroup, proj: Projection): ShiftDirection | null {
  const t = chord(g.referenceTrace, proj);
  if (t) return { ...t, source: "trace" };
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

/** Undo stack entry: valid only while the group is still exactly `after`. */
export interface ShiftUndo { groupId: string; before: RowGroup; afterJson: string }
export function canUndoShift(stack: ShiftUndo[], g: RowGroup | null): boolean {
  const top = stack[stack.length - 1];
  return !!g && !!top && top.groupId === g.id && top.afterJson === JSON.stringify(g);
}
