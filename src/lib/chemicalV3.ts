// Chemical Lookup V3 — clean-room System Admin prototype.
//
// V3 is fully separate from the Master catalogue and V1 / V2 search. This module only
// touches the chemical_v3_* tables, the V3 RPCs, the chemical-lookup-v3 Edge
// Function and the private chemical-v3-media bucket. Column names beyond the
// documented contract are read defensively — nothing is fabricated.
import { supabase } from "@/integrations/ios-supabase/client";

export const V3_MEDIA_BUCKET = "chemical-v3-media";
export const V3_EDGE_FUNCTION = "chemical-lookup-v3";
export const V3_JOBS_TABLE = "chemical_v3_discovery_jobs";
export const V3_REVISIONS_TABLE = "chemical_v3_product_revisions";
export const V3_RPC = {
  search: "search_chemical_v3_catalogue",
  start: "start_chemical_v3_discovery",
  queue: "chemical_v3_admin_review_queue",
  approve: "approve_chemical_v3_revision",
  reject: "reject_chemical_v3_revision",
} as const;

export const V3_REUSED_MESSAGE =
  "Someone has already started finding this product. We're using the same discovery instead of starting another search.";
export const V3_BACKEND_MISSING = "V3 discovery backend is not deployed yet.";
export const V3_TERMINAL_STATUSES = ["completed", "failed", "pending_review", "needs_attention", "cancelled"];

type Row = Record<string, any>;
const sb = supabase as any;

/** First non-empty value among candidate keys. */
export function pick(row: Row | null | undefined, ...keys: string[]): any {
  if (!row) return undefined;
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) return v;
  }
  return undefined;
}

export type Freshness = "fresh" | "aging" | "stale" | null;
export function freshnessOf(row: Row): Freshness {
  const f = String(pick(row, "freshness_status") ?? "").toLowerCase();
  return f === "fresh" || f === "aging" || f === "stale" ? f : null;
}
export const FRESHNESS_LABEL: Record<"fresh" | "aging" | "stale", string> = {
  fresh: "Fresh",
  aging: "Aging",
  stale: "Stale",
};
export function freshnessNote(f: Freshness): string | null {
  if (f === "aging") return "Refresh recommended";
  if (f === "stale") return "Checking for latest manufacturer information recommended";
  return null;
}

/** Approved results only — a pending/candidate row is never shown as approved. */
export function isApprovedResult(row: Row): boolean {
  const s = String(pick(row, "review_status", "status", "revision_status") ?? "approved").toLowerCase();
  return s === "approved";
}

export async function searchV3(query: string, countryCode: string | null): Promise<Row[]> {
  const { data, error } = await sb.rpc(V3_RPC.search, {
    p_query: query,
    p_country_code: countryCode,
    p_limit: 20,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : data ? [data] : []) as Row[];
}

export interface StartResult {
  job_id: string;
  reused: boolean;
  status: string | null;
  backendMissing: boolean;
}

/** Ask the separate V3 backend to start. Missing backend never fails the job. */
export async function invokeV3Backend(jobId: string): Promise<{ ok: boolean; missing: boolean }> {
  try {
    const { error } = await sb.functions.invoke(V3_EDGE_FUNCTION, { body: { action: "start", job_id: jobId } });
    if (!error) return { ok: true, missing: false };
    const status = (error as any)?.context?.status;
    const missing =
      status === 404 || status === 503 || /not found|failed to send|fetch/i.test(String(error.message ?? ""));
    return { ok: false, missing };
  } catch {
    return { ok: false, missing: true };
  }
}

export async function startV3Discovery(args: {
  query: string | null;
  countryCode: string | null;
  inputKind: "text" | "photo";
  photoPath: string | null;
}): Promise<StartResult> {
  const { data, error } = await sb.rpc(V3_RPC.start, {
    p_query: args.query,
    p_country_code: args.countryCode,
    p_input_kind: args.inputKind,
    p_photo_path: args.photoPath,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Row | null;
  const jobId = pick(row, "job_id", "id");
  if (!jobId) throw new Error("Discovery did not return a job.");
  const reused = Boolean(row?.reused);
  let backendMissing = false;
  if (!reused) backendMissing = (await invokeV3Backend(String(jobId))).missing;
  return { job_id: String(jobId), reused, status: pick(row, "status") ?? null, backendMissing };
}

/** Re-run an existing discovery job. Never calls start_chemical_v3_discovery; the backend creates the new revision. */
export async function retryChemicalDiscovery(jobId: string): Promise<void> {
  const { error } = await sb.functions.invoke(V3_EDGE_FUNCTION, { body: { action: "retry", job_id: jobId } });
  if (error) throw error;
}

export const RESEARCH_FAILED = "We couldn't finish re-searching this product. The existing review record has not been changed.";
export const RESEARCH_DONE = "Re-search complete. Review the updated information.";
export const RESEARCH_STATUSES = ["pending_review", "needs_attention"];
export const canReSearch = (isAdmin: boolean, status: string, jobId: string | null | undefined) =>
  isAdmin && !!jobId && RESEARCH_STATUSES.includes(String(status).toLowerCase());
/** Any reason the record looks incomplete — makes the button prominent. */
export function needsReSearch(r: Row | null | undefined): boolean {
  if (!r) return false;
  const bad = (v: any) => /unresolved|missing|attention|review|conflict|none/i.test(String(v ?? ""));
  const list = (v: any) => (Array.isArray(v) ? v : []);
  return list(pick(r, "unresolved_fields")).length > 0 || bad(pick(r, "vineyard_rate_status")) ||
    bad(pick(r, "manufacturer_label_status")) || !pick(r, "manufacturer_label_url") ||
    !pick(r, "front_label_image_path") || bad(pick(r, "resistance_classification_state")) || bad(pick(r, "source_status"));
}

export async function fetchV3Job(jobId: string): Promise<Row | null> {
  const { data, error } = await sb.from(V3_JOBS_TABLE).select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  return (data as Row) ?? null;
}

export async function fetchV3Revision(revisionId: string): Promise<Row | null> {
  const { data, error } = await sb.from(V3_REVISIONS_TABLE).select("*").eq("id", revisionId).maybeSingle();
  if (error) throw error;
  return (data as Row) ?? null;
}

export async function v3ReviewQueue(): Promise<Row[]> {
  const { data, error } = await sb.rpc(V3_RPC.queue);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  // Optional "Added by" details (sql/260). Missing service → rows unchanged.
  try {
    const { data: who, error: werr } = await sb.rpc("chemical_v3_admin_review_queue_requesters");
    if (werr || !Array.isArray(who)) return rows;
    const byRev = new Map<string, Row>(who.map((w: Row) => [String(w.revision_id), w]));
    return rows.map((r) => {
      const w = byRev.get(String(r.revision_id ?? r.id));
      if (!w) return r;
      return {
        ...r,
        requested_by_name: r.requested_by_name ?? w.requested_by_name ?? null,
        requested_by_email: r.requested_by_email ?? w.requested_by_email ?? null,
        vineyard_name: r.vineyard_name ?? w.vineyard_name ?? null,
      };
    });
  } catch {
    return rows;
  }
}

export async function approveV3(revisionId: string, note: string | null): Promise<void> {
  const { error } = await sb.rpc(V3_RPC.approve, { p_revision_id: revisionId, p_note: note || null });
  if (error) throw error;
}

export async function rejectV3(revisionId: string, note: string): Promise<void> {
  if (!note.trim()) throw new Error("A note is required to reject.");
  const { error } = await sb.rpc(V3_RPC.reject, { p_revision_id: revisionId, p_note: note.trim() });
  if (error) throw error;
}

/** Signed URL from the private bucket — never a hand-built public URL. */
export async function signedV3MediaUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await sb.storage.from(V3_MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function photoInputPath(userId: string, fileName: string, unique: string = crypto.randomUUID()): string {
  const ext = (fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `search-inputs/${userId}/${unique}.${ext}`;
}

export async function uploadV3SearchPhoto(userId: string, file: File): Promise<string> {
  const path = photoInputPath(userId, file.name);
  const { error } = await sb.storage.from(V3_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Readable stage text from the backend's own value. */
export function humaniseStage(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const t = s.replace(/[_-]+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function asList(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v as object);
  return [];
}

export function labelOf(x: any): string {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  const name = pick(x, "name", "active_ingredient", "ingredient", "text", "label", "field");
  const conc = pick(x, "concentration_text", "concentration");
  const unit = pick(x, "concentration_unit", "unit");
  if (name) return [name, conc != null ? `${conc}${unit ? ` ${unit}` : ""}` : null].filter(Boolean).join(" — ");
  return JSON.stringify(x);
}

/** Split extracted rates by basis; never converts between them. */
export function splitRates(rates: unknown): { perHa: any[]; per100L: any[]; other: any[] } {
  const perHa: any[] = [];
  const per100L: any[] = [];
  const other: any[] = [];
  if (rates && !Array.isArray(rates) && typeof rates === "object") {
    const r = rates as Row;
    return {
      perHa: asList(pick(r, "per_hectare", "per_ha")),
      per100L: asList(pick(r, "per_100l", "per_100_litres", "per_100L")),
      other: [],
    };
  }
  for (const x of asList(rates)) {
    const b = String(pick(x, "basis", "rate_basis", "unit_basis") ?? "").toLowerCase();
    if (/100\s*l|per_100/.test(b)) per100L.push(x);
    else if (/ha|hectare/.test(b)) perHa.push(x);
    else other.push(x);
  }
  return { perHa, per100L, other };
}

/** Human-readable text from a V3 value — never JSON.stringify. */
export function textOf(x: unknown): string {
  if (x == null) return "";
  if (typeof x === "string") return x.trim();
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (Array.isArray(x)) return x.map(textOf).filter(Boolean).join("; ");
  if (typeof x === "object") {
    const v = pick(x as Row, "text", "raw_text", "statement", "message", "label", "name", "value", "description", "field");
    return v === undefined ? "" : textOf(v);
  }
  return "";
}

/** Plain list of strings from a value that may be a string, array or object list. */
export function textList(x: unknown): string[] {
  if (x == null) return [];
  if (typeof x === "string") return x.trim() ? [x.trim()] : [];
  return asList(x).map(textOf).filter(Boolean);
}

/** Rate headline: min–max unit, else value unit, else raw_text. Never converts. */
export function formatRateOption(o: Row): string {
  const unit = textOf(pick(o, "unit", "rate_unit"));
  const min = pick(o, "min_value", "rate_min");
  const max = pick(o, "max_value", "rate_max");
  const value = pick(o, "value", "rate_value");
  const u = unit ? ` ${unit}` : "";
  if (min != null && max != null) return String(min) === String(max) ? `${min}${u}` : `${min}–${max}${u}`;
  if (value != null) return `${value}${u}`;
  return textOf(pick(o, "raw_text", "rate_text", "text")) || "Rate not stated";
}

// ---- Admin rate editing (System Admin, pending / needs-attention revisions) ----
export const V3_RATE_RPC = {
  save: "chemical_v3_admin_save_rate_option",
  remove: "chemical_v3_admin_delete_rate_option",
} as const;
export const V3_EDITABLE_STATUSES = ["pending_review", "needs_attention"];
export type V3RateBasis = "per_hectare" | "per_100_litres";
export interface V3RateDraft {
  optionId: string | null;
  basis: V3RateBasis;
  rateType: "single" | "range";
  value: string;
  min: string;
  max: string;
  unit: string;
  targets: string;
  method: string;
  condition: string;
  notes: string;
}

export function isV3RevisionEditable(status: unknown): boolean {
  return V3_EDITABLE_STATUSES.includes(String(status ?? "").toLowerCase());
}

export function basisOfOption(o: Row, fallback: V3RateBasis): V3RateBasis {
  const b = String(pick(o, "basis", "rate_basis", "unit_basis") ?? "").toLowerCase();
  if (/100\s*l|per_100/.test(b)) return "per_100_litres";
  if (/ha|hectare/.test(b)) return "per_hectare";
  return fallback;
}

export function emptyRateDraft(basis: V3RateBasis): V3RateDraft {
  return { optionId: null, basis, rateType: "single", value: "", min: "", max: "", unit: "", targets: "", method: "", condition: "", notes: "" };
}

export function draftFromOption(o: Row, fallback: V3RateBasis): V3RateDraft {
  const min = pick(o, "min_value", "rate_min");
  const max = pick(o, "max_value", "rate_max");
  const range = min != null || max != null;
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    optionId: s(pick(o, "id", "option_id")) || null,
    basis: basisOfOption(o, fallback),
    rateType: range ? "range" : "single",
    value: s(pick(o, "value", "rate_value")),
    min: s(min),
    max: s(max),
    unit: textOf(pick(o, "unit", "rate_unit")),
    targets: textList(pick(o, "targets", "target")).join("\n"),
    method: textOf(pick(o, "methods", "method")),
    condition: textOf(pick(o, "condition", "conditions")),
    notes: textOf(pick(o, "raw_text", "rate_text", "notes")),
  };
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** Validates and builds RPC args exactly as entered — never calculates or converts. */
export function buildRateOptionArgs(revisionId: string, d: V3RateDraft): { args: Row } | { error: string } {
  if (!d.unit.trim()) return { error: "Unit is required." };
  let value: number | null = null, min: number | null = null, max: number | null = null;
  if (d.rateType === "single") {
    value = num(d.value);
    if (value == null || Number.isNaN(value)) return { error: "Enter a numeric rate." };
  } else {
    min = num(d.min); max = num(d.max);
    if (min == null || max == null || Number.isNaN(min) || Number.isNaN(max)) return { error: "Enter numeric minimum and maximum." };
    if (min > max) return { error: "Minimum cannot be greater than maximum." };
  }
  const targets = d.targets.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  return {
    args: {
      p_revision_id: revisionId,
      p_option_id: d.optionId,
      p_basis: d.basis,
      p_unit: d.unit.trim(),
      p_value: value,
      p_min_value: min,
      p_max_value: max,
      p_targets: targets,
      p_application_method: d.method.trim() || null,
      p_condition: d.condition.trim() || null,
      p_raw_text: d.notes.trim() || null,
      p_needs_review: false,
    },
  };
}

export async function saveV3RateOption(revisionId: string, d: V3RateDraft): Promise<void> {
  const built = buildRateOptionArgs(revisionId, d);
  if ("error" in built) throw new Error(built.error);
  const { error } = await sb.rpc(V3_RATE_RPC.save, built.args);
  if (error) throw error;
}

export async function deleteV3RateOption(revisionId: string, optionId: string): Promise<void> {
  const { error } = await sb.rpc(V3_RATE_RPC.remove, { p_revision_id: revisionId, p_option_id: optionId });
  if (error) throw error;
}
