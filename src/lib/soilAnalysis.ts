// Soil Analysis — released customer feature (Portal).
//
// Data authority is the shared VineTrack backend. The live tables are
// vineyard-scoped under RLS (members read; owner/manager/supervisor/operator
// and System Admin support write); this module is the single place that names
// their columns so any schema adjustment by the database owner lands in
// one file.
//
// Safety rules enforced here:
// - source_value_numeric / source_value_text and the document raw_extraction
//   are immutable extraction provenance; user corrections only ever write
//   value_numeric / value_text / analyte_key and set is_user_corrected.
// - method / unit / lab range / lab status have no duplicate source copies
//   in the schema, so the Portal treats them as read-only.
// - The uploaded document is evidence and is never replaced or deleted.
// - No agronomic recommendations: status language comes only from the
//   laboratory's own range/status fields and catalogue desired_direction.

import { supabase } from "@/integrations/ios-supabase/client";

const db = supabase as any;

export const SOIL_DOCUMENT_BUCKET = "soil-analysis-documents";
export const SOIL_EXTRACT_FUNCTION = "soil-analysis-extract";

// ---------------------------------------------------------------------------
// Types (live table contract)
// ---------------------------------------------------------------------------

/** Sample lifecycle — there is no separate status column. */
export type SoilSampleStatus =
  | "pending"
  | "processing"
  | "review_required"
  | "confirmed"
  | "failed";

export type SoilDocumentExtractionStatus =
  | "pending"
  | "processing"
  | "parsed"
  | "review_required"
  | "failed";

export type SoilSampleScope =
  | "unmapped"
  | "whole_block"
  | "row_range"
  | "row_selection"
  | "point"
  | "multi_block";

export type SoilDesiredDirection = "range" | "higher" | "lower" | "context_only";

export interface SoilSample {
  id: string;
  vineyard_id: string;
  paddock_id: string | null;
  lab_paddock_name: string | null;
  sample_scope: SoilSampleScope;
  row_start: number | null;
  row_end: number | null;
  latitude: number | null;
  longitude: number | null;
  sampled_at: string | null;
  received_at: string | null;
  reported_at: string | null;
  sample_depth_from_cm: number | null;
  sample_depth_to_cm: number | null;
  laboratory: string | null;
  lab_code: string | null;
  order_number: string | null;
  lab_sample_id: string | null;
  client_agronomist: string | null;
  crop: string | null;
  soil_type: string | null;
  notes: string | null;
  extraction_status: SoilSampleStatus;
  extraction_confidence: number | null;
  mapping_confidence: number | null;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // joined display fields
  block_name?: string | null;
  vineyard_name?: string | null;
}

export interface SoilSampleDocument {
  id: string;
  sample_id: string;
  vineyard_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  is_primary: boolean;
  source_page_count: number | null;
  extraction_status: SoilDocumentExtractionStatus;
  extraction_model: string | null;
  parser_version: string | null;
  raw_extraction: unknown | null;
  extraction_error: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SoilSampleResult {
  id: string;
  sample_id: string;
  analyte_key: string | null;
  original_analyte_name: string;
  display_name: string;
  method: string | null;
  unit: string | null;
  // Immutable extraction provenance — never written by the Portal.
  source_value_numeric: number | null;
  source_value_text: string | null;
  // Current (possibly corrected) values.
  value_numeric: number | null;
  value_text: string | null;
  lab_range_min: number | null;
  lab_range_max: number | null;
  lab_range_text: string | null;
  lab_status: string | null;
  desired_value_numeric: number | null;
  source_page: number | null;
  source_section: string | null;
  extraction_confidence: number | null;
  is_user_verified: boolean;
  is_user_corrected: boolean;
  notes: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

export interface SoilAnalyte {
  key: string;
  display_name: string;
  category: string | null;
  canonical_unit: string | null;
  desired_direction: SoilDesiredDirection;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SoilBlockAlias {
  id: string;
  vineyard_id: string;
  alias: string;
  normalized_alias: string;
  paddock_id: string | null;
  row_start: number | null;
  row_end: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Block mappings — one laboratory sample can cover MULTIPLE VineTrack blocks.
// public.soil_sample_block_mappings is the authority. The legacy
// soil_samples.sample_scope / paddock_id / row_start / row_end columns are
// synchronised by the soil_analysis_set_block_mappings RPC (0 mappings =>
// unmapped, 1 => legacy fields set, >1 => multi_block) and are only ever a
// display fallback for rows that predate the backfill. The Portal NEVER
// forces a multi-block sample into one paddock_id.
// ---------------------------------------------------------------------------

export type SoilMappingScope = "whole_block" | "row_range" | "selected_rows";

export interface SoilBlockMapping {
  id: string;
  sample_id: string;
  vineyard_id: string;
  paddock_id: string;
  mapping_scope: SoilMappingScope;
  row_start: number | null;
  row_end: number | null;
  /** Exact canonical row numbers (selected_rows; backfilled for row_range). */
  row_numbers: number[] | null;
  row_ids: string[] | null;
  mapping_confidence: number | null;
  notes: string | null;
  sort_order: number;
  // joined display field
  block_name?: string | null;
}

/**
 * Editable mapping (review UI). Identity is always the paddock_id; the user
 * ticks real rows from paddocks.rows — no typed row ranges.
 */
export interface SoilBlockMappingInput {
  paddock_id: string;
  /** Ticked canonical row numbers. */
  selected: number[];
}

export async function listSampleBlockMappings(sampleId: string): Promise<SoilBlockMapping[]> {
  const { data, error } = await db
    .from("soil_sample_block_mappings")
    .select("*, paddocks(name)")
    .eq("sample_id", sampleId)
    .order("sort_order")
    .order("id");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    block_name: row.paddocks?.name ?? null,
    paddocks: undefined,
  })) as SoilBlockMapping[];
}

/** Mappings for many samples at once, keyed by sample_id (list/overview). */
export async function listBlockMappingsForSamples(
  sampleIds: string[],
): Promise<Map<string, SoilBlockMapping[]>> {
  const map = new Map<string, SoilBlockMapping[]>();
  if (sampleIds.length === 0) return map;
  const { data, error } = await db
    .from("soil_sample_block_mappings")
    .select("*, paddocks(name)")
    .in("sample_id", sampleIds)
    .order("sort_order")
    .order("id");
  if (error) throw error;
  for (const row of data ?? []) {
    const mapping = {
      ...row,
      block_name: (row as any).paddocks?.name ?? null,
      paddocks: undefined,
    } as SoilBlockMapping;
    map.set(mapping.sample_id, [...(map.get(mapping.sample_id) ?? []), mapping]);
  }
  return map;
}

/** Known row numbers for a block from the live paddocks.rows array, ascending. */
export function blockRowNumbers(rows: unknown): number[] {
  if (!Array.isArray(rows)) return [];
  const nums = rows
    .map((r: any) => Number(r?.number))
    .filter((n) => Number.isInteger(n));
  return [...new Set(nums)].sort((x, y) => x - y);
}

/** Compact a row list without ever filling gaps: [31,32,33,35,37] => "31–33, 35, 37". */
export function compactRowList(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

export function rowSelectionSummary(nums: number[]): string {
  const n = new Set(nums).size;
  if (n === 0) return "No rows selected";
  return `${n === 1 ? "Row" : "Rows"} ${compactRowList(nums)}`;
}

/** Initial ticks for an existing mapping against the block's current rows. */
export function initialSelection(
  m: Pick<SoilBlockMapping, "mapping_scope" | "row_numbers" | "row_start" | "row_end">,
  known: number[],
): number[] {
  if (m.mapping_scope === "whole_block") return [...known];
  if (Array.isArray(m.row_numbers) && m.row_numbers.length > 0) {
    return [...new Set(m.row_numbers.map(Number))].sort((a, b) => a - b);
  }
  if (m.mapping_scope === "row_range" && m.row_start != null && m.row_end != null) {
    return known.filter((n) => n >= m.row_start! && n <= m.row_end!);
  }
  return [];
}

export const MAPPING_BLOCK_REQUIRED_MESSAGE = "Choose a block for each block-coverage row.";
export const MAPPING_ROWS_REQUIRED_MESSAGE =
  "Select at least one row for each selected block, or choose All rows.";
export const MAPPING_NO_CONFIGURED_ROWS_MESSAGE =
  "No configured VineTrack rows for this block. Update Block & Row setup first.";
export const MAPPING_DUPLICATE_BLOCK_MESSAGE =
  "Each block can only be added once. Remove the duplicate block.";
export const MAPPING_UNKNOWN_ROW_MESSAGE =
  "A selected row is not present in the block's current VineTrack row configuration.";
export const MAPPING_EMPTY_MESSAGE =
  "Add at least one block-coverage row, or choose Not mapped.";

/** Validates before any write; knownRows maps paddock_id => known row numbers. */
export function validateBlockMappings(
  rows: SoilBlockMappingInput[],
  knownRows: Map<string, number[]>,
): string | null {
  if (rows.length === 0) return MAPPING_EMPTY_MESSAGE;
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.paddock_id) return MAPPING_BLOCK_REQUIRED_MESSAGE;
    if (seen.has(row.paddock_id)) return MAPPING_DUPLICATE_BLOCK_MESSAGE;
    seen.add(row.paddock_id);
    const known = knownRows.get(row.paddock_id) ?? [];
    if (known.length === 0) return MAPPING_NO_CONFIGURED_ROWS_MESSAGE;
    if (row.selected.length === 0) return MAPPING_ROWS_REQUIRED_MESSAGE;
    const knownSet = new Set(known);
    if (row.selected.some((n) => !knownSet.has(n))) return MAPPING_UNKNOWN_ROW_MESSAGE;
  }
  return null;
}

/**
 * RPC payload. All known rows ticked => whole_block (no row_numbers); a
 * subset => selected_rows with exact sorted unique row_numbers. The UI never
 * generates row_range.
 */
export function buildMappingPayload(
  rows: SoilBlockMappingInput[],
  knownRows: Map<string, number[]>,
): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const known = knownRows.get(r.paddock_id) ?? [];
    const selected = [...new Set(r.selected)].sort((a, b) => a - b);
    const all = known.length > 0 && known.every((n) => selected.includes(n));
    return all
      ? { paddock_id: r.paddock_id, mapping_scope: "whole_block", mapping_confidence: null, notes: null }
      : {
          paddock_id: r.paddock_id,
          mapping_scope: "selected_rows",
          row_numbers: selected,
          mapping_confidence: null,
          notes: null,
        };
  });
}

/**
 * Atomically REPLACES the sample's block mappings in ONE call. The RPC also
 * synchronises the legacy soil_samples fields (row_selection / multi_block),
 * so the Portal never writes sample_scope/paddock_id directly for block
 * coverage.
 */
export async function setSoilSampleBlockMappings(
  sampleId: string,
  rows: SoilBlockMappingInput[],
  knownRows: Map<string, number[]> = new Map(),
): Promise<void> {
  const { error } = await db.rpc("soil_analysis_set_block_mappings", {
    p_sample_id: sampleId,
    p_mappings: buildMappingPayload(rows, knownRows),
  });
  if (error) throw error;
}

/** "Primitivo · All rows" / "Primitivo · Rows 31–33, 35, 37". */
export function mappingLine(m: SoilBlockMapping): string {
  const name = m.block_name ?? "Block";
  if (m.mapping_scope === "whole_block") return `${name} · All rows`;
  if (Array.isArray(m.row_numbers) && m.row_numbers.length > 0) {
    return `${name} · ${rowSelectionSummary(m.row_numbers)}`;
  }
  if (m.mapping_scope === "row_range") {
    return `${name} · Rows ${m.row_start ?? "?"}–${m.row_end ?? "?"}`;
  }
  return `${name} · Selected rows`;
}

/** One line per mapping, for tooltips/popovers on multi-block samples. */
export function mappingSummaryLines(mappings: SoilBlockMapping[]): string[] {
  return mappings.map(mappingLine);
}

/**
 * Display label for the VineTrack mapping column. Mapping rows are the
 * authority; the legacy sample fields are only used when no mapping rows
 * exist. A multi-block sample is never collapsed to one arbitrary block.
 */
export function mappingSummaryLabel(
  sample: Pick<SoilSample, "sample_scope" | "paddock_id" | "row_start" | "row_end" | "block_name">,
  mappings: SoilBlockMapping[] | undefined,
): string {
  const rows = mappings ?? [];
  if (rows.length === 1) return mappingLine(rows[0]);
  if (rows.length > 1) return `${rows.length} blocks`;
  // Legacy fallback only — no mapping rows exist for this sample.
  if (sample.sample_scope === "row_range" && sample.paddock_id) {
    return `${sample.block_name ?? "Block"} · Rows ${sample.row_start ?? "?"}–${sample.row_end ?? "?"}`;
  }
  if (sample.sample_scope === "whole_block" && sample.paddock_id) {
    return `${sample.block_name ?? "Block"} · All rows`;
  }
  if (sample.sample_scope === "row_selection") return `${sample.block_name ?? "Block"} · Selected rows`;
  if (sample.sample_scope === "point") return `${sample.block_name ?? "Block"} (point)`;
  if (sample.sample_scope === "multi_block") return "Multiple blocks";
  return SAMPLE_SCOPE_LABEL.unmapped;
}

// ---------------------------------------------------------------------------
// "Use rows from report" — review suggestion only, never auto-saved.
// ---------------------------------------------------------------------------

/**
 * Parses an unambiguous vineyard-global row range from the preserved lab
 * paddock text, e.g. "ROWS 30-69 EAST BOT" or "ROW 70-109 WEST PINOT".
 * Returns null when there is no range, more than one, or it is inverted.
 */
export function parseReportRowRange(text: string | null | undefined): { from: number; to: number } | null {
  if (!text) return null;
  const re = /\brows?\s*(\d{1,4})\s*(?:-|–|—|to)\s*(\d{1,4})\b/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) return null;
  // Any other numeric range in the text makes it ambiguous.
  const anyRanges = text.match(/\d+\s*(?:-|–|—)\s*\d+/g) ?? [];
  if (anyRanges.length > 1) return null;
  const from = Number(matches[0][1]);
  const to = Number(matches[0][2]);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return null;
  return { from, to };
}

export interface RowSuggestion {
  mappings: SoilBlockMappingInput[];
  missing: number[];
}

/** One mapping per block whose known rows intersect the range; missing rows are reported, never invented. */
export function suggestMappingsFromRange(
  range: { from: number; to: number },
  blocks: Array<{ id: string; rows: unknown }>,
): RowSuggestion {
  const covered = new Set<number>();
  const mappings: SoilBlockMappingInput[] = [];
  for (const b of blocks) {
    const hit = blockRowNumbers(b.rows).filter((n) => n >= range.from && n <= range.to);
    if (hit.length === 0) continue;
    hit.forEach((n) => covered.add(n));
    mappings.push({ paddock_id: b.id, selected: hit });
  }
  mappings.sort((a, b) => a.selected[0] - b.selected[0]);
  const missing: number[] = [];
  for (let n = range.from; n <= range.to; n++) if (!covered.has(n)) missing.push(n);
  return { mappings, missing };
}

// ---------------------------------------------------------------------------
// Labels — restrained, lab-status-only language
// ---------------------------------------------------------------------------

export const SAMPLE_STATUS_LABEL: Record<SoilSampleStatus, string> = {
  pending: "Awaiting extraction",
  processing: "Extracting",
  review_required: "Review required",
  confirmed: "Confirmed",
  failed: "Extraction failed",
};

export const DOCUMENT_EXTRACTION_LABEL: Record<SoilDocumentExtractionStatus, string> = {
  pending: "Awaiting extraction",
  processing: "Extracting",
  parsed: "Parsed",
  review_required: "Review required",
  failed: "Extraction failed",
};

export const SAMPLE_SCOPE_LABEL: Record<SoilSampleScope, string> = {
  unmapped: "Unmapped",
  whole_block: "Whole block",
  row_range: "Row range",
  row_selection: "Selected rows",
  point: "Point",
  multi_block: "Multiple blocks",
};

/** Lab-status display. Green is never labelled as an agronomic guarantee. */
export const LAB_STATUS_LABEL: Record<string, string> = {
  low: "Below lab range",
  within_range: "Within lab range",
  high: "Above lab range",
  no_range: "No lab range",
  unknown: "Not stated",
};

export function labStatusLabel(status: string | null | undefined): string {
  if (!status) return LAB_STATUS_LABEL.unknown;
  return LAB_STATUS_LABEL[status] ?? status;
}

/** True when the laboratory flagged the result outside its own range. */
export function isOutsideLabRange(status: string | null | undefined): boolean {
  return status === "low" || status === "high";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface SoilSampleFilters {
  vineyardId?: string | null;
  paddockId?: string | null;
  laboratory?: string | null;
  status?: SoilSampleStatus | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function listSoilSamples(filters: SoilSampleFilters = {}): Promise<SoilSample[]> {
  let q = db
    .from("soil_samples")
    .select("*, paddocks(name), vineyards(name)")
    .is("deleted_at", null)
    .order("sampled_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (filters.vineyardId) q = q.eq("vineyard_id", filters.vineyardId);
  if (filters.paddockId) q = q.eq("paddock_id", filters.paddockId);
  if (filters.laboratory) q = q.eq("laboratory", filters.laboratory);
  if (filters.status) q = q.eq("extraction_status", filters.status);
  if (filters.dateFrom) q = q.gte("sampled_at", filters.dateFrom);
  if (filters.dateTo) q = q.lte("sampled_at", filters.dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    block_name: row.paddocks?.name ?? null,
    vineyard_name: row.vineyards?.name ?? null,
    paddocks: undefined,
    vineyards: undefined,
  })) as SoilSample[];
}

export async function getSoilSampleDetail(id: string): Promise<{
  sample: SoilSample;
  documents: SoilSampleDocument[];
  results: SoilSampleResult[];
  mappings: SoilBlockMapping[];
}> {
  const { data: sample, error } = await db
    .from("soil_samples")
    .select("*, paddocks(name), vineyards(name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!sample) throw new Error("Soil sample not found.");
  const [{ data: docs, error: docErr }, { data: results, error: resErr }, mappings] =
    await Promise.all([
      db.from("soil_sample_documents").select("*").eq("sample_id", id).order("created_at"),
      db
        .from("soil_sample_results")
        .select("*")
        .eq("sample_id", id)
        .order("sort_order", { nullsFirst: false })
        .order("created_at"),
      listSampleBlockMappings(id),
    ]);
  if (docErr) throw docErr;
  if (resErr) throw resErr;
  return {
    sample: {
      ...sample,
      block_name: sample.paddocks?.name ?? null,
      vineyard_name: sample.vineyards?.name ?? null,
      paddocks: undefined,
      vineyards: undefined,
    } as SoilSample,
    documents: (docs ?? []) as SoilSampleDocument[],
    results: (results ?? []) as SoilSampleResult[],
    mappings,
  };
}

export async function listAnalyteCatalogue(): Promise<SoilAnalyte[]> {
  const { data, error } = await db
    .from("soil_analyte_catalogue")
    .select("*")
    .eq("is_active", true)
    .order("category", { nullsFirst: false })
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as SoilAnalyte[];
}

export async function listBlockAliases(vineyardId: string): Promise<SoilBlockAlias[]> {
  const { data, error } = await db
    .from("soil_block_aliases")
    .select("*")
    .eq("vineyard_id", vineyardId)
    .order("alias");
  if (error) throw error;
  return (data ?? []) as SoilBlockAlias[];
}

/**
 * Sample ids linked to each requested block. soil_sample_block_mappings is
 * the authority; the legacy soil_samples.paddock_id link is unioned in as a
 * fallback for rows that predate the backfill. A sample mapped to several
 * blocks therefore appears in EACH block's history, and the same sample can
 * never be listed twice within the SAME block.
 */
async function sampleIdsForBlocks(paddockIds: string[]): Promise<Map<string, string[]>> {
  const byBlock = new Map<string, Set<string>>();
  const add = (blockId: string, sampleId: string) => {
    if (!byBlock.has(blockId)) byBlock.set(blockId, new Set());
    byBlock.get(blockId)!.add(sampleId);
  };
  const [{ data: maps, error: mapErr }, { data: legacy, error: legErr }] = await Promise.all([
    db.from("soil_sample_block_mappings").select("sample_id, paddock_id").in("paddock_id", paddockIds),
    db
      .from("soil_samples")
      .select("id, paddock_id")
      .in("paddock_id", paddockIds)
      .is("deleted_at", null),
  ]);
  if (mapErr) throw mapErr;
  if (legErr) throw legErr;
  for (const m of maps ?? []) add(m.paddock_id, m.sample_id);
  for (const s of legacy ?? []) add(s.paddock_id, s.id);
  return new Map([...byBlock].map(([k, v]) => [k, [...v]]));
}

/** Results for one block + analyte across time, oldest first, with sample context. */
export async function listBlockAnalyteResults(
  paddockId: string,
  analyteKey: string,
): Promise<Array<SoilSampleResult & { sample: SoilSample }>> {
  const byBlock = await sampleIdsForBlocks([paddockId]);
  const sampleIds = byBlock.get(paddockId) ?? [];
  if (sampleIds.length === 0) return [];
  const { data, error } = await db
    .from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .eq("analyte_key", analyteKey)
    .in("sample_id", sampleIds)
    .is("soil_samples.deleted_at", null);
  if (error) throw error;
  const rows = (data ?? []).map((row: any) => {
    const { soil_samples: s, ...result } = row;
    return {
      ...result,
      sample: { ...s, block_name: s?.paddocks?.name ?? null, paddocks: undefined } as SoilSample,
    };
  });
  rows.sort((a: any, b: any) =>
    String(a.sample.sampled_at ?? a.sample.created_at).localeCompare(
      String(b.sample.sampled_at ?? b.sample.created_at),
    ),
  );
  return rows;
}

export type BlockAnalyteResult = SoilSampleResult & { sample: SoilSample; matched_paddock_id: string };

export type SoilTrafficBucket = "low" | "satisfactory" | "high" | "other";

/** Source laboratory wording only; numeric values and desired direction are irrelevant. */
export function soilTrafficBucket(labStatus: string | null | undefined): SoilTrafficBucket {
  const status = (labStatus ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (status === "low" || status === "very low") return "low";
  if (status === "high" || status === "very high") return "high";
  if (["satisfactory", "within range", "within lab range", "within laboratory range"].includes(status)) return "satisfactory";
  return "other";
}

/** All analytes, confirmed evidence only; mapped measurements remain once per matched block. */
export async function listSoilTrafficResults(paddockIds: string[], asOf: string | null = null): Promise<BlockAnalyteResult[]> {
  const ids = [...new Set(paddockIds)];
  if (!ids.length) return [];
  const byBlock = await sampleIdsForBlocks(ids);
  const sampleIds = [...new Set([...byBlock.values()].flat())];
  if (!sampleIds.length) return [];
  let query = db.from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .in("sample_id", sampleIds)
    .eq("soil_samples.extraction_status", "confirmed")
    .is("soil_samples.deleted_at", null);
  if (asOf) query = query.lte("soil_samples.sampled_at", asOf);
  const { data, error } = await query;
  if (error) throw error;
  const out: BlockAnalyteResult[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const { soil_samples: s, ...result } = row;
    // Fail closed on malformed/unconfirmed/undated evidence as well as filtering on the server.
    if (!s || s.extraction_status !== "confirmed" || s.deleted_at || !s.sampled_at || (asOf && s.sampled_at.slice(0, 10) > asOf)) continue;
    const sample = { ...s, block_name: s.paddocks?.name ?? null, paddocks: undefined } as SoilSample;
    for (const id of ids) {
      const key = `${id}:${result.id}`;
      if (!(byBlock.get(id) ?? []).includes(sample.id) || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...result, sample, matched_paddock_id: id });
    }
  }
  return out;
}

export interface SoilTrafficSnapshot {
  paddockId: string;
  analyteKey: string;
  date: string;
  bucket: SoilTrafficBucket;
  statusLabel: string;
  entries: BlockAnalyteResult[];
}

/** Latest date per block/analyte, never an average or a method/unit merge. */
export function buildSoilTrafficSnapshots(rows: BlockAnalyteResult[]): SoilTrafficSnapshot[] {
  const groups = new Map<string, BlockAnalyteResult[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.analyte_key || !r.sample.sampled_at || r.sample.extraction_status !== "confirmed" || r.sample.deleted_at) continue;
    const identity = `${r.matched_paddock_id}:${r.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const key = JSON.stringify([r.matched_paddock_id, r.analyte_key]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((group) => {
    const date = group.map((r) => r.sample.sampled_at?.slice(0, 10) ?? "").sort().at(-1) ?? "";
    const entries = group.filter((r) => r.sample.sampled_at?.slice(0, 10) === date)
      .sort((a, b) => a.sample.id.localeCompare(b.sample.id) || a.id.localeCompare(b.id));
    const buckets = new Set(entries.map((r) => soilTrafficBucket(r.lab_status)));
    const mixed = buckets.size > 1;
    return {
      paddockId: group[0].matched_paddock_id, analyteKey: group[0].analyte_key ?? "", date,
      bucket: mixed ? "other" as const : soilTrafficBucket(entries[0]?.lab_status),
      statusLabel: mixed ? "Mixed latest statuses" : [...new Set(entries.map((r) => r.lab_status?.trim() || "Not stated"))].join(" / "),
      entries,
    };
  }).sort((a, b) => a.analyteKey.localeCompare(b.analyteKey) || a.paddockId.localeCompare(b.paddockId));
}

export function soilTrafficCounts(snapshots: SoilTrafficSnapshot[]): Record<SoilTrafficBucket, number> {
  const counts = { low: 0, satisfactory: 0, high: 0, other: 0 };
  for (const s of snapshots) counts[s.bucket]++;
  return counts;
}

/** Mapping-aware Trends read; filter the analyte on the server, not after a broad read.
 * Preserve the single-block read's sample visibility / deletion semantics.
 */
export async function listBlocksAnalyteResults(paddockIds: string[], analyteKey: string): Promise<BlockAnalyteResult[]> {
  return listBlocksResults(paddockIds, analyteKey);
}

/**
 * Mapping-aware multi-analyte Trends read: ONE query for every analyte across
 * the selected blocks, so ticking analytes never causes N+1 refetches. Same
 * sample visibility / deletion semantics as the single-analyte read.
 */
export async function listBlocksTrendResults(paddockIds: string[]): Promise<BlockAnalyteResult[]> {
  return listBlocksResults(paddockIds);
}

async function listBlocksResults(paddockIds: string[], analyteKey?: string): Promise<BlockAnalyteResult[]> {
  if (paddockIds.length === 0) return [];
  const ids = [...new Set(paddockIds)];
  const byBlock = await sampleIdsForBlocks(ids);
  const sampleIds = [...new Set([...byBlock.values()].flat())];
  if (!sampleIds.length) return [];
  let query = db.from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .in("sample_id", sampleIds)
    .is("soil_samples.deleted_at", null);
  if (analyteKey) query = query.eq("analyte_key", analyteKey);
  const { data, error } = await query;
  if (error) throw error;
  const out: BlockAnalyteResult[] = [];
  const seen = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const { soil_samples: s, ...result } = row;
    const sample = { ...s, block_name: s?.paddocks?.name ?? null, paddocks: undefined } as SoilSample;
    for (const id of ids) {
      if (!(byBlock.get(id) ?? []).includes(sample.id)) continue;
      const blockSeen = seen.get(id) ?? new Set<string>();
      if (blockSeen.has(result.id)) continue;
      blockSeen.add(result.id);
      seen.set(id, blockSeen);
      out.push({ ...result, sample, matched_paddock_id: id });
    }
  }
  return out.sort((a, b) => String(a.sample.sampled_at ?? a.sample.created_at).localeCompare(String(b.sample.sampled_at ?? b.sample.created_at))
    || a.matched_paddock_id.localeCompare(b.matched_paddock_id) || a.id.localeCompare(b.id));
}

/**
 * Results for a set of blocks within a sampled-at period (Compare tab).
 * Each row carries matched_paddock_id — the block THIS row belongs to — so
 * a multi-block sample appears once per relevant block without ever
 * duplicating the measurement within the same block.
 */
export async function listBlockPeriodResults(
  paddockIds: string[],
  dateFrom: string | null,
  dateTo: string | null,
): Promise<Array<SoilSampleResult & { sample: SoilSample; matched_paddock_id: string }>> {
  if (paddockIds.length === 0) return [];
  const byBlock = await sampleIdsForBlocks(paddockIds);
  const allSampleIds = [...new Set([...byBlock.values()].flat())];
  if (allSampleIds.length === 0) return [];
  let q = db
    .from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .in("sample_id", allSampleIds)
    .is("soil_samples.deleted_at", null);
  if (dateFrom) q = q.gte("soil_samples.sampled_at", dateFrom);
  if (dateTo) q = q.lte("soil_samples.sampled_at", dateTo);
  const { data, error } = await q;
  if (error) throw error;
  const out: Array<SoilSampleResult & { sample: SoilSample; matched_paddock_id: string }> = [];
  for (const row of data ?? []) {
    const { soil_samples: s, ...result } = row as any;
    const sample = {
      ...s,
      block_name: s?.paddocks?.name ?? null,
      paddocks: undefined,
    } as SoilSample;
    for (const pid of paddockIds) {
      if ((byBlock.get(pid) ?? []).includes(s.id)) {
        out.push({ ...(result as SoilSampleResult), sample, matched_paddock_id: pid });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Upload — creates pending records, then invokes the live parser function
// ---------------------------------------------------------------------------

export const SOIL_UPLOAD_ACCEPT = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
export const SOIL_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

const ACCEPTED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function validateSoilUpload(file: { name: string; type: string; size: number }): string | null {
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!SOIL_UPLOAD_ACCEPT.includes(ext) || (file.type && !ACCEPTED_MIME.has(file.type))) {
    return "Choose a PDF, JPG, PNG or WebP laboratory report.";
  }
  if (file.size > SOIL_UPLOAD_MAX_BYTES) return "Files must be 15 MB or smaller.";
  return null;
}

function safeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "document";
}

export interface UploadSoilSampleInput {
  file: File;
  vineyardId: string;
  uploadedBy: string | null;
}

/**
 * Extracts a safe, human-readable detail from a Functions invocation error.
 * FunctionsHttpError carries the response as `context`; when the function
 * returned a JSON body with detail/error/message we surface that. Auth
 * headers and tokens are never read or included.
 */
export async function describeFunctionError(e: unknown): Promise<string> {
  const anyErr = e as any;
  const ctx = anyErr?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      const detail = body?.detail ?? body?.error ?? body?.message;
      if (typeof detail === "string" && detail.trim()) return detail;
    } catch {
      // fall through to the generic message
    }
  }
  const msg = anyErr?.message;
  return typeof msg === "string" && msg.trim() ? msg : String(e);
}

/**
 * Safe one-line formatter for Supabase/PostgREST errors. PostgREST errors
 * are plain objects (NOT Error instances), so String(e) renders the useless
 * "[object Object]" — this formatter prefers error.message, then
 * error.details, then a safe JSON.stringify, and finally a generic message.
 * It never renders a raw object in JSX.
 */
export function formatDataError(e: unknown): string {
  if (e == null) return "Something went wrong. Please try again.";
  if (typeof e === "string") return e.trim() || "Something went wrong. Please try again.";
  const anyErr = e as any;
  const message = anyErr?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  const details = anyErr?.details;
  if (typeof details === "string" && details.trim()) return details.trim();
  try {
    const json = JSON.stringify(e);
    if (json && json !== "{}") return json;
  } catch {
    // not serialisable — fall through to the generic message
  }
  return "Something went wrong. Please try again.";
}

/**
 * The single main message shown whenever extraction fails. The raw backend
 * detail is never shown inline — it is cleaned into a one-liner (if useful)
 * and kept behind a collapsed admin "Technical details" disclosure.
 */
export const EXTRACTION_FAILED_MESSAGE =
  "Extraction failed. The report is preserved — retry when ready.";

/** Returns the first complete {…} object embedded in a string, if any. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * JSON.parse that tolerates raw newlines/tabs inside string values — parser
 * details frequently embed pretty-printed JSON whose control characters were
 * never re-escaped when the body was stored.
 */
function parseJsonTolerant(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    // repair below
  }
  let out = "";
  let inString = false;
  let escape = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escape) {
      escape = false;
      out += ch;
    } else if (ch === "\\") {
      escape = true;
      out += ch;
    } else if (ch === '"') {
      inString = false;
      out += ch;
    } else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Strips provider prefixes (e.g. "openai_400:") and JSON wrappers from a
 * detail string, returning the readable human message inside, if any.
 */
function unwrapHumanDetail(value: string): string | null {
  let v = value.trim();
  const colon = v.indexOf(":");
  if (colon > 0 && /^[a-z0-9_]+$/i.test(v.slice(0, colon))) {
    v = v.slice(colon + 1).trim();
  }
  const obj = firstJsonObject(v);
  if (obj) {
    try {
      const nested = parseJsonTolerant(obj);
      const m = nested?.error?.message ?? nested?.message;
      if (typeof m === "string" && m.trim()) return m.trim();
    } catch {
      // not JSON after all — fall through to the plain-text check
    }
  }
  const rest = (obj ? v.replace(obj, " ") : v).replace(/\s+/g, " ").trim();
  // A readable sentence: plain words with spaces, no JSON braces.
  if (rest && !rest.includes("{") && !rest.includes("}") && rest.includes(" ")) return rest;
  return null;
}

/**
 * Turns a raw extraction error string into a cleaned, single-line human
 * summary, or null when nothing human-useful can be extracted (callers then
 * show only EXTRACTION_FAILED_MESSAGE and keep the raw text for the admin
 * technical disclosure). Never throws and never reads anything but the
 * string it is given.
 */
export function cleanExtractionDetail(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  const text = raw.trim();
  let human: string | null = null;
  const obj = firstJsonObject(text);
  if (obj) {
    try {
      const body = parseJsonTolerant(obj);
      const detail = body?.detail ?? body?.error ?? body?.message;
      if (typeof detail === "string" && detail.trim()) {
        human = unwrapHumanDetail(detail);
      }
    } catch {
      // fall through to plain-text handling
    }
  }
  if (!human) human = unwrapHumanDetail(text);
  if (!human) return null;
  // Always a single, clean line.
  const line = human.replace(/\s+/g, " ").trim();
  return line && !line.startsWith("{") ? line : null;
}

export interface UploadSoilSampleOutcome {
  sample: SoilSample;
  document: SoilSampleDocument;
  /** True when the parser accepted the job; false when it failed up front. */
  extractionStarted: boolean;
  extractionError: string | null;
}

/**
 * Creates the soil_samples row (pending), uploads the original document to
 * the private bucket, records it in soil_sample_documents, then invokes the
 * deployed soil-analysis-extract function with both ids. The function moves
 * the sample/document to review_required (or failed). If the invocation
 * itself fails, the sample is marked failed but the uploaded document and
 * sample history are always preserved — evidence is never deleted.
 */
export async function uploadSoilSample(input: UploadSoilSampleInput): Promise<UploadSoilSampleOutcome> {
  const invalid = validateSoilUpload(input.file);
  if (invalid) throw new Error(invalid);
  if (!input.vineyardId) throw new Error("Choose a vineyard before uploading.");

  // Minimal insert: the parser fills sampled_at and all lab metadata.
  const { data: sample, error: sampleErr } = await db
    .from("soil_samples")
    .insert({
      vineyard_id: input.vineyardId,
      sample_scope: "unmapped",
      extraction_status: "pending",
      created_by: input.uploadedBy,
    })
    .select()
    .single();
  if (sampleErr) throw sampleErr;

  const storagePath = `${input.vineyardId}/${sample.id}/${safeFileName(input.file.name)}`;
  const { error: upErr } = await db.storage
    .from(SOIL_DOCUMENT_BUCKET)
    .upload(storagePath, input.file, { upsert: false, contentType: input.file.type || undefined });
  if (upErr) throw new Error(`Document upload failed: ${upErr.message}`);

  const { data: document, error: docErr } = await db
    .from("soil_sample_documents")
    .insert({
      sample_id: sample.id,
      vineyard_id: input.vineyardId,
      storage_path: storagePath,
      original_filename: input.file.name,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      uploaded_by: input.uploadedBy,
    })
    .select()
    .single();
  if (docErr) throw docErr;

  // Invoke the live parser. It verifies the JWT and vineyard
  // membership server-side, then moves records to review_required or
  // failed. An invocation failure must not strand the upload at "pending".
  try {
    const { error: fnErr } = await supabase.functions.invoke(SOIL_EXTRACT_FUNCTION, {
      body: { sample_id: sample.id, document_id: document.id },
    });
    if (fnErr) throw fnErr;
    return { sample: sample as SoilSample, document: document as SoilSampleDocument, extractionStarted: true, extractionError: null };
  } catch (e) {
    const message = await describeFunctionError(e);
    await db
      .from("soil_samples")
      .update({ extraction_status: "failed" })
      .eq("id", sample.id);
    await db
      .from("soil_sample_documents")
      .update({ extraction_status: "failed", extraction_error: message })
      .eq("id", document.id);
    return {
      sample: { ...(sample as SoilSample), extraction_status: "failed" },
      document: { ...(document as SoilSampleDocument), extraction_status: "failed", extraction_error: message },
      extractionStarted: false,
      extractionError: message,
    };
  }
}

export interface RetryExtractionOutcome {
  ok: boolean;
  error: string | null;
}

/**
 * Retries extraction for a failed sample using the EXISTING sample and
 * primary document ids — the evidence file is never re-uploaded and no
 * duplicate rows are created. Resets both records to pending, clears the
 * document error, then re-invokes the parser. On failure the records are
 * marked failed with the surfaced detail and everything is preserved.
 */
export async function retrySoilExtraction(
  sampleId: string,
  documentId: string,
): Promise<RetryExtractionOutcome> {
  const { error: sampleErr } = await db
    .from("soil_samples")
    .update({ extraction_status: "pending" })
    .eq("id", sampleId);
  if (sampleErr) throw sampleErr;
  const { error: docErr } = await db
    .from("soil_sample_documents")
    .update({ extraction_status: "pending", extraction_error: null })
    .eq("id", documentId);
  if (docErr) throw docErr;

  try {
    const { error: fnErr } = await supabase.functions.invoke(SOIL_EXTRACT_FUNCTION, {
      body: { sample_id: sampleId, document_id: documentId },
    });
    if (fnErr) throw fnErr;
    return { ok: true, error: null };
  } catch (e) {
    const message = await describeFunctionError(e);
    await db
      .from("soil_samples")
      .update({ extraction_status: "failed" })
      .eq("id", sampleId);
    await db
      .from("soil_sample_documents")
      .update({ extraction_status: "failed", extraction_error: message })
      .eq("id", documentId);
    return { ok: false, error: message };
  }
}

/** Signed short-lived URL for the private evidence document. */
export async function getSoilDocumentSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
  const { data, error } = await db.storage
    .from(SOIL_DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Could not create a signed URL for the document.");
  return data.signedUrl as string;
}

// ---------------------------------------------------------------------------
// Review edits — allow-listed writes; extraction provenance is never touched
// ---------------------------------------------------------------------------

const SAMPLE_EDITABLE_FIELDS = [
  "sampled_at",
  "received_at",
  "reported_at",
  "laboratory",
  "lab_code",
  "order_number",
  "lab_sample_id",
  "lab_paddock_name",
  "client_agronomist",
  "crop",
  "soil_type",
  "sample_depth_from_cm",
  "sample_depth_to_cm",
  "notes",
  "paddock_id",
  "sample_scope",
  "row_start",
  "row_end",
  "latitude",
  "longitude",
] as const;

export type SoilSamplePatch = Partial<Pick<SoilSample, (typeof SAMPLE_EDITABLE_FIELDS)[number]>>;

/** Builds the update payload, dropping any non-editable (or provenance) key. */
export function buildSamplePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SAMPLE_EDITABLE_FIELDS) {
    if (key in patch) out[key] = patch[key];
  }
  return out;
}

export async function updateSoilSample(id: string, patch: SoilSamplePatch): Promise<void> {
  const payload = buildSamplePatch(patch);
  if (Object.keys(payload).length === 0) return;
  const { error } = await db.from("soil_samples").update(payload).eq("id", id);
  if (error) throw error;
}

/**
 * Explicit Confirm action: marks the reviewed sample confirmed with the
 * reviewing user and timestamp. Saving edits alone never confirms.
 */
export const CONFIRM_DATE_REQUIRED_MESSAGE =
  "Review saved. Add a sample date before confirming this soil sample.";

/** soil_samples_confirmed_date_chk: a confirmed sample must have sampled_at. */
export function hasConfirmableSampleDate(sampledAt: unknown): boolean {
  return typeof sampledAt === "string" && sampledAt.trim().length > 0;
}

export class MissingSampleDateError extends Error {
  constructor() {
    super(CONFIRM_DATE_REQUIRED_MESSAGE);
    this.name = "MissingSampleDateError";
  }
}

/**
 * Pass the current sampled_at so the client refuses before the database
 * check constraint can surface as a raw error. Omitting it keeps legacy
 * behaviour (the database constraint still enforces the rule).
 */
export async function confirmSoilSample(
  id: string,
  userId: string,
  ...rest: [sampledAt?: string | null]
): Promise<void> {
  if (rest.length > 0 && !hasConfirmableSampleDate(rest[0])) throw new MissingSampleDateError();
  const { error } = await db
    .from("soil_samples")
    .update({
      extraction_status: "confirmed",
      verified_by: userId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

// method / unit / lab range / lab status are intentionally NOT editable in
// The schema keeps no duplicate source copies for them, so a Portal
// edit would silently overwrite extraction evidence.
const RESULT_EDITABLE_FIELDS = [
  "analyte_key",
  "value_numeric",
  "value_text",
  "is_user_verified",
  "notes",
] as const;

export type SoilResultPatch = Partial<Pick<SoilSampleResult, (typeof RESULT_EDITABLE_FIELDS)[number]>>;

/**
 * Builds the result update payload. Only current-value and mapping fields
 * are allowed; source_value_numeric / source_value_text provenance keys are
 * stripped even if a caller passes them, and every correction is marked
 * is_user_corrected.
 */
export function buildResultPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of RESULT_EDITABLE_FIELDS) {
    if (key in patch) out[key] = patch[key];
  }
  if (Object.keys(out).length > 0) out.is_user_corrected = true;
  return out;
}

export async function updateSoilResult(id: string, patch: SoilResultPatch): Promise<void> {
  const payload = buildResultPatch(patch);
  if (Object.keys(payload).length === 0) return;
  const { error } = await db.from("soil_sample_results").update(payload).eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Comparability — never silently mix methods or units
// ---------------------------------------------------------------------------

export function normaliseMethod(method: string | null | undefined): string | null {
  const m = (method ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return m || null;
}

export function normaliseUnit(unit: string | null | undefined): string | null {
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "").replace("mg/kg", "ppm");
  return u || null;
}

/** Well-known incompatible method families (same analyte, different chemistry). */
const METHOD_FAMILIES: Array<{ family: string; members: RegExp[] }> = [
  { family: "phosphorus", members: [/colwell/i, /mehlich/i, /olsen/i, /bray/i] },
  { family: "micronutrient", members: [/dtpa/i, /mehlich/i, /hcl/i] },
];

export interface Comparability {
  comparable: boolean;
  reason: string | null;
}

/**
 * Two results are comparable only when they share the canonical analyte, a
 * compatible method and a compatible unit. Anything unclear fails closed.
 */
export function areResultsComparable(
  a: Pick<SoilSampleResult, "analyte_key" | "method" | "unit">,
  b: Pick<SoilSampleResult, "analyte_key" | "method" | "unit">,
): Comparability {
  if (!a.analyte_key || !b.analyte_key || a.analyte_key !== b.analyte_key) {
    return { comparable: false, reason: "Different analytes" };
  }
  const ma = normaliseMethod(a.method);
  const mb = normaliseMethod(b.method);
  if (!ma || !mb) return { comparable: false, reason: "Method not recorded" };
  if (ma !== mb) {
    return { comparable: false, reason: `Different methods (${a.method} vs ${b.method})` };
  }
  // Explicit family guard: even normalised-equal strings are rechecked so a
  // future normalisation change cannot merge Colwell P with Mehlich P or
  // DTPA micronutrients with other extractions.
  for (const { members } of METHOD_FAMILIES) {
    const aMatch = members.find((re) => re.test(a.method ?? ""));
    const bMatch = members.find((re) => re.test(b.method ?? ""));
    if (aMatch && bMatch && aMatch.source !== bMatch.source) {
      return { comparable: false, reason: `Incompatible methods (${a.method} vs ${b.method})` };
    }
  }
  const ua = normaliseUnit(a.unit);
  const ub = normaliseUnit(b.unit);
  if (!ua || !ub) return { comparable: false, reason: "Unit not recorded" };
  if (ua !== ub) return { comparable: false, reason: `Different units (${a.unit} vs ${b.unit})` };
  return { comparable: true, reason: null };
}

export interface TrendPoint {
  result: SoilSampleResult;
  sample: SoilSample;
}

export interface TrendGroup {
  method: string | null;
  unit: string | null;
  points: TrendPoint[];
}

/**
 * Groups a block's results for one analyte into comparable series. Points in
 * different groups must never be drawn on the same line.
 */
export function buildTrendGroups(points: TrendPoint[]): TrendGroup[] {
  const groups: TrendGroup[] = [];
  for (const point of points) {
    const existing = groups.find((g) => {
      const probe: TrendPoint = { result: { ...point.result, method: g.method, unit: g.unit }, sample: point.sample };
      return areResultsComparable(probe.result, point.result).comparable;
    });
    if (existing) existing.points.push(point);
    else groups.push({ method: point.result.method, unit: point.result.unit, points: [point] });
  }
  return groups;
}

export type TrendDirection = "improving" | "declining" | "steady" | "not_classified";

/**
 * Classifies the change between two comparable results using the catalogue's
 * desired_direction only:
 * - higher / lower: direction of movement is classified.
 * - range: movement is described relative to the lab range, never as
 *   improving/declining.
 * - context_only: never classified.
 */
export function classifyChange(
  previous: number,
  current: number,
  desiredDirection: SoilDesiredDirection | null | undefined,
): { direction: TrendDirection; delta: number } {
  const delta = current - previous;
  if (desiredDirection !== "higher" && desiredDirection !== "lower") {
    return { direction: "not_classified", delta };
  }
  if (delta === 0) return { direction: "steady", delta };
  const improving = desiredDirection === "higher" ? delta > 0 : delta < 0;
  return { direction: improving ? "improving" : "declining", delta };
}

// ---------------------------------------------------------------------------
// Compare matrix — lab status by analyte × block, mixed methods flagged
// ---------------------------------------------------------------------------

export interface CompareCell {
  paddockId: string;
  analyteKey: string;
  /** Latest result in the period for this block/analyte, if any. */
  result: (SoilSampleResult & { sample: SoilSample }) | null;
  /** True when other blocks used a different method/unit for this analyte. */
  mixedMethods: boolean;
}

export function buildCompareMatrix(
  rows: Array<SoilSampleResult & { sample: SoilSample; matched_paddock_id?: string }>,
  paddockIds: string[],
  analyteKeys: string[],
): CompareCell[][] {
  return analyteKeys.map((analyteKey) => {
    const forAnalyte = rows.filter((r) => r.analyte_key === analyteKey);
    const signatures = new Set(
      forAnalyte.map((r) => `${normaliseMethod(r.method) ?? "?"}|${normaliseUnit(r.unit) ?? "?"}`),
    );
    const mixedMethods = signatures.size > 1;
    return paddockIds.map((paddockId) => {
      const candidates = forAnalyte
        // matched_paddock_id (from block mappings) is the authority; the
        // legacy sample.paddock_id link is only a fallback.
        .filter((r) => (r.matched_paddock_id ?? r.sample.paddock_id) === paddockId)
        .sort((a, b) =>
          String(b.sample.sampled_at ?? b.sample.created_at).localeCompare(
            String(a.sample.sampled_at ?? a.sample.created_at),
          ),
        );
      return { paddockId, analyteKey, result: candidates[0] ?? null, mixedMethods };
    });
  });
}

// ---------------------------------------------------------------------------
// Trend / Compare visual series. areResultsComparable() stays strict; these
// visual policies add a PROVISIONAL tier only when every point in a group is
// missing its method (same analyte + same unit). Known and unknown methods,
// different known methods and different units are never mixed.
// ---------------------------------------------------------------------------

export const TREND_PROVISIONAL_BADGE = "Method not recorded — visual trend only";
export const COMPARE_PROVISIONAL_BADGE = "Method not recorded — comparison is provisional";

type SeriesProbe = Pick<SoilSampleResult, "analyte_key" | "method" | "unit">;

/** Visual series key: analyte | normalised unit | normalised method ("" = not recorded). */
export function visualSeriesKey(r: SeriesProbe): string {
  return `${r.analyte_key ?? ""}|${normaliseUnit(r.unit) ?? ""}|${normaliseMethod(r.method) ?? ""}`;
}

export interface TrendSeries {
  key: string;
  method: string | null;
  unit: string | null;
  /** True when every point lacks a method — visual only. */
  provisional: boolean;
  points: TrendPoint[];
}

const sampleDateOf = (s: Pick<SoilSample, "sampled_at" | "created_at">) =>
  String(s.sampled_at ?? s.created_at ?? "").slice(0, 10);

export function buildTrendSeries(points: TrendPoint[]): TrendSeries[] {
  const map = new Map<string, TrendSeries>();
  for (const p of points) {
    const key = visualSeriesKey(p.result);
    const existing = map.get(key);
    if (existing) existing.points.push(p);
    else
      map.set(key, {
        key,
        method: p.result.method,
        unit: p.result.unit,
        provisional: !normaliseMethod(p.result.method),
        points: [p],
      });
  }
  const out = [...map.values()];
  for (const g of out) {
    g.points.sort((a, b) => sampleDateOf(a.sample).localeCompare(sampleDateOf(b.sample)));
  }
  // Most populated series first; strict before provisional on ties.
  out.sort((a, b) => b.points.length - a.points.length || Number(a.provisional) - Number(b.provisional));
  return out;
}

export interface DateAveragePoint {
  date: string;
  /** VineTrack-derived arithmetic mean of raw numeric results on this date. */
  average: number;
  count: number;
}

/** Partition BEFORE averaging or summarising. A block without this series stays present. */
export function splitTrendByBlocks(active: TrendSeries | null, rows: BlockAnalyteResult[], paddockIds: string[]): Array<{ paddockId: string; series: TrendSeries | null }> {
  return paddockIds.map((paddockId) => {
    const points = rows.filter((r) => r.matched_paddock_id === paddockId && visualSeriesKey(r) === active?.key)
      .map((r) => ({ result: r, sample: r.sample }));
    return { paddockId, series: active && points.length ? { ...active, points } : null };
  });
}

export function buildDateAverages(points: TrendPoint[]): DateAveragePoint[] {
  const byDate = new Map<string, number[]>();
  for (const p of points) {
    const v = p.result.value_numeric;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const d = sampleDateOf(p.sample);
    byDate.set(d, [...(byDate.get(d) ?? []), v]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date,
      average: vals.reduce((x, y) => x + y, 0) / vals.length,
      count: vals.length,
    }));
}

export function percentChange(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const rangeSignature = (r: SoilSampleResult) =>
  r.lab_range_min == null && r.lab_range_max == null && !r.lab_range_text
    ? null
    : `${r.lab_range_min ?? ""}|${r.lab_range_max ?? ""}|${(r.lab_range_text ?? "").trim().toLowerCase()}`;

export function labRangeChanged(points: TrendPoint[]): boolean {
  const sigs = new Set(points.map((p) => rangeSignature(p.result)).filter(Boolean));
  return sigs.size > 1;
}

const fmtNum = (n: number) => String(Number(n.toFixed(2)));

export interface TrendSummary {
  latest: DateAveragePoint | null;
  previous: DateAveragePoint | null;
  delta: number | null;
  percent: number | null;
  latestStatus: string | null;
  sampleCount: number;
  dateCount: number;
  rangeChanged: boolean;
  sentences: string[];
}

/** Measured-language summary; never gives treatment advice. */
export function summariseTrend(
  series: TrendSeries,
  analyteName: string,
  desiredDirection: SoilDesiredDirection | null | undefined,
): TrendSummary {
  const avgs = buildDateAverages(series.points);
  const latest = avgs[avgs.length - 1] ?? null;
  const previous = avgs.length > 1 ? avgs[avgs.length - 2] : null;
  const delta = latest && previous ? latest.average - previous.average : null;
  const percent = latest && previous ? percentChange(previous.average, latest.average) : null;
  const latestPoints = latest
    ? series.points.filter((p) => sampleDateOf(p.sample) === latest.date)
    : [];
  const statuses = [...new Set(latestPoints.map((p) => labStatusLabel(p.result.lab_status)))];
  const latestStatus = statuses.length ? statuses.join(" / ") : null;
  const unit = series.unit ? ` ${series.unit}` : "";
  const rangeChanged = labRangeChanged(series.points);
  const sentences: string[] = [];
  if (latest) {
    const latestLabel = latest.count > 1 ? "same-date average" : "value";
    sentences.push(`Latest ${analyteName} ${latestLabel} is ${fmtNum(latest.average)}${unit}.`);
    if (previous && delta != null) {
      const prevLabel = previous.count > 1 ? "same-date average" : "result";
      const year = previous.date.slice(0, 4);
      const pct = percent != null ? ` (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%)` : "";
      const movement =
        delta === 0
          ? "unchanged"
          : `${fmtNum(Math.abs(delta))}${unit} ${delta > 0 ? "higher" : "lower"}${pct}`;
      let s = `The ${year} ${prevLabel} was ${fmtNum(previous.average)}${unit}, so the measured value is ${movement}.`;
      if (desiredDirection === "higher" || desiredDirection === "lower") {
        const c = classifyChange(previous.average, latest.average, desiredDirection);
        if (c.direction !== "not_classified") s += ` Catalogue direction: ${c.direction}.`;
      }
      sentences.push(s);
    }
    if (latestStatus) sentences.push(`The latest laboratory status is ${latestStatus}.`);
  }
  if (rangeChanged) sentences.push("Laboratory reference range changed between reports.");
  if (series.provisional) {
    sentences.push("Method was not recorded on these reports; treat the visual trend as provisional.");
  }
  return {
    latest,
    previous,
    delta,
    percent,
    latestStatus,
    sampleCount: series.points.length,
    dateCount: avgs.length,
    rangeChanged,
    sentences,
  };
}

// --- Compare: Values mode --------------------------------------------------

export interface CompareSeriesOption {
  key: string;
  method: string | null;
  unit: string | null;
  provisional: boolean;
  count: number;
}

export function compareSeriesOptions(
  rows: Array<SoilSampleResult>,
  analyteKey: string,
): CompareSeriesOption[] {
  const map = new Map<string, CompareSeriesOption>();
  for (const r of rows) {
    if (r.analyte_key !== analyteKey) continue;
    const key = visualSeriesKey(r);
    const e = map.get(key);
    if (e) e.count++;
    else
      map.set(key, {
        key,
        method: r.method,
        unit: r.unit,
        provisional: !normaliseMethod(r.method),
        count: 1,
      });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || Number(a.provisional) - Number(b.provisional));
}

export interface ValueComparisonRow {
  paddockId: string;
  result: (SoilSampleResult & { sample: SoilSample }) | null;
}

/** One row per selected block (no-result blocks retained), latest result in the series. */
export function buildValueComparison(
  rows: Array<SoilSampleResult & { sample: SoilSample; matched_paddock_id?: string }>,
  paddockIds: string[],
  seriesKey: string,
): ValueComparisonRow[] {
  return paddockIds.map((paddockId) => {
    const candidates = rows
      .filter((r) => visualSeriesKey(r) === seriesKey)
      .filter((r) => (r.matched_paddock_id ?? r.sample.paddock_id) === paddockId)
      .sort((a, b) => sampleDateOf(b.sample).localeCompare(sampleDateOf(a.sample)));
    return { paddockId, result: candidates[0] ?? null };
  });
}

export function sortValueComparison(
  rows: ValueComparisonRow[],
  order: "value" | "block",
  blockName: (id: string) => string,
): ValueComparisonRow[] {
  const copy = [...rows];
  if (order === "block") return copy.sort((a, b) => blockName(a.paddockId).localeCompare(blockName(b.paddockId)));
  return copy.sort((a, b) => {
    const va = a.result?.value_numeric;
    const vb = b.result?.value_numeric;
    if (va == null && vb == null) return blockName(a.paddockId).localeCompare(blockName(b.paddockId));
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va;
  });
}

export interface ValueComparisonSummary {
  withData: number;
  selected: number;
  highest: { paddockId: string; value: number } | null;
  lowest: { paddockId: string; value: number } | null;
  spread: number | null;
}

export function summariseValueComparison(rows: ValueComparisonRow[]): ValueComparisonSummary {
  const numeric = rows.filter(
    (r) => typeof r.result?.value_numeric === "number" && Number.isFinite(r.result.value_numeric),
  ) as Array<ValueComparisonRow & { result: SoilSampleResult & { value_numeric: number } }>;
  let highest: ValueComparisonSummary["highest"] = null;
  let lowest: ValueComparisonSummary["lowest"] = null;
  for (const r of numeric) {
    const v = r.result.value_numeric;
    if (!highest || v > highest.value) highest = { paddockId: r.paddockId, value: v };
    if (!lowest || v < lowest.value) lowest = { paddockId: r.paddockId, value: v };
  }
  return {
    withData: rows.filter((r) => r.result).length,
    selected: rows.length,
    highest,
    lowest,
    spread: highest && lowest ? highest.value - lowest.value : null,
  };
}

// --- Compare: Status overview filters --------------------------------------

export function filterCompareMatrix(
  matrix: CompareCell[][],
  opts: { category?: string | null; outsideOnly?: boolean; categoryOf?: (key: string) => string | null },
): CompareCell[][] {
  return matrix.filter((row) => {
    const key = row[0]?.analyteKey ?? "";
    if (opts.category && opts.categoryOf && opts.categoryOf(key) !== opts.category) return false;
    if (opts.outsideOnly && !row.some((c) => isOutsideLabRange(c.result?.lab_status))) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Hard delete — unapproved samples only. The backend RLS/storage policies are
// the authority (confirmed samples and their documents/results cannot be
// deleted); the Portal mirrors that rule and fails closed. This is an
// intentional HARD delete: no soft-delete, no deleted_at flag.
// ---------------------------------------------------------------------------

export const CONFIRMED_DELETE_MESSAGE = "Confirmed soil samples cannot be deleted.";

/** Deletable: pending, processing, review_required, failed. Never confirmed. */
export function isSoilSampleDeletable(status: SoilSampleStatus | null | undefined): boolean {
  return status !== "confirmed";
}

/**
 * Permanently deletes an unapproved sample:
 * 1. fetches every soil_sample_documents row for the sample;
 * 2. removes ALL document storage objects first — if storage removal fails
 *    we STOP and keep every database row so evidence is never orphaned;
 * 3. deletes the soil_samples row guarded by .neq('extraction_status',
 *    'confirmed') so a concurrently confirmed sample is never removed;
 *    child document/result rows cascade from the sample delete.
 */
export async function deleteSoilSample(sampleId: string): Promise<void> {
  const { data: docs, error: docErr } = await db
    .from("soil_sample_documents")
    .select("id, storage_bucket, storage_path")
    .eq("sample_id", sampleId);
  if (docErr) throw docErr;

  const byBucket = new Map<string, string[]>();
  for (const doc of docs ?? []) {
    const bucket = doc.storage_bucket || SOIL_DOCUMENT_BUCKET;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), doc.storage_path]);
  }
  for (const [bucket, paths] of byBucket) {
    const { error: storageErr } = await db.storage.from(bucket).remove(paths);
    if (storageErr) {
      throw new Error(`Could not remove the uploaded source document: ${storageErr.message}`);
    }
  }

  const { data: deleted, error: delErr } = await db
    .from("soil_samples")
    .delete()
    .eq("id", sampleId)
    .neq("extraction_status", "confirmed")
    .select("id");
  if (delErr) {
    if (/confirmed|policy|permission|row-level/i.test(delErr.message)) {
      throw new Error(CONFIRMED_DELETE_MESSAGE);
    }
    throw delErr;
  }
  // The guard matched no row — the sample became confirmed concurrently.
  if (!deleted || deleted.length === 0) throw new Error(CONFIRMED_DELETE_MESSAGE);
}

// ---------------------------------------------------------------------------
// Reports — the RPCs are the authority and return CONFIRMED samples only.
// The Portal never queries review/failed samples for reporting, never mixes
// method/unit series, and never interpolates across unsampled blocks.
// ---------------------------------------------------------------------------

export interface SoilReportSeries {
  analyte_key: string;
  analyte_name: string;
  category: string | null;
  method: string | null;
  unit: string | null;
  desired_direction: SoilDesiredDirection | null;
  block_count: number;
  sample_count: number;
  first_sampled_at: string | null;
  latest_sampled_at: string | null;
}

export interface SoilMapReportRow {
  paddock_id: string;
  paddock_name: string | null;
  polygon_points: unknown;
  sample_id: string | null;
  sampled_at: string | null;
  laboratory: string | null;
  lab_sample_id: string | null;
  sample_depth_from_cm: number | null;
  sample_depth_to_cm: number | null;
  value_numeric: number | null;
  value_text: string | null;
  lab_range_min: number | null;
  lab_range_max: number | null;
  lab_range_text: string | null;
  lab_status: string | null;
  extraction_confidence: number | null;
  previous_sample_id: string | null;
  previous_sampled_at: string | null;
  previous_value_numeric: number | null;
}

export async function listSoilReportSeries(vineyardId: string): Promise<SoilReportSeries[]> {
  const { data, error } = await db.rpc("soil_analysis_report_series", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
  return (data ?? []) as SoilReportSeries[];
}

export async function getSoilMapReport(input: {
  vineyardId: string;
  analyteKey: string;
  method: string | null;
  unit: string | null;
  asOf?: string | null;
}): Promise<SoilMapReportRow[]> {
  const { data, error } = await db.rpc("soil_analysis_map_report", {
    p_vineyard_id: input.vineyardId,
    p_analyte_key: input.analyteKey,
    p_method: input.method,
    p_unit: input.unit,
    p_as_of: input.asOf ?? null,
  });
  if (error) throw error;
  return (data ?? []) as SoilMapReportRow[];
}

/** Default pilot series: Total Carbon when present, otherwise the first. */
export function pickDefaultSeries(series: SoilReportSeries[]): SoilReportSeries | null {
  if (series.length === 0) return null;
  return (
    series.find((s) => s.analyte_name.trim().toLowerCase() === "total carbon") ?? series[0]
  );
}

/** All comparable series for one analyte — >1 means method/unit must be chosen explicitly. */
export function seriesForAnalyte(
  series: SoilReportSeries[],
  analyteKey: string,
): SoilReportSeries[] {
  return series.filter((s) => s.analyte_key === analyteKey);
}

/** Stable identity for one comparable method/unit series. */
export function seriesKey(s: Pick<SoilReportSeries, "method" | "unit">): string {
  return `${s.method ?? ""}|${s.unit ?? ""}`;
}

// Sequential quantitative value scale (light → deep green). It is purely
// quantitative — it never implies good/bad — and no-data blocks use a
// distinct neutral grey so unsampled blocks are unmistakable.
export const SOIL_MAP_NO_DATA_COLOR = "#b8bec4";
const SCALE_LOW = { r: 227, g: 242, b: 232 };
const SCALE_HIGH = { r: 27, g: 122, b: 67 };

export function valueScaleColor(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return SOIL_MAP_NO_DATA_COLOR;
  }
  // Equal values (or a single value) use one stable midpoint colour — never
  // divide by zero.
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0.5;
  const r = Math.round(SCALE_LOW.r + (SCALE_HIGH.r - SCALE_LOW.r) * t);
  const g = Math.round(SCALE_LOW.g + (SCALE_HIGH.g - SCALE_LOW.g) * t);
  const b = Math.round(SCALE_LOW.b + (SCALE_HIGH.b - SCALE_LOW.b) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export interface SoilMapStats {
  totalBlocks: number;
  withData: number;
  min: number | null;
  median: number | null;
  max: number | null;
  /** Only set when every value is a valid comparable number. */
  average: number | null;
  latestSampledAt: string | null;
}

export function summariseMapReport(rows: SoilMapReportRow[]): SoilMapStats {
  const values = rows
    .map((r) => r.value_numeric)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const n = values.length;
  const median =
    n === 0 ? null : n % 2 === 1 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
  const average = n === 0 ? null : values.reduce((a, b) => a + b, 0) / n;
  const latestSampledAt = rows
    .filter((r) => r.value_numeric != null && r.sampled_at)
    .map((r) => r.sampled_at as string)
    .sort()
    .pop() ?? null;
  return {
    totalBlocks: rows.length,
    withData: n,
    min: n ? values[0] : null,
    median,
    max: n ? values[n - 1] : null,
    average,
    latestSampledAt,
  };
}

// Lab status mode — categories come only from the laboratory's own
// range/status fields; missing or unreliable values show "Not stated".
export const LAB_STATUS_MAP_COLOR: Record<string, string> = {
  low: "#d97706",
  within_range: "#1b7a43",
  high: "#b91c1c",
  no_range: "#6b7280",
  unknown: SOIL_MAP_NO_DATA_COLOR,
};

export function labStatusMapColor(status: string | null | undefined): string {
  return LAB_STATUS_MAP_COLOR[status ?? "unknown"] ?? LAB_STATUS_MAP_COLOR.unknown;
}

/** Compact map/table number: up to 2 decimals, trailing zeros trimmed. */
export function formatMapValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Number(value.toFixed(2)));
}

// ---------------------------------------------------------------------------
// Map labels — MapKit collision/display priority. Short value-only labels in
// Smart mode so MapKit can hide overlapping low-priority labels; the selected
// block is always Required with the full label. No clustering.
// ---------------------------------------------------------------------------

export type SoilMapLabelMode = "smart" | "all" | "off";
export const DEFAULT_SOIL_MAP_LABEL_MODE: SoilMapLabelMode = "smart";

export interface SoilMapLabelSpec {
  text: string;
  priority: "low" | "required";
  collision: "rectangle";
  selected: boolean;
}

export function soilMapLabelSpec(
  row: Pick<SoilMapReportRow, "paddock_name" | "value_numeric">,
  opts: { mode: SoilMapLabelMode; selected: boolean; unit: string | null },
): SoilMapLabelSpec | null {
  if (opts.mode === "off") return null;
  const hasValue = typeof row.value_numeric === "number" && Number.isFinite(row.value_numeric);
  if (opts.selected) {
    const name = row.paddock_name ?? "Block";
    return {
      text: hasValue
        ? `${name} · ${formatMapValue(row.value_numeric)}${opts.unit ? ` ${opts.unit}` : ""}`
        : `${name} · No confirmed value`,
      priority: "required",
      collision: "rectangle",
      selected: true,
    };
  }
  if (!hasValue) return null;
  return {
    text: formatMapValue(row.value_numeric),
    priority: opts.mode === "all" ? "required" : "low",
    collision: "rectangle",
    selected: false,
  };
}

// ---------------------------------------------------------------------------
// Time period presets (Trends chart window / Compare sample period)
// ---------------------------------------------------------------------------

export interface SoilTimePreset {
  key: string;
  label: string;
  /** Whole years back from today; null means no window (All time). */
  years: number | null;
}

export const SOIL_TIME_PRESETS: readonly SoilTimePreset[] = [
  { key: "1y", label: "Past year", years: 1 },
  { key: "2y", label: "Past 2 years", years: 2 },
  { key: "3y", label: "Past 3 years", years: 3 },
  { key: "4y", label: "Past 4 years", years: 4 },
  { key: "5y", label: "Past 5 years", years: 5 },
  { key: "all", label: "All time", years: null },
];

/** Inclusive YYYY-MM-DD cutoff for a preset; null for All time or unknown keys. */
export function soilTimePresetCutoff(key: string, today: Date = new Date()): string | null {
  const preset = SOIL_TIME_PRESETS.find((p) => p.key === key);
  if (!preset || preset.years == null) return null;
  const d = new Date(today.getTime());
  d.setFullYear(d.getFullYear() - preset.years);
  return d.toISOString().slice(0, 10);
}
