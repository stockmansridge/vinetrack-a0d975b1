// Contour Row Mapping (Beta) — draft-only row deletion and renumbering.
// Never regenerates geometry and never infers canonical identity from numbers.
import { LIMITS, totalRowsFor, type ContourDraft, type RowGroup, type DraftRow } from "./draft";

/** Remove one logical draft row (all parts) by stable group + row id. Others untouched. */
export function deleteDraftRow(d: ContourDraft, groupId: string, rowId: string): ContourDraft {
  const g = d.groups.find((x) => x.id === groupId);
  if (!g || !g.rows.some((r) => r.id === rowId)) return d;
  return { ...d, groups: d.groups.map((x) => (x.id === groupId ? { ...x, rows: x.rows.filter((r) => r.id !== rowId) } : x)) };
}

/**
 * Spatial order used for numbering, left → right.
 * Rows with an offsetIndex sort by it (traced row = 0, left negative).
 * Rows without one (imported) follow their existing order in the group
 * (the order they were imported in) after offset rows. Stable and deterministic.
 */
export function spatialOrder(rows: DraftRow[]): DraftRow[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const ao = a.r.offsetIndex, bo = b.r.offsetIndex;
    if (ao != null && bo != null) return ao - bo || a.i - b.i;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return a.i - b.i;
  }).map((x) => x.r);
}

export type RenumberPlan = { ok: true; numbers: Map<string, number>; changed: number } | { ok: false; error: string };

/** Numbers for the PRESENT rows: start, start+1, … in spatial order (reversed when descending). */
export function planRenumber(d: ContourDraft, groupId: string): RenumberPlan {
  const g = d.groups.find((x) => x.id === groupId);
  if (!g) return { ok: false, error: "Group not found." };
  const start = g.startNumber;
  if (!Number.isInteger(start) || start < 1 || start > LIMITS.maxRowNumber)
    return { ok: false, error: `Starting row number must be a whole number from 1 to ${LIMITS.maxRowNumber}.` };
  const ordered = spatialOrder(g.rows);
  if (!g.ascending) ordered.reverse();
  const numbers = new Map<string, number>();
  ordered.forEach((r, i) => numbers.set(r.id, start + i));
  const last = start + ordered.length - 1;
  if (ordered.length && last > LIMITS.maxRowNumber)
    return { ok: false, error: `Row numbers would go up to ${last}, above the limit of ${LIMITS.maxRowNumber}.` };
  const others = new Set(d.groups.filter((x) => x.id !== groupId).flatMap((x) => x.rows.map((r) => r.number)));
  const clash = [...numbers.values()].filter((n) => others.has(n));
  if (clash.length) return { ok: false, error: `Row numbers ${clash.slice(0, 5).join(", ")} are already used by another group. Choose a different starting row number.` };
  const changed = g.rows.filter((r) => numbers.get(r.id) !== r.number).length;
  return { ok: true, numbers, changed };
}

/** Apply a validated plan: only `number` changes; ids, parts, provenance, source, links kept. */
export function applyRenumber(d: ContourDraft, groupId: string, plan: Extract<RenumberPlan, { ok: true }>): ContourDraft {
  return { ...d, groups: d.groups.map((g) => (g.id !== groupId ? g : {
    ...g, rows: g.rows.map((r) => { const n = plan.numbers.get(r.id); return n == null || n === r.number ? r : { ...r, number: n }; }),
  })) };
}

/** Drafted vs configured status, for "settings need regeneration" cues. */
export function groupStatus(d: ContourDraft, g: RowGroup) {
  const configured = g.mode === "imported" ? g.rows.length : totalRowsFor(g);
  const plan = planRenumber(d, g.id);
  return {
    drafted: g.rows.length,
    configured,
    countDiffers: g.mode !== "imported" && g.rows.length > 0 && configured !== g.rows.length,
    numbersOutOfDate: plan.ok && plan.changed > 0,
  };
}

/** Start points of the lowest- and highest-numbered rows (one label when they coincide). */
export function firstLastRowStarts(rows: DraftRow[]): { rowId: string; number: number; point: { lat: number; lng: number } }[] {
  const usable = rows.map((r) => ({ r, p: r.parts.find((x) => x.points.length > 0)?.points[0] }))
    .filter((x): x is { r: DraftRow; p: { lat: number; lng: number } } => !!x.p && Number.isFinite(x.r.number));
  if (!usable.length) return [];
  usable.sort((a, b) => a.r.number - b.r.number);
  const pick = usable.length === 1 ? [usable[0]] : [usable[0], usable[usable.length - 1]];
  return pick.map(({ r, p }) => ({ rowId: r.id, number: r.number, point: p }));
}
