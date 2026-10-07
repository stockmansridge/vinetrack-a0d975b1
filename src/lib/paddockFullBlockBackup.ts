// Full Block JSON backup — export and import the complete stored setup for
// every paddock/block in a vineyard. Unlike the basic CSV export, this
// preserves structured JSONB fields (polygon_points, rows, row_length_overrides,
// variety_allocations) verbatim so a vineyard's block setup can be backed up
// and restored without loss.
//
// File format:
//   {
//     "format": "vinetrack.full-block-backup",
//     "version": 1,
//     "exported_at": "<ISO>",
//     "vineyard": { "id": "<uuid|null>", "name": "<string>" },
//     "blocks": [ <FullBlock>, ... ]
//   }
//
// Match strategy on import: case-insensitive block name within the target
// vineyard. Import is field-group selective: boundaries / rows / setup /
// varieties (or all). By default, non-empty existing fields are preserved;
// the user must explicitly opt into overwriting non-empty data per group.

import { findInvalidRowNumbers, InvalidPhysicalRowsError } from "@/lib/physicalRowNumbers";
import { supabase } from "@/integrations/ios-supabase/client";
import { generateUuid } from "@/lib/uuid";

// ---------- Identity safety ----------
//
// Full Block Backup copies SETUP, never identity. Every id in a backup file
// (vineyard.id, blocks[].id, blocks[].vineyard_id, rows[].id, rows[].startPoint.id,
// rows[].endPoint.id, polygon_points[].id) is informational only. At the
// destination write boundary:
//  - new blocks get fresh ids for every row, row endpoint and polygon point;
//  - matched existing blocks keep their own row ids (matched by physical row
//    number) and polygon point ids (matched by position); only unmatched
//    incoming rows/points get fresh ids.
// Operational data (valves, pruning, work tasks, trips, pins, sessions) is
// never part of the backup and is never written.

type Minimal = { from: (t: string) => any };

export const CROSS_VINEYARD_ROW_IDENTITY_MESSAGE =
  "This import contains internal row identities that already belong to another vineyard. VineTrack could not safely create the copy. Please try the import again or contact support.";

/** Map raw DB errors to user-safe text. Never bypasses the database guard. */
export function friendlyImportError(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("cross_vineyard_row_identity")) return CROSS_VINEYARD_ROW_IDENTITY_MESSAGE;
  return m || "Import failed";
}

function withPointId(p: any, id: string) {
  return p && typeof p === "object" ? { ...p, id } : p;
}

export interface IdentityStats {
  rowsCopied: number;
  rowIdsCreated: number;
  rowIdsPreserved: number;
}

/** Fresh ids for every row, endpoint and polygon point. Geometry/order kept. */
export function regenerateBlockIdentities(
  block: { rows?: any; polygon_points?: any },
): { rows?: any; polygon_points?: any; stats: IdentityStats } {
  const stats: IdentityStats = { rowsCopied: 0, rowIdsCreated: 0, rowIdsPreserved: 0 };
  const out: { rows?: any; polygon_points?: any; stats: IdentityStats } = { stats };
  if (Array.isArray(block.rows)) {
    out.rows = block.rows.map((r: any) => {
      if (!r || typeof r !== "object") return r;
      stats.rowsCopied++;
      stats.rowIdsCreated++;
      return {
        ...r,
        id: generateUuid(),
        startPoint: withPointId(r.startPoint, generateUuid()),
        endPoint: withPointId(r.endPoint, generateUuid()),
      };
    });
  } else if (block.rows !== undefined) out.rows = block.rows;
  if (Array.isArray(block.polygon_points)) {
    out.polygon_points = block.polygon_points.map((p: any) => withPointId(p, generateUuid()));
  } else if (block.polygon_points !== undefined) out.polygon_points = block.polygon_points;
  return out;
}

/**
 * Merge incoming rows into an existing block: rows matched by physical row
 * number keep the destination's row/endpoint ids; new rows get fresh ids.
 * Source ids are never written.
 */
export function mergeRowsPreservingIdentity(
  sourceRows: any[],
  targetRows: any,
): { rows: any[]; stats: IdentityStats } {
  const stats: IdentityStats = { rowsCopied: 0, rowIdsCreated: 0, rowIdsPreserved: 0 };
  const byNumber = new Map<number, any>();
  if (Array.isArray(targetRows)) {
    for (const t of targetRows) if (t && typeof t.number === "number") byNumber.set(t.number, t);
  }
  const rows = sourceRows.map((r: any) => {
    if (!r || typeof r !== "object") return r;
    stats.rowsCopied++;
    const t = typeof r.number === "number" ? byNumber.get(r.number) : undefined;
    if (t && typeof t.id === "string" && t.id) {
      stats.rowIdsPreserved++;
      return {
        ...r,
        id: t.id,
        startPoint: withPointId(r.startPoint, t.startPoint?.id || generateUuid()),
        endPoint: withPointId(r.endPoint, t.endPoint?.id || generateUuid()),
      };
    }
    stats.rowIdsCreated++;
    return {
      ...r,
      id: generateUuid(),
      startPoint: withPointId(r.startPoint, generateUuid()),
      endPoint: withPointId(r.endPoint, generateUuid()),
    };
  });
  return { rows, stats };
}

/** Polygon points for an existing block: reuse destination ids by position, else fresh. */
export function mergePolygonPreservingIdentity(sourcePts: any[], targetPts: any): any[] {
  const t = Array.isArray(targetPts) ? targetPts : [];
  return sourcePts.map((p: any, i: number) => withPointId(p, (t[i]?.id as string) || generateUuid()));
}

export const FULL_BLOCK_FORMAT = "vinetrack.full-block-backup";
export const FULL_BLOCK_VERSION = 1;

/** Every stored paddocks-table column we round-trip in the backup. */
export const FULL_BLOCK_FIELDS = [
  "id",
  "vineyard_id",
  "name",
  "polygon_points",
  "rows",
  "row_direction",
  "row_width",
  "row_offset",
  "vine_spacing",
  "intermediate_post_spacing",
  "flow_per_emitter",
  "emitter_spacing",
  "row_length_override",
  "row_length_overrides",
  "vine_count_override",
  "variety_allocations",
  "planting_year",
  "calculation_mode_override",
  "reset_mode_override",
  "budburst_date",
  "flowering_date",
  "veraison_date",
  "harvest_date",
  "created_at",
  "updated_at",
  "deleted_at",
] as const;

export type FullBlockField = (typeof FULL_BLOCK_FIELDS)[number];

export interface FullBlock {
  id?: string | null;
  vineyard_id?: string | null;
  name?: string | null;
  polygon_points?: any;
  rows?: any;
  row_direction?: number | null;
  row_width?: number | null;
  row_offset?: number | null;
  vine_spacing?: number | null;
  intermediate_post_spacing?: number | null;
  flow_per_emitter?: number | null;
  emitter_spacing?: number | null;
  row_length_override?: number | null;
  row_length_overrides?: Record<string, number> | null;
  vine_count_override?: number | null;
  variety_allocations?: any;
  planting_year?: number | null;
  calculation_mode_override?: string | null;
  reset_mode_override?: string | null;
  budburst_date?: string | null;
  flowering_date?: string | null;
  veraison_date?: string | null;
  harvest_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface FullBlockBackup {
  format: string;
  version: number;
  exported_at: string;
  vineyard: { id: string | null; name: string };
  blocks: FullBlock[];
}

// ---------- Build / parse ----------

export function buildFullBlockBackup(
  blocks: FullBlock[],
  vineyard: { id: string | null; name: string },
): string {
  const backup: FullBlockBackup = {
    format: FULL_BLOCK_FORMAT,
    version: FULL_BLOCK_VERSION,
    exported_at: new Date().toISOString(),
    vineyard,
    blocks: blocks.map((b) => {
      const out: Record<string, any> = {};
      for (const f of FULL_BLOCK_FIELDS) {
        if ((b as any)[f] !== undefined) out[f] = (b as any)[f];
      }
      return out as FullBlock;
    }),
  };
  return JSON.stringify(backup, null, 2);
}

export function parseFullBlockBackup(text: string): FullBlockBackup {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`Invalid JSON: ${e?.message ?? "parse failed"}`);
  }
  // Accept either our wrapper or a bare array of blocks.
  if (Array.isArray(json)) {
    return {
      format: FULL_BLOCK_FORMAT,
      version: FULL_BLOCK_VERSION,
      exported_at: "",
      vineyard: { id: null, name: "" },
      blocks: json as FullBlock[],
    };
  }
  if (!json || typeof json !== "object") {
    throw new Error("Backup file is not a JSON object");
  }
  if (json.format && json.format !== FULL_BLOCK_FORMAT) {
    throw new Error(`Unsupported backup format: ${json.format}`);
  }
  if (!Array.isArray(json.blocks)) {
    throw new Error("Backup is missing a 'blocks' array");
  }
  return {
    format: json.format ?? FULL_BLOCK_FORMAT,
    version: typeof json.version === "number" ? json.version : FULL_BLOCK_VERSION,
    exported_at: typeof json.exported_at === "string" ? json.exported_at : "",
    vineyard: {
      id: json.vineyard?.id ?? null,
      name: json.vineyard?.name ?? "",
    },
    blocks: json.blocks as FullBlock[],
  };
}

export function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Import planning ----------

/** Field groups the user can selectively import. */
export type FieldGroup = "boundary" | "rows" | "setup" | "varieties";

export const FIELD_GROUP_LABEL: Record<FieldGroup, string> = {
  boundary: "Boundaries (polygon)",
  rows: "Row geometry",
  setup: "Setup fields (spacing, direction, etc.)",
  varieties: "Variety allocations",
};

/** Which DB columns each group writes. */
export const FIELD_GROUP_COLUMNS: Record<FieldGroup, FullBlockField[]> = {
  boundary: ["polygon_points"],
  rows: ["rows"],
  setup: [
    "row_direction",
    "row_width",
    "row_offset",
    "vine_spacing",
    "intermediate_post_spacing",
    "flow_per_emitter",
    "emitter_spacing",
    "row_length_override",
    "row_length_overrides",
    "vine_count_override",
    "planting_year",
    "calculation_mode_override",
    "reset_mode_override",
  ],
  varieties: ["variety_allocations"],
};

export interface ImportOptions {
  groups: Record<FieldGroup, boolean>;
  /** Per-group: overwrite even when target already has a non-empty value. */
  overwrite: Record<FieldGroup, boolean>;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  groups: { boundary: true, rows: true, setup: true, varieties: true },
  overwrite: { boundary: false, rows: false, setup: false, varieties: false },
};

function isEmptyValue(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

export interface BlockMatch {
  source: FullBlock;
  targetId: string | null;
  targetName: string | null;
  /** Per-column action: write | skip-empty-source | skip-existing-nonempty */
  fieldActions: {
    column: FullBlockField;
    group: FieldGroup;
    action: "write" | "skip-empty-source" | "skip-existing-nonempty";
  }[];
  status: "match" | "no-match";
}

export interface ImportPlan {
  matches: BlockMatch[];
  unmatchedSource: FullBlock[];
  unmatchedTarget: { id: string; name: string }[];
}

export function buildImportPlan(
  source: FullBlock[],
  target: FullBlock[],
  opts: ImportOptions,
): ImportPlan {
  const byName = new Map<string, FullBlock>();
  for (const t of target) {
    if (t.name) byName.set(t.name.trim().toLowerCase(), t);
  }
  const matchedIds = new Set<string>();
  const matches: BlockMatch[] = [];
  const unmatchedSource: FullBlock[] = [];

  for (const s of source) {
    const key = (s.name ?? "").trim().toLowerCase();
    const t = key ? byName.get(key) : undefined;
    if (!t || !t.id) {
      unmatchedSource.push(s);
      matches.push({
        source: s,
        targetId: null,
        targetName: null,
        fieldActions: [],
        status: "no-match",
      });
      continue;
    }
    matchedIds.add(t.id);
    const actions: BlockMatch["fieldActions"] = [];
    (Object.keys(opts.groups) as FieldGroup[]).forEach((g) => {
      if (!opts.groups[g]) return;
      for (const col of FIELD_GROUP_COLUMNS[g]) {
        const srcVal = (s as any)[col];
        const tgtVal = (t as any)[col];
        if (isEmptyValue(srcVal)) {
          actions.push({ column: col, group: g, action: "skip-empty-source" });
          continue;
        }
        if (!isEmptyValue(tgtVal) && !opts.overwrite[g]) {
          actions.push({ column: col, group: g, action: "skip-existing-nonempty" });
          continue;
        }
        actions.push({ column: col, group: g, action: "write" });
      }
    });
    matches.push({
      source: s,
      targetId: t.id,
      targetName: t.name ?? null,
      fieldActions: actions,
      status: "match",
    });
  }

  const unmatchedTarget = target
    .filter((t) => t.id && !matchedIds.has(t.id) && t.name)
    .map((t) => ({ id: t.id!, name: t.name! }));

  return { matches, unmatchedSource, unmatchedTarget };
}

export interface ImportApplyResult {
  rowsCopied: number;
  rowIdsCreated: number;
  rowIdsPreserved: number;
  blocksUpdated: number;
  blocksUnchanged: number;
  fieldsWritten: number;
  errors: string[];
}

export async function applyImportPlan(
  plan: ImportPlan,
  targetVineyardId: string,
  target: FullBlock[] = [],
  client: Minimal = supabase,
): Promise<ImportApplyResult> {
  const targetById = new Map(target.filter((t) => t.id).map((t) => [t.id!, t]));
  const result: ImportApplyResult = {
    rowsCopied: 0,
    rowIdsCreated: 0,
    rowIdsPreserved: 0,
    blocksUpdated: 0,
    blocksUnchanged: 0,
    fieldsWritten: 0,
    errors: [],
  };
  for (const m of plan.matches) {
    if (m.status !== "match" || !m.targetId) continue;
    const writes = m.fieldActions.filter((a) => a.action === "write");
    if (writes.length === 0) {
      result.blocksUnchanged++;
      continue;
    }
    const patch: Record<string, any> = {};
    for (const w of writes) {
      patch[w.column] = (m.source as any)[w.column];
    }
    // Safety: never let imported id / vineyard_id leak in.
    delete patch.id;
    delete patch.vineyard_id;
    const tgt = targetById.get(m.targetId);
    let rowStats: IdentityStats | null = null;
    if (Array.isArray(patch.rows)) {
      const merged = mergeRowsPreservingIdentity(patch.rows, tgt?.rows);
      patch.rows = merged.rows;
      rowStats = merged.stats;
    }
    if (Array.isArray(patch.polygon_points)) {
      patch.polygon_points = mergePolygonPreservingIdentity(patch.polygon_points, tgt?.polygon_points);
    }
    const bad = findInvalidRowNumbers(patch.rows);
    if ("rows" in patch && bad.length) {
      result.errors.push(new InvalidPhysicalRowsError(bad, m.targetName ?? m.source.name ?? undefined).message);
      continue;
    }
    const { error } = await client
      .from("paddocks")
      .update(patch)
      .eq("id", m.targetId)
      .eq("vineyard_id", targetVineyardId);
    if (error) {
      result.errors.push(`${m.targetName ?? m.source.name}: ${friendlyImportError(error.message)}`);
      continue;
    }
    if (rowStats) {
      result.rowsCopied += rowStats.rowsCopied;
      result.rowIdsCreated += rowStats.rowIdsCreated;
      result.rowIdsPreserved += rowStats.rowIdsPreserved;
    }
    result.blocksUpdated++;
    result.fieldsWritten += writes.length;
  }
  return result;
}

export function summarizeBackup(blocks: FullBlock[]) {
  let withBoundary = 0;
  let withRows = 0;
  let withVarieties = 0;
  for (const b of blocks) {
    if (Array.isArray(b.polygon_points) && b.polygon_points.length >= 3) withBoundary++;
    if (Array.isArray(b.rows) && b.rows.length > 0) withRows++;
    if (Array.isArray(b.variety_allocations) && b.variety_allocations.length > 0)
      withVarieties++;
  }
  return { total: blocks.length, withBoundary, withRows, withVarieties };
}

// ---------- Import as new ----------

const NEW_BLOCK_COLUMNS: FullBlockField[] = Array.from(
  new Set((["boundary", "rows", "setup", "varieties"] as FieldGroup[]).flatMap((g) => FIELD_GROUP_COLUMNS[g])),
);

export interface CreateResult {
  blocksCreated: number;
  fieldsWritten: number;
  skippedFields: number;
  rowsCopied: number;
  rowIdsCreated: number;
  errors: string[];
}

/**
 * Create every backup block as a new block in the target vineyard. Only setup
 * columns are written; block id is assigned by the database; every row,
 * endpoint and polygon point id is freshly generated.
 */
export async function applyImportAsNew(
  source: FullBlock[],
  targetVineyardId: string,
  client: Minimal = supabase,
): Promise<CreateResult> {
  const result: CreateResult = {
    blocksCreated: 0, fieldsWritten: 0, skippedFields: 0, rowsCopied: 0, rowIdsCreated: 0, errors: [],
  };
  for (const s of source) {
    const row: Record<string, any> = {
      vineyard_id: targetVineyardId,
      name: (s.name ?? "").trim() || "Imported block",
    };
    let written = 0;
    for (const col of NEW_BLOCK_COLUMNS) {
      const v = (s as any)[col];
      if (isEmptyValue(v)) { result.skippedFields++; continue; }
      row[col] = v;
      written++;
    }
    const fresh = regenerateBlockIdentities(row);
    if ("rows" in row) row.rows = fresh.rows;
    if ("polygon_points" in row) row.polygon_points = fresh.polygon_points;
    const badRows = findInvalidRowNumbers(row.rows);
    if ("rows" in row && badRows.length) {
      result.errors.push(new InvalidPhysicalRowsError(badRows, row.name).message);
      continue;
    }
    const { error } = await client.from("paddocks").insert(row);
    if (error) {
      result.errors.push(`${row.name}: ${friendlyImportError(error.message)}`);
      continue;
    }
    result.blocksCreated++;
    result.fieldsWritten += written;
    result.rowsCopied += fresh.stats.rowsCopied;
    result.rowIdsCreated += fresh.stats.rowIdsCreated;
  }
  return result;
}
