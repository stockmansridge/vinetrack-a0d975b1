// Contour Row Mapping (Beta) — versioned draft model, generator,
// validation and identity rules. See docs/contour-row-mapping-contract.md.
//
// Drafts are review-only. Nothing here writes paddocks.rows or any other
// operational block input.

import { generateUuid } from "@/lib/uuid";
import {
  type LatLng, type XY, type Projection,
  projectionForPolygon, isFiniteLL, chaikin, extendEnds, offsetPolyline,
  clipPolyline, polylineSelfIntersects, polylinesCross, minDistanceBetween,
  polylineLengthXY, dedupeXY, multipartLengthM, chordLengthM,
} from "./geometry";

export const DRAFT_SCHEMA = "vinetrack.contour_row_mapping_draft";
export const DRAFT_SCHEMA_VERSION = 1;

export const LIMITS = {
  maxGroups: 50,
  maxRows: 2000,
  maxPointsPerRow: 2000,
  maxTotalPoints: 200_000,
  maxSideCount: 300,
  maxTracePoints: 500,
  minSpacingM: 0.5,
  maxSpacingM: 20,
};

export type GroupMode = "straight" | "contour" | "imported";
export type RowProvenance = "generated" | "edited" | "imported";

export interface DraftPart { id: string; points: LatLng[] }
export interface DraftRow {
  id: string;
  number: number;
  /** -left..+right position relative to the reference (0 = reference). null for imported rows. */
  offsetIndex: number | null;
  parts: DraftPart[];
  provenance: RowProvenance;
  /** Optional explicit link to an existing canonical paddocks.rows id. Never inferred from number. */
  canonicalRowId: string | null;
  source?: { format: string; fileName?: string; featureIndex?: number; name?: string } | null;
}
export interface DraftMask { id: string; points: LatLng[] }
export interface RowGroup {
  id: string;
  name: string;
  mode: GroupMode;
  /** Points as clicked/traced. Straight mode uses the first and last point. */
  referenceTrace: LatLng[];
  /** 0–2 Chaikin iterations applied before offsetting. The resulting path is what rows are built from. */
  smoothing: number;
  spacingM: number;
  startNumber: number;
  ascending: boolean;
  leftCount: number;
  rightCount: number;
  extendToArea: boolean;
  workingArea: LatLng[] | null;
  exclusions: DraftMask[];
  rows: DraftRow[];
}
export interface ContourDraft {
  schema: typeof DRAFT_SCHEMA;
  version: number;
  draftId: string;
  vineyardId: string;
  paddockId: string;
  groups: RowGroup[];
}

export const totalRowsFor = (g: Pick<RowGroup, "leftCount" | "rightCount">) => 1 + g.leftCount + g.rightCount;

export function newDraft(vineyardId: string, paddockId: string): ContourDraft {
  return { schema: DRAFT_SCHEMA, version: DRAFT_SCHEMA_VERSION, draftId: generateUuid(), vineyardId, paddockId, groups: [] };
}

export function newGroup(name: string, startNumber = 1): RowGroup {
  return {
    id: generateUuid(), name, mode: "contour", referenceTrace: [], smoothing: 0,
    spacingM: 2.5, startNumber, ascending: true, leftCount: 0, rightCount: 10,
    extendToArea: true, workingArea: null, exclusions: [], rows: [],
  };
}

export function nextFreeRowNumber(d: ContourDraft): number {
  let m = 0;
  for (const g of d.groups) for (const r of g.rows) m = Math.max(m, r.number);
  return m + 1;
}

// -------------------------------------------------------------- generator

export interface GenIssue { level: "error" | "warning"; rowNumber?: number; message: string }

/** Physical number for an offset index (leftmost row first when ascending). */
export function numberForOffset(g: RowGroup, offsetIndex: number): number {
  const posFromLeft = offsetIndex + g.leftCount; // 0..total-1
  const total = totalRowsFor(g);
  return g.ascending ? g.startNumber + posFromLeft : g.startNumber + (total - 1 - posFromLeft);
}

export function effectiveReferenceXY(g: RowGroup, proj: Projection): XY[] {
  const raw = g.referenceTrace.filter(isFiniteLL).map(proj.toXY);
  if (raw.length < 2) return [];
  const base = g.mode === "straight" ? [raw[0], raw[raw.length - 1]] : dedupeXY(raw);
  return g.mode === "contour" ? chaikin(base, g.smoothing) : base;
}

export interface GenerateResult { rows: DraftRow[]; issues: GenIssue[] }

/**
 * Generate rows for one group. Existing generated rows keep their id by
 * offsetIndex so identities survive regeneration. Rows are only
 * returned when there are no blocking errors.
 */
export function generateGroupRows(g: RowGroup, boundary: LatLng[]): GenerateResult {
  const issues: GenIssue[] = [];
  if (boundary.length < 3) return { rows: [], issues: [{ level: "error", message: "This block has no boundary. Draw the block boundary first." }] };
  if (g.mode === "imported") return { rows: g.rows, issues };
  if (!(g.spacingM >= LIMITS.minSpacingM && g.spacingM <= LIMITS.maxSpacingM))
    issues.push({ level: "error", message: `Row spacing must be between ${LIMITS.minSpacingM} and ${LIMITS.maxSpacingM} m.` });
  for (const [k, v] of [["left", g.leftCount], ["right", g.rightCount]] as const)
    if (!Number.isInteger(v) || v < 0 || v > LIMITS.maxSideCount) issues.push({ level: "error", message: `Rows on the ${k} must be a whole number from 0 to ${LIMITS.maxSideCount}.` });
  if (!Number.isInteger(g.startNumber) || g.startNumber < 1) issues.push({ level: "error", message: "Starting row number must be a whole number of 1 or more." });
  const proj = projectionForPolygon(boundary);
  const ref = effectiveReferenceXY(g, proj);
  if (ref.length < 2 || polylineLengthXY(ref) < 1)
    issues.push({ level: "error", message: "Trace one existing row first — click at least two points along it." });
  if (polylineSelfIntersects(ref)) issues.push({ level: "error", message: "The traced row crosses itself. Undo or drag points so it follows one row." });
  if (issues.some((i) => i.level === "error")) return { rows: [], issues };

  const region = {
    boundary: boundary.map(proj.toXY),
    workingArea: g.workingArea && g.workingArea.length >= 3 ? g.workingArea.map(proj.toXY) : null,
    exclusions: g.exclusions.filter((e) => e.points.length >= 3).map((e) => e.points.map(proj.toXY)),
  };
  let diag = 0;
  for (const a of region.boundary) for (const b of region.boundary) diag = Math.max(diag, Math.hypot(a.x - b.x, a.y - b.y));
  const base = g.extendToArea ? extendEnds(ref, diag) : ref;

  const prevByOffset = new Map<number, DraftRow>();
  for (const r of g.rows) if (r.offsetIndex != null) prevByOffset.set(r.offsetIndex, r);

  const rows: DraftRow[] = [];
  const xyRows: { number: number; parts: XY[][] }[] = [];
  for (let k = -g.leftCount; k <= g.rightCount; k++) {
    // k < 0 → left of arrow (positive offset); k > 0 → right.
    const off = offsetPolyline(base, -k * g.spacingM);
    const number = numberForOffset(g, k);
    if (off.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      issues.push({ level: "error", rowNumber: number, message: `Row ${number}: geometry could not be calculated. Adjust the trace.` });
      continue;
    }
    if (polylineSelfIntersects(off)) {
      issues.push({ level: "error", rowNumber: number, message: `Row ${number}: the curve is too tight at this distance and the row folds over itself. Use a smaller group or split this area into separate groups.` });
      continue;
    }
    const parts = clipPolyline(off, region);
    if (!parts.length) {
      issues.push({ level: "warning", rowNumber: number, message: `Row ${number} falls completely outside the working area and was skipped. Reduce the row count on that side.` });
      continue;
    }
    const totalPts = parts.reduce((s, p) => s + p.length, 0);
    if (totalPts > LIMITS.maxPointsPerRow) {
      issues.push({ level: "error", rowNumber: number, message: `Row ${number} has too many points. Trace with fewer points.` });
      continue;
    }
    const prev = prevByOffset.get(k);
    rows.push({
      id: prev?.id ?? generateUuid(), number, offsetIndex: k, provenance: "generated",
      canonicalRowId: prev?.canonicalRowId ?? null, source: null,
      parts: parts.map((p, idx) => ({ id: prev?.parts[idx]?.id ?? generateUuid(), points: p.map(proj.toLL) })),
    });
    xyRows.push({ number, parts });
  }
  // Neighbour checks — crossing or squeezing rows.
  for (let i = 1; i < xyRows.length; i++) {
    const a = xyRows[i - 1], b = xyRows[i];
    const A = a.parts.flat(), B = b.parts.flat();
    const crosses = a.parts.some((pa) => b.parts.some((pb) => polylinesCross(pa, pb)));
    if (crosses) issues.push({ level: "error", message: `Rows ${a.number} and ${b.number} cross. Use a smaller group or adjust the trace.` });
    else if (minDistanceBetween(A, B) < g.spacingM * 0.5)
      issues.push({ level: "warning", message: `Rows ${a.number} and ${b.number} come closer than half the spacing. Check the trace around tight bends.` });
  }
  if (issues.some((i) => i.level === "error")) return { rows: [], issues };
  return { rows, issues };
}

export const hasManualEdits = (g: RowGroup) => g.rows.some((r) => r.provenance === "edited");

// -------------------------------------------------------------- validation

export function validateDraft(d: ContourDraft): string[] {
  const errs: string[] = [];
  if (d.schema !== DRAFT_SCHEMA || d.version !== DRAFT_SCHEMA_VERSION) errs.push("Unsupported draft format.");
  if (d.groups.length > LIMITS.maxGroups) errs.push(`At most ${LIMITS.maxGroups} row groups.`);
  const ids = new Set<string>();
  const dup = (id: string) => { if (ids.has(id)) errs.push(`Duplicate identifier ${id}.`); ids.add(id); };
  dup(d.draftId);
  const numbers = new Map<number, string>();
  let rows = 0, pts = 0;
  for (const g of d.groups) {
    dup(g.id);
    for (const m of g.exclusions) dup(m.id);
    for (const r of g.rows) {
      dup(r.id); rows++;
      if (!Number.isInteger(r.number) || r.number < 1) errs.push(`Row in "${g.name}" has an invalid row number.`);
      const prev = numbers.get(r.number);
      if (prev) errs.push(`Row number ${r.number} is used twice (${prev} and ${g.name}).`);
      numbers.set(r.number, g.name);
      if (!r.parts.length) errs.push(`Row ${r.number} has no geometry.`);
      for (const p of r.parts) {
        dup(p.id); pts += p.points.length;
        if (p.points.length < 2) errs.push(`Row ${r.number} has a part with fewer than two points.`);
        if (!p.points.every(isFiniteLL)) errs.push(`Row ${r.number} has invalid coordinates.`);
      }
    }
  }
  if (rows > LIMITS.maxRows) errs.push(`At most ${LIMITS.maxRows} rows per draft.`);
  if (pts > LIMITS.maxTotalPoints) errs.push(`Too many points (${pts}).`);
  return Array.from(new Set(errs));
}

// ---------------------------------------------------------------- metrics

export interface RowMetric { rowId: string; number: number; lengthM: number; chordM: number; parts: number }
export function rowMetrics(rows: DraftRow[], boundary: LatLng[]): RowMetric[] {
  const proj = projectionForPolygon(boundary.length ? boundary : rows[0]?.parts[0]?.points ?? [{ lat: 0, lng: 0 }]);
  return rows.map((r) => {
    const parts = r.parts.map((p) => p.points);
    return { rowId: r.id, number: r.number, lengthM: multipartLengthM(parts, proj), chordM: chordLengthM(parts, proj), parts: r.parts.length };
  }).sort((a, b) => a.number - b.number);
}

// ---------------------------------------------------- export / import JSON

export interface DraftExportFile {
  format: "vinetrack.contour_row_mapping_export";
  exportVersion: 1;
  exportedAt: string;
  draft: ContourDraft;
}

export function exportDraft(d: ContourDraft): DraftExportFile {
  return { format: "vinetrack.contour_row_mapping_export", exportVersion: 1, exportedAt: new Date().toISOString(), draft: structuredClone(d) };
}

/** Regenerate every draft/group/mask/row/part id and clear canonical row links. */
export function regenerateIds(d: ContourDraft, vineyardId: string, paddockId: string): ContourDraft {
  return {
    ...structuredClone(d), draftId: generateUuid(), vineyardId, paddockId,
    groups: d.groups.map((g) => ({
      ...structuredClone(g), id: generateUuid(),
      exclusions: g.exclusions.map((m) => ({ id: generateUuid(), points: m.points.map((p) => ({ ...p })) })),
      rows: g.rows.map((r) => ({
        ...structuredClone(r), id: generateUuid(), canonicalRowId: null,
        parts: r.parts.map((p) => ({ id: generateUuid(), points: p.points.map((q) => ({ ...q })) })),
      })),
    })),
  };
}

export interface ImportedDraft { draft: ContourDraft; sameDraft: boolean }

/**
 * Parse an export file. Same draft id + block + vineyard → identities kept.
 * Anything else (import as new, other block/vineyard) → all ids regenerated.
 */
export function importDraftFile(text: string, vineyardId: string, paddockId: string, currentDraftId: string | null, asNew = false): ImportedDraft {
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (parsed?.format !== "vinetrack.contour_row_mapping_export" || parsed?.exportVersion !== 1 || !parsed?.draft)
    throw new Error("This is not a VineTrack contour row mapping backup.");
  const d = parsed.draft as ContourDraft;
  if (d.schema !== DRAFT_SCHEMA || d.version !== DRAFT_SCHEMA_VERSION || !Array.isArray(d.groups))
    throw new Error("This backup uses an unsupported draft version.");
  const errs = validateDraft(d);
  if (errs.length) throw new Error(`Backup is invalid: ${errs[0]}`);
  const sameDraft = !asNew && d.draftId === currentDraftId && d.paddockId === paddockId && d.vineyardId === vineyardId;
  return { draft: sameDraft ? structuredClone(d) : regenerateIds(d, vineyardId, paddockId), sameDraft };
}
