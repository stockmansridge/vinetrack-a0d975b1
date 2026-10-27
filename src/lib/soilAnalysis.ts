// Soil Analysis — Stage 1 System Admin preview (Portal only).
//
// Data authority is the shared VineTrack backend (iOS Supabase project).
// The live tables are System Admin-only under RLS; this module is the single
// place that names their columns so any schema adjustment by the database
// owner lands in one file.
//
// Safety rules enforced here:
// - source_* columns are immutable extraction provenance; user corrections
//   only ever write value_* / mapping fields and set is_user_corrected.
// - The uploaded document is evidence and is never replaced or deleted.
// - No agronomic recommendations: status language comes only from the
//   laboratory's own range/status fields.

import { supabase } from "@/integrations/ios-supabase/client";
import { SOIL_ANALYSIS_FLAG } from "@/lib/navigationConfig";

const db = supabase as any;

export { SOIL_ANALYSIS_FLAG };
export const SOIL_DOCUMENT_BUCKET = "soil-analysis-documents";

// ---------------------------------------------------------------------------
// Types (live table contract)
// ---------------------------------------------------------------------------

export type SoilSampleStatus = "pending" | "review_required" | "confirmed";
export type SoilExtractionStatus = "awaiting_extraction" | "extracted" | "failed";
export type SoilMappingType = "unmapped" | "block" | "row_range" | "point";

export interface SoilSample {
  id: string;
  vineyard_id: string;
  paddock_id: string | null;
  mapping_type: SoilMappingType;
  row_from: number | null;
  row_to: number | null;
  point_lat: number | null;
  point_lng: number | null;
  sample_date: string | null;
  laboratory: string | null;
  lab_sample_id: string | null;
  lab_paddock_name: string | null;
  depth_from_cm: number | null;
  depth_to_cm: number | null;
  status: SoilSampleStatus;
  extraction_status: SoilExtractionStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined display fields
  block_name?: string | null;
  vineyard_name?: string | null;
}

export interface SoilSampleDocument {
  id: string;
  sample_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  byte_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface SoilSampleResult {
  id: string;
  sample_id: string;
  // Immutable extraction provenance — never written by the Portal.
  source_analyte: string | null;
  source_method: string | null;
  source_unit: string | null;
  source_value: string | null;
  source_range_low: number | null;
  source_range_high: number | null;
  source_lab_status: string | null;
  source_page: number | null;
  // Current (possibly corrected) values.
  analyte_key: string | null;
  method: string | null;
  unit: string | null;
  value_numeric: number | null;
  value_text: string | null;
  lab_range_low: number | null;
  lab_range_high: number | null;
  lab_status: string | null;
  confidence: number | null;
  is_verified: boolean;
  is_user_corrected: boolean;
  created_at: string;
  updated_at: string;
}

export interface SoilAnalyte {
  id: string;
  analyte_key: string;
  display_name: string;
  category: string | null;
  default_unit: string | null;
  method_group: string | null;
  /** null = no direction metadata; never guess improving/declining. */
  higher_is_better: boolean | null;
  created_at: string;
}

export interface SoilBlockAlias {
  id: string;
  vineyard_id: string;
  lab_paddock_name: string;
  paddock_id: string;
  created_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Labels — restrained, lab-status-only language
// ---------------------------------------------------------------------------

export const SAMPLE_STATUS_LABEL: Record<SoilSampleStatus, string> = {
  pending: "Pending",
  review_required: "Review required",
  confirmed: "Confirmed",
};

export const EXTRACTION_STATUS_LABEL: Record<SoilExtractionStatus, string> = {
  awaiting_extraction: "Awaiting extraction",
  extracted: "Extracted",
  failed: "Extraction failed",
};

export const MAPPING_TYPE_LABEL: Record<SoilMappingType, string> = {
  unmapped: "Unmapped",
  block: "Whole block",
  row_range: "Row range",
  point: "Point",
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
  extractionStatus?: SoilExtractionStatus | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function listSoilSamples(filters: SoilSampleFilters = {}): Promise<SoilSample[]> {
  let q = db
    .from("soil_samples")
    .select("*, paddocks(name), vineyards(name)")
    .order("sample_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (filters.vineyardId) q = q.eq("vineyard_id", filters.vineyardId);
  if (filters.paddockId) q = q.eq("paddock_id", filters.paddockId);
  if (filters.laboratory) q = q.eq("laboratory", filters.laboratory);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.extractionStatus) q = q.eq("extraction_status", filters.extractionStatus);
  if (filters.dateFrom) q = q.gte("sample_date", filters.dateFrom);
  if (filters.dateTo) q = q.lte("sample_date", filters.dateTo);
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
}> {
  const { data: sample, error } = await db
    .from("soil_samples")
    .select("*, paddocks(name), vineyards(name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!sample) throw new Error("Soil sample not found.");
  const [{ data: docs, error: docErr }, { data: results, error: resErr }] = await Promise.all([
    db.from("soil_sample_documents").select("*").eq("sample_id", id).order("created_at"),
    db.from("soil_sample_results").select("*").eq("sample_id", id).order("created_at"),
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
  };
}

export async function listAnalyteCatalogue(): Promise<SoilAnalyte[]> {
  const { data, error } = await db
    .from("soil_analyte_catalogue")
    .select("*")
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
    .order("lab_paddock_name");
  if (error) throw error;
  return (data ?? []) as SoilBlockAlias[];
}

/** Results for one block + analyte across time, oldest first, with sample context. */
export async function listBlockAnalyteResults(
  paddockId: string,
  analyteKey: string,
): Promise<Array<SoilSampleResult & { sample: SoilSample }>> {
  const { data, error } = await db
    .from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .eq("analyte_key", analyteKey)
    .eq("soil_samples.paddock_id", paddockId);
  if (error) throw error;
  const rows = (data ?? []).map((row: any) => {
    const { soil_samples: s, ...result } = row;
    return {
      ...result,
      sample: { ...s, block_name: s?.paddocks?.name ?? null, paddocks: undefined } as SoilSample,
    };
  });
  rows.sort((a: any, b: any) =>
    String(a.sample.sample_date ?? a.sample.created_at).localeCompare(
      String(b.sample.sample_date ?? b.sample.created_at),
    ),
  );
  return rows;
}

/** Results for a set of blocks within a sample-date period (Compare tab). */
export async function listBlockPeriodResults(
  paddockIds: string[],
  dateFrom: string | null,
  dateTo: string | null,
): Promise<Array<SoilSampleResult & { sample: SoilSample }>> {
  if (paddockIds.length === 0) return [];
  let q = db
    .from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .in("soil_samples.paddock_id", paddockIds);
  if (dateFrom) q = q.gte("soil_samples.sample_date", dateFrom);
  if (dateTo) q = q.lte("soil_samples.sample_date", dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    const { soil_samples: s, ...result } = row;
    return {
      ...result,
      sample: { ...s, block_name: s?.paddocks?.name ?? null, paddocks: undefined } as SoilSample,
    };
  });
}

// ---------------------------------------------------------------------------
// Upload — creates pending records only; never fakes extraction
// ---------------------------------------------------------------------------

export const SOIL_UPLOAD_ACCEPT = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
export const SOIL_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

const ACCEPTED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function validateSoilUpload(file: { name: string; type: string; size: number }): string | null {
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!SOIL_UPLOAD_ACCEPT.includes(ext) || (file.type && !ACCEPTED_MIME.has(file.type))) {
    return "Choose a PDF, JPG, PNG or WebP laboratory report.";
  }
  if (file.size > SOIL_UPLOAD_MAX_BYTES) return "Files must be 20 MB or smaller.";
  return null;
}

function safeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "document";
}

export interface UploadSoilSampleInput {
  file: File;
  vineyardId: string;
  sampleDate: string | null;
  laboratory: string | null;
  labPaddockName: string | null;
  labSampleId: string | null;
  depthFromCm: number | null;
  depthToCm: number | null;
  notes: string | null;
  uploadedBy: string | null;
}

/**
 * Creates the soil_samples row (pending / awaiting extraction), uploads the
 * original document to the private bucket and records it in
 * soil_sample_documents. No extraction is simulated — the record waits for
 * the backend parser.
 */
export async function uploadSoilSample(input: UploadSoilSampleInput): Promise<SoilSample> {
  const invalid = validateSoilUpload(input.file);
  if (invalid) throw new Error(invalid);
  if (!input.vineyardId) throw new Error("Choose a vineyard before uploading.");

  const { data: sample, error: sampleErr } = await db
    .from("soil_samples")
    .insert({
      vineyard_id: input.vineyardId,
      mapping_type: "unmapped",
      sample_date: input.sampleDate,
      laboratory: input.laboratory,
      lab_paddock_name: input.labPaddockName,
      lab_sample_id: input.labSampleId,
      depth_from_cm: input.depthFromCm,
      depth_to_cm: input.depthToCm,
      notes: input.notes,
      status: "pending",
      extraction_status: "awaiting_extraction",
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

  const { error: docErr } = await db.from("soil_sample_documents").insert({
    sample_id: sample.id,
    storage_path: storagePath,
    original_filename: input.file.name,
    mime_type: input.file.type || null,
    byte_size: input.file.size,
    uploaded_by: input.uploadedBy,
  });
  if (docErr) throw docErr;

  return sample as SoilSample;
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
// Review edits — allow-listed writes; source_* provenance is never touched
// ---------------------------------------------------------------------------

const SAMPLE_EDITABLE_FIELDS = [
  "sample_date",
  "laboratory",
  "lab_sample_id",
  "lab_paddock_name",
  "depth_from_cm",
  "depth_to_cm",
  "notes",
  "status",
  "paddock_id",
  "mapping_type",
  "row_from",
  "row_to",
  "point_lat",
  "point_lng",
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

const RESULT_EDITABLE_FIELDS = [
  "analyte_key",
  "method",
  "unit",
  "value_numeric",
  "value_text",
  "lab_range_low",
  "lab_range_high",
  "lab_status",
  "is_verified",
] as const;

export type SoilResultPatch = Partial<Pick<SoilSampleResult, (typeof RESULT_EDITABLE_FIELDS)[number]>>;

/**
 * Builds the result update payload. Only value and mapping-style fields are
 * allowed; source_* provenance keys are stripped even if a caller passes
 * them, and every correction is marked is_user_corrected.
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
 * Classifies the change between two comparable results ONLY when the
 * catalogue supplies direction metadata (higher_is_better). Without it the
 * change is reported neutrally — never an agronomic judgement.
 */
export function classifyChange(
  previous: number,
  current: number,
  higherIsBetter: boolean | null | undefined,
): { direction: TrendDirection; delta: number } {
  const delta = current - previous;
  if (higherIsBetter === null || higherIsBetter === undefined) {
    return { direction: "not_classified", delta };
  }
  if (delta === 0) return { direction: "steady", delta };
  const improving = higherIsBetter ? delta > 0 : delta < 0;
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
  rows: Array<SoilSampleResult & { sample: SoilSample }>,
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
        .filter((r) => r.sample.paddock_id === paddockId)
        .sort((a, b) =>
          String(b.sample.sample_date ?? b.sample.created_at).localeCompare(
            String(a.sample.sample_date ?? a.sample.created_at),
          ),
        );
      return { paddockId, analyteKey, result: candidates[0] ?? null, mixedMethods };
    });
  });
}
