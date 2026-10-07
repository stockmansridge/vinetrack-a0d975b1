// Manual row edits for Contour Row Mapping drafts. Every edit keeps the
// row id and marks the row as "edited" so regeneration can warn first.
import { generateUuid } from "@/lib/uuid";
import type { DraftRow } from "./draft";
import { type LatLng, makeProjection } from "./geometry";

const edited = (r: DraftRow, parts: DraftRow["parts"]): DraftRow => ({ ...r, parts, provenance: r.provenance === "imported" ? "imported" : "edited" });

export function moveVertex(r: DraftRow, part: number, idx: number, to: LatLng): DraftRow {
  return edited(r, r.parts.map((p, i) => i !== part ? p : { ...p, points: p.points.map((q, j) => (j === idx ? { ...to } : q)) }));
}

/** Delete a vertex. A part reduced below two points is removed. */
export function deleteVertex(r: DraftRow, part: number, idx: number): DraftRow {
  const parts = r.parts
    .map((p, i) => (i !== part ? p : { ...p, points: p.points.filter((_, j) => j !== idx) }))
    .filter((p) => p.points.length >= 2);
  return edited(r, parts);
}

export function insertVertexAfter(r: DraftRow, part: number, idx: number): DraftRow {
  return edited(r, r.parts.map((p, i) => {
    if (i !== part || idx >= p.points.length - 1) return p;
    const a = p.points[idx], b = p.points[idx + 1];
    const pts = p.points.slice();
    pts.splice(idx + 1, 0, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
    return { ...p, points: pts };
  }));
}

/** Split a part by removing the segment after vertex `idx`. Both pieces stay one logical row. */
export function splitAfterVertex(r: DraftRow, part: number, idx: number): DraftRow {
  const p = r.parts[part];
  if (!p || idx < 1 || idx > p.points.length - 3) throw new Error("Choose a point with at least one segment on each side to split.");
  const a = { id: p.id, points: p.points.slice(0, idx + 1) };
  const b = { id: generateUuid(), points: p.points.slice(idx + 1) };
  const parts = r.parts.slice();
  parts.splice(part, 1, a, b);
  return edited(r, parts);
}

/** Trim `m` metres off the start or end of the whole row (across parts). */
export function trimRow(r: DraftRow, end: "start" | "end", m: number): DraftRow {
  if (!(m > 0)) return r;
  const flipAll = (parts: DraftRow["parts"]) => parts.slice().reverse().map((p) => ({ ...p, points: p.points.slice().reverse() }));
  let parts = end === "end" ? flipAll(r.parts) : r.parts.map((p) => ({ ...p, points: p.points.slice() }));
  let left = m;
  while (left > 0 && parts.length) {
    const p = parts[0];
    const proj = makeProjection(p.points[0]);
    let consumed = false;
    while (p.points.length >= 2 && left > 0) {
      const a = proj.toXY(p.points[0]), b = proj.toXY(p.points[1]);
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg <= left) { left -= seg; p.points.shift(); continue; }
      const t = left / seg;
      p.points[0] = proj.toLL({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      left = 0; consumed = true;
    }
    if (!consumed && p.points.length < 2) parts = parts.slice(1);
    else break;
  }
  if (end === "end") parts = flipAll(parts);
  return edited(r, parts.filter((p) => p.points.length >= 2));
}
