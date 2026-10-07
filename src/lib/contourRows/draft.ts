// Contour Row Mapping (Beta) — versioned draft model, generator,
// validation and identity rules. See docs/contour-row-mapping-contract.md.
//
// Drafts are review-only. Nothing here writes paddocks.rows or any other
// operational block input.

import { generateUuid, isUuid } from "@/lib/uuid";
import {
  type LatLng, type XY, type Projection,
  projectionForPolygon, isFiniteLL, chaikin, extendEnds, offsetPolylineChecked,
  clipPolyline, polylineSelfIntersects, polylinesCross,
  polylineLengthXY, dedupeXY, multipartLengthM, chordLengthM, maskProblem, minDistanceBetweenParts,
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
  maxMasksPerGroup: 50,
  maxMaskPoints: 500,
  maxPartsPerRow: 50,
  maxRowNumber: 100_000,
  maxNameLength: 120,
  /** Compact JSON byte limits (UTF-8). The SQL validator allows 1.5× for jsonb text spacing. */
  maxPayloadBytes: 4_000_000,
  maxRowBytes: 200_000,
  maxTraceBytes: 60_000,
  maxMaskBytes: 60_000,
  maxSourceBytes: 2_000,
  maxBackupFileBytes: 5_000_000,
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
  // Invalid masks are rejected, never silently ignored.
  if (g.workingArea) {
    const why = maskProblem(g.workingArea, proj);
    if (why) issues.push({ level: "error", message: `The working area ${why}. Fix or clear it before generating.` });
  }
  g.exclusions.forEach((m, i) => {
    const why = maskProblem(m.points, proj);
    if (why) issues.push({ level: "error", message: `Cut-out ${i + 1} ${why}. Fix or remove it before generating.` });
  });
  if (issues.some((i) => i.level === "error")) return { rows: [], issues };

  const region = {
    boundary: boundary.map(proj.toXY),
    workingArea: g.workingArea ? g.workingArea.map(proj.toXY) : null,
    exclusions: g.exclusions.map((e) => e.points.map(proj.toXY)),
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
    const { points: off, folded } = offsetPolylineChecked(base, -k * g.spacingM);
    const number = numberForOffset(g, k);
    if (off.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      issues.push({ level: "error", rowNumber: number, message: `Row ${number}: geometry could not be calculated. Adjust the trace.` });
      continue;
    }
    if (folded || polylineSelfIntersects(off)) {
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
    const crosses = a.parts.some((pa) => b.parts.some((pb) => polylinesCross(pa, pb)));
    if (crosses) issues.push({ level: "error", message: `Rows ${a.number} and ${b.number} cross. Use a smaller group or adjust the trace.` });
    else if (minDistanceBetweenParts(a.parts, b.parts) < g.spacingM * 0.5)
      issues.push({ level: "warning", message: `Rows ${a.number} and ${b.number} come closer than half the spacing. Check the trace around tight bends.` });
  }
  if (issues.some((i) => i.level === "error")) return { rows: [], issues };
  return { rows, issues };
}

export const hasManualEdits = (g: RowGroup) => g.rows.some((r) => r.provenance === "edited");

// -------------------------------------------------------------- validation
//
// Strict, null-safe structural validation shared by load, save and backup
// import. Mirrors vt_contour_validate_payload in the pending SQL.
//
// Explicit in-progress rule: an empty draft (no groups) and groups with no
// rows and a partial reference trace (0..maxTracePoints points) are valid,
// so work can be saved mid-trace. Working areas and cut-outs, if present,
// must be complete (>= 3 points); rows must have >= 1 part of >= 2 points.

export interface DraftScope { vineyardId: string; paddockId: string; canonicalRowIds?: ReadonlySet<string> | null }

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isPoint = (q: unknown) => isObj(q) && typeof q.lat === "number" && typeof q.lng === "number" && isFiniteLL(q as LatLng);
const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
export const jsonBytes = (v: unknown) => { const t = JSON.stringify(v) ?? ""; return enc ? enc.encode(t).length : t.length; };

const MODES = new Set(["straight", "contour", "imported"]);
const PROVENANCE = new Set(["generated", "edited", "imported"]);

/** Returns friendly error messages; empty array = structurally valid. Never throws. */
export function validateDraftShape(x: unknown, scope?: DraftScope | null): string[] {
  const errs: string[] = [];
  const add = (m: string) => { if (errs.length < 25 && !errs.includes(m)) errs.push(m); };
  try {
    if (!isObj(x)) return ["The draft is not a valid object."];
    if (x.schema !== DRAFT_SCHEMA || x.version !== DRAFT_SCHEMA_VERSION) add("Unsupported draft format or version.");
    if (!isUuid(x.draftId)) add("The draft has a missing or invalid identifier.");
    if (!isUuid(x.vineyardId) || !isUuid(x.paddockId)) add("The draft has a missing or invalid vineyard/block reference.");
    if (scope && (x.vineyardId !== scope.vineyardId || x.paddockId !== scope.paddockId)) add("This draft belongs to a different vineyard or block.");
    if (!Array.isArray(x.groups)) { add("The draft has no row group list."); return errs; }
    if (x.groups.length > LIMITS.maxGroups) add(`At most ${LIMITS.maxGroups} row groups.`);
    if (jsonBytes(x) > LIMITS.maxPayloadBytes) add("The draft is too large to save.");
    const ids = new Set<string>();
    const id = (v: unknown, what: string) => {
      if (!isUuid(v)) { add(`${what} has a missing or invalid identifier.`); return; }
      if (ids.has(v)) add(`Duplicate identifier ${v}.`); ids.add(v);
    };
    if (isUuid(x.draftId)) ids.add(x.draftId);
    const numbers = new Map<number, string>();
    let rows = 0, pts = 0;
    x.groups.forEach((g: unknown, gi: number) => {
      const gn = `Row group ${gi + 1}`;
      if (!isObj(g)) { add(`${gn} is malformed.`); return; }
      id(g.id, gn);
      if (typeof g.name !== "string" || g.name.length > LIMITS.maxNameLength) add(`${gn} needs a name of up to ${LIMITS.maxNameLength} characters.`);
      if (!MODES.has(g.mode)) add(`${gn} has an unsupported mode.`);
      if (!Array.isArray(g.referenceTrace) || g.referenceTrace.length > LIMITS.maxTracePoints || !g.referenceTrace.every(isPoint)) add(`${gn} has an invalid traced row.`);
      else if (jsonBytes(g.referenceTrace) > LIMITS.maxTraceBytes) add(`${gn}'s traced row is too large.`);
      if (!isInt(g.smoothing, 0, 2)) add(`${gn} smoothing must be 0, 1 or 2.`);
      if (!isNum(g.spacingM, LIMITS.minSpacingM, LIMITS.maxSpacingM)) add(`${gn} row spacing must be ${LIMITS.minSpacingM}–${LIMITS.maxSpacingM} m.`);
      if (!isInt(g.startNumber, 1, LIMITS.maxRowNumber)) add(`${gn} starting row number must be a whole number from 1 to ${LIMITS.maxRowNumber}.`);
      if (!isInt(g.leftCount, 0, LIMITS.maxSideCount) || !isInt(g.rightCount, 0, LIMITS.maxSideCount)) add(`${gn} left/right counts must be whole numbers from 0 to ${LIMITS.maxSideCount}.`);
      if (typeof g.ascending !== "boolean" || typeof g.extendToArea !== "boolean") add(`${gn} has invalid settings.`);
      if (g.workingArea !== null) {
        if (!Array.isArray(g.workingArea) || g.workingArea.length < 3 || g.workingArea.length > LIMITS.maxMaskPoints || !g.workingArea.every(isPoint)) add(`${gn}'s working area must be a finished outline of 3–${LIMITS.maxMaskPoints} valid points (or cleared).`);
        else if (jsonBytes(g.workingArea) > LIMITS.maxMaskBytes) add(`${gn}'s working area is too large.`);
      }
      if (!Array.isArray(g.exclusions) || g.exclusions.length > LIMITS.maxMasksPerGroup) add(`${gn} has an invalid cut-out list.`);
      else g.exclusions.forEach((m: unknown, mi: number) => {
        const mn = `${gn} cut-out ${mi + 1}`;
        if (!isObj(m)) { add(`${mn} is malformed.`); return; }
        id(m.id, mn);
        if (!Array.isArray(m.points) || m.points.length < 3 || m.points.length > LIMITS.maxMaskPoints || !m.points.every(isPoint)) add(`${mn} must be a finished outline of 3–${LIMITS.maxMaskPoints} valid points.`);
        else if (jsonBytes(m.points) > LIMITS.maxMaskBytes) add(`${mn} is too large.`);
      });
      if (!Array.isArray(g.rows)) { add(`${gn} has no row list.`); return; }
      g.rows.forEach((r: unknown) => {
        rows++;
        if (!isObj(r)) { add(`${gn} has a malformed row.`); return; }
        const rn = isInt(r.number, 1, LIMITS.maxRowNumber) ? `Row ${r.number}` : `A row in ${gn}`;
        id(r.id, rn);
        if (!isInt(r.number, 1, LIMITS.maxRowNumber)) add(`${rn} needs a whole row number from 1 to ${LIMITS.maxRowNumber}.`);
        else { const prev = numbers.get(r.number); if (prev) add(`Row number ${r.number} is used twice (${prev} and ${g.name}).`); numbers.set(r.number, String(g.name)); }
        if (!(r.offsetIndex === null || isInt(r.offsetIndex, -LIMITS.maxSideCount, LIMITS.maxSideCount))) add(`${rn} has an invalid offset.`);
        if (!PROVENANCE.has(r.provenance)) add(`${rn} has an unsupported origin.`);
        if (!(r.canonicalRowId === null || isUuid(r.canonicalRowId))) add(`${rn} has an invalid link to a block row.`);
        else if (r.canonicalRowId && scope?.canonicalRowIds && !scope.canonicalRowIds.has(r.canonicalRowId)) add(`${rn} links to a row that isn't in this block.`);
        if (!(r.source === undefined || r.source === null || (isObj(r.source) && jsonBytes(r.source) <= LIMITS.maxSourceBytes))) add(`${rn} has invalid source details.`);
        if (!Array.isArray(r.parts) || r.parts.length < 1 || r.parts.length > LIMITS.maxPartsPerRow) { add(`${rn} needs 1–${LIMITS.maxPartsPerRow} line parts.`); return; }
        if (jsonBytes(r) > LIMITS.maxRowBytes) add(`${rn} is too large.`);
        r.parts.forEach((p: unknown) => {
          if (!isObj(p)) { add(`${rn} has a malformed part.`); return; }
          id(p.id, `${rn} part`);
          if (!Array.isArray(p.points) || p.points.length < 2 || p.points.length > LIMITS.maxPointsPerRow) { add(`${rn} has a part with fewer than two points or too many points.`); return; }
          pts += p.points.length;
          if (!p.points.every(isPoint)) { add(`${rn} has invalid coordinates.`); return; }
          const first = p.points[0];
          if (p.points.every((q: LatLng) => q.lat === first.lat && q.lng === first.lng)) add(`${rn} has a part with zero length.`);
        });
      });
    });
    if (rows > LIMITS.maxRows) add(`At most ${LIMITS.maxRows} rows per draft.`);
    if (pts > LIMITS.maxTotalPoints) add(`Too many points (${pts}); the limit is ${LIMITS.maxTotalPoints}.`);
  } catch {
    add("The draft could not be read.");
  }
  return errs;
}

/** Back-compat alias: structural validation of a typed draft. */
export const validateDraft = (d: ContourDraft, scope?: DraftScope | null) => validateDraftShape(d, scope);

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

export const EXPORT_FORMAT = "vinetrack.contour_row_mapping_export";

export interface DraftExportFile {
  format: typeof EXPORT_FORMAT;
  exportVersion: 1;
  exportedAt: string;
  draft: ContourDraft;
}

export function exportDraft(d: ContourDraft): DraftExportFile {
  return { format: EXPORT_FORMAT, exportVersion: 1, exportedAt: new Date().toISOString(), draft: structuredClone(d) };
}

/**
 * Regenerate every group/mask/row/part id and clear canonical row links.
 * The draft container id is set to `draftId` (the block's current draft),
 * because one block holds one draft and saves must target it.
 */
export function regenerateIds(d: ContourDraft, vineyardId: string, paddockId: string, draftId: string): ContourDraft {
  return {
    ...structuredClone(d), draftId, vineyardId, paddockId,
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

export interface BackupInfo { draft: ContourDraft; canRestoreInPlace: boolean }

/** Parse and structurally validate a backup file. Never throws TypeErrors. */
export function readBackupFile(text: string, scope: DraftScope, currentDraftId: string): BackupInfo {
  if (typeof text !== "string" || text.length > LIMITS.maxBackupFileBytes) throw new Error("This backup is larger than 5 MB.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (!isObj(parsed) || parsed.format !== EXPORT_FORMAT || parsed.exportVersion !== 1 || !isObj(parsed.draft))
    throw new Error("This is not a VineTrack contour row mapping backup.");
  // Structural check without scope: backups from other blocks may be copied.
  const errs = validateDraftShape(parsed.draft, null);
  if (errs.length) throw new Error(`Backup is invalid: ${errs[0]}`);
  const d = parsed.draft as unknown as ContourDraft;
  return { draft: d, canRestoreInPlace: d.draftId === currentDraftId && d.vineyardId === scope.vineyardId && d.paddockId === scope.paddockId };
}

/**
 * "restore": same draft/block/vineyard only — every identity kept.
 * "copy": imported as a new copy into this block's draft — group, mask, row
 * and part ids regenerated, canonical links cleared, draftId = current.
 */
export function importDraftFile(text: string, scope: DraftScope, currentDraftId: string, mode: "restore" | "copy"): ContourDraft {
  const info = readBackupFile(text, scope, currentDraftId);
  let out: ContourDraft;
  if (mode === "restore") {
    if (!info.canRestoreInPlace) throw new Error("This backup is from a different draft or block. Import it as a copy instead.");
    out = structuredClone(info.draft);
  } else out = regenerateIds(info.draft, scope.vineyardId, scope.paddockId, currentDraftId);
  const errs = validateDraftShape(out, scope);
  if (errs.length) throw new Error(`Backup is invalid: ${errs[0]}`);
  return out;
}
