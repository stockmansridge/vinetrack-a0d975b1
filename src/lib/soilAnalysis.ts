// Soil Analysis — Stage 1 System Admin preview (Portal only).
//
// Data authority is the shared VineTrack backend. The live tables are
// System Admin-only under RLS; this module is the single place that names
// their columns so any schema adjustment by the database owner lands in
// one file.
//
// Safety rules enforced here:
// - source_value_numeric / source_value_text and the document raw_extraction
//   are immutable extraction provenance; user corrections only ever write
//   value_numeric / value_text / analyte_key and set is_user_corrected.
// - method / unit / lab range / lab status have no duplicate source copies
//   in the schema, so the Portal treats them as read-only in Stage 1.
// - The uploaded document is evidence and is never replaced or deleted.
// - No agronomic recommendations: status language comes only from the
//   laboratory's own range/status fields and catalogue desired_direction.

import { supabase } from "@/integrations/ios-supabase/client";
import { SOIL_ANALYSIS_FLAG } from "@/lib/navigationConfig";

const db = supabase as any;

export { SOIL_ANALYSIS_FLAG };
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

export type SoilSampleScope = "unmapped" | "whole_block" | "row_range" | "point";

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
    db
      .from("soil_sample_results")
      .select("*")
      .eq("sample_id", id)
      .order("sort_order", { nullsFirst: false })
      .order("created_at"),
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

/** Results for one block + analyte across time, oldest first, with sample context. */
export async function listBlockAnalyteResults(
  paddockId: string,
  analyteKey: string,
): Promise<Array<SoilSampleResult & { sample: SoilSample }>> {
  const { data, error } = await db
    .from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .eq("analyte_key", analyteKey)
    .eq("soil_samples.paddock_id", paddockId)
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

/** Results for a set of blocks within a sampled-at period (Compare tab). */
export async function listBlockPeriodResults(
  paddockIds: string[],
  dateFrom: string | null,
  dateTo: string | null,
): Promise<Array<SoilSampleResult & { sample: SoilSample }>> {
  if (paddockIds.length === 0) return [];
  let q = db
    .from("soil_sample_results")
    .select("*, soil_samples!inner(*, paddocks(name))")
    .in("soil_samples.paddock_id", paddockIds)
    .is("soil_samples.deleted_at", null);
  if (dateFrom) q = q.gte("soil_samples.sampled_at", dateFrom);
  if (dateTo) q = q.lte("soil_samples.sampled_at", dateTo);
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
function parseJsonTolerant(text: string): unknown | null {
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
      const nested = JSON.parse(obj);
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
      const body = JSON.parse(obj);
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

  // Invoke the live parser. It verifies the JWT and re-checks System Admin +
  // the preview flag server-side, then moves records to review_required or
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
export async function confirmSoilSample(id: string, userId: string): Promise<void> {
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
// Stage 1: the schema keeps no duplicate source copies for them, so a Portal
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
          String(b.sample.sampled_at ?? b.sample.created_at).localeCompare(
            String(a.sample.sampled_at ?? a.sample.created_at),
          ),
        );
      return { paddockId, analyteKey, result: candidates[0] ?? null, mixedMethods };
    });
  });
}
