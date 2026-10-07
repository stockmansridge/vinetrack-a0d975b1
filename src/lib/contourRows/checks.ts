// Contour Row Mapping (Beta) — final geometry checks run before save and
// before any import is committed, and shown live in the editor.
//
// Uses a uniform segment grid so only nearby segments are compared, and a
// hard cap on pair tests so a pathological draft can't freeze the page.
// Parts of a multipart row are always treated separately (never flattened).
import type { ContourDraft, GenIssue } from "./draft";
import {
  type LatLng, type XY, projectionForPolygon, pointInPolygonXY, distToRingXY, segRelation, maskProblem,
} from "./geometry";

export const CHECK_LIMITS = { cellM: 10, maxCellsPerSegment: 400, maxPairTests: 3_000_000, tolM: 1, minPartM: 0.1, minSegM: 0.01 };

interface Seg { a: XY; b: XY; row: number; part: number; i: number; n: number }

export function checkDraftGeometry(d: ContourDraft, boundary: LatLng[]): GenIssue[] {
  const issues: GenIssue[] = [];
  const seen = new Set<string>();
  const push = (level: GenIssue["level"], message: string, rowNumber?: number) => {
    if (seen.has(message) || issues.length >= 50) return;
    seen.add(message); issues.push({ level, message, rowNumber });
  };
  if (boundary.length < 3) {
    if (d.groups.some((g) => g.rows.length)) push("error", "This block has no boundary, so draft rows can't be checked.");
    return issues;
  }
  const proj = projectionForPolygon(boundary);
  const ring = boundary.map(proj.toXY);
  const inside = (p: XY, poly: XY[]) => pointInPolygonXY(p, poly) || distToRingXY(p, poly) <= CHECK_LIMITS.tolM;
  const strictlyInside = (p: XY, poly: XY[]) => pointInPolygonXY(p, poly) && distToRingXY(p, poly) > CHECK_LIMITS.tolM;

  const segs: Seg[] = [];
  let rowIdx = 0;
  const rowNum: number[] = [];
  for (const g of d.groups) {
    const area = g.workingArea;
    if (area) { const why = maskProblem(area, proj); if (why) push("error", `"${g.name}": the working area ${why}.`); }
    g.exclusions.forEach((m, i) => { const why = maskProblem(m.points, proj); if (why) push("error", `"${g.name}": cut-out ${i + 1} ${why}.`); });
    const areaXY = area && !maskProblem(area, proj) ? area.map(proj.toXY) : null;
    const exXY = g.exclusions.filter((m) => !maskProblem(m.points, proj)).map((m) => m.points.map(proj.toXY));
    for (const r of g.rows) {
      const ri = rowIdx++; rowNum[ri] = r.number;
      r.parts.forEach((p, pi) => {
        const xy = p.points.map(proj.toXY);
        let len = 0;
        for (let i = 0; i < xy.length - 1; i++) {
          const L = Math.hypot(xy[i + 1].x - xy[i].x, xy[i + 1].y - xy[i].y);
          if (L < CHECK_LIMITS.minSegM) push("error", `Row ${r.number} has repeated points. Delete the duplicate point.`, r.number);
          len += L;
          segs.push({ a: xy[i], b: xy[i + 1], row: ri, part: pi, i, n: xy.length - 1 });
        }
        if (len < CHECK_LIMITS.minPartM) push("error", `Row ${r.number} has a part with no real length.`, r.number);
        // Vertices and segment midpoints must stay inside the block / working area and out of cut-outs.
        const samples = xy.concat(xy.slice(1).map((q, i) => ({ x: (q.x + xy[i].x) / 2, y: (q.y + xy[i].y) / 2 })));
        if (samples.some((q) => !inside(q, ring))) push("error", `Row ${r.number} goes outside the block boundary.`, r.number);
        if (g.mode !== "imported") {
          if (areaXY && samples.some((q) => !inside(q, areaXY))) push("error", `Row ${r.number} goes outside its group's working area.`, r.number);
          if (exXY.some((ex) => samples.some((q) => strictlyInside(q, ex)))) push("error", `Row ${r.number} runs through a cut-out.`, r.number);
        }
      });
    }
  }

  // Spatial grid.
  const C = CHECK_LIMITS.cellM;
  const grid = new Map<string, number[]>();
  for (let s = 0; s < segs.length; s++) {
    const { a, b } = segs[s];
    const x0 = Math.floor(Math.min(a.x, b.x) / C), x1 = Math.floor(Math.max(a.x, b.x) / C);
    const y0 = Math.floor(Math.min(a.y, b.y) / C), y1 = Math.floor(Math.max(a.y, b.y) / C);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > CHECK_LIMITS.maxCellsPerSegment) {
      push("error", `Row ${rowNum[segs[s].row]} has a very long straight segment. Add points along it so it can be checked.`, rowNum[segs[s].row]);
      continue;
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`; const c = grid.get(k); if (c) c.push(s); else grid.set(k, [s]);
    }
  }
  let tests = 0;
  const pairSeen = new Set<string>();
  outer: for (const [key, list] of grid) {
    const [cx, cy] = key.split(",").map(Number);
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const A = segs[list[u]], B = segs[list[v]];
      // Only test the pair in the cell holding the min corner of their bbox overlap (dedupe).
      const ox = Math.max(Math.min(A.a.x, A.b.x), Math.min(B.a.x, B.b.x));
      const oy = Math.max(Math.min(A.a.y, A.b.y), Math.min(B.a.y, B.b.y));
      if (Math.floor(ox / C) !== cx || Math.floor(oy / C) !== cy) continue;
      if (++tests > CHECK_LIMITS.maxPairTests) {
        push("error", "This draft is too complex to check fully. Split it into smaller groups or use fewer points.");
        break outer;
      }
      const rel = segRelation(A.a, A.b, B.a, B.b);
      if (rel === "none") continue;
      if (A.row === B.row && A.part === B.part) {
        const adjacent = Math.abs(A.i - B.i) === 1;
        if (adjacent && rel !== "overlap") continue;
        push("error", `Row ${rowNum[A.row]} crosses or doubles back on itself.`, rowNum[A.row]);
      } else if (A.row === B.row) {
        push("error", `Row ${rowNum[A.row]} has parts that touch or overlap. Join or separate them.`, rowNum[A.row]);
      } else {
        const lo = Math.min(rowNum[A.row], rowNum[B.row]), hi = Math.max(rowNum[A.row], rowNum[B.row]);
        const k = `${lo}:${hi}`;
        if (pairSeen.has(k)) continue; pairSeen.add(k);
        push("error", rel === "overlap" ? `Rows ${lo} and ${hi} overlap.` : `Rows ${lo} and ${hi} cross or touch.`, lo);
      }
    }
  }
  return issues;
}

export const hasErrors = (issues: GenIssue[]) => issues.some((i) => i.level === "error");
