// Scout Reports — read-only Portal access to mobile-synced scouting data.
//
// Contract (shared with iOS/Android, owned by Rork):
//   scout_visits              — one row per scouting visit (vintage_year,
//                               scout_date, status, visit_summary,
//                               weather_snapshot, scout name snapshot).
//   scout_block_assessments   — one row per STOP; the assessment id is the
//                               identity. Repeated stops in the same block are
//                               never flattened; stop_context (jsonb) carries
//                               ordering/context.
//   scout_observations        — recorded values per assessment; value_label is
//                               a historical snapshot and is shown verbatim.
//   scout_observation_photos  — photo metadata; bytes live in the private
//                               `scout-photos` Storage bucket.
//
// The Portal NEVER writes to these tables. Scouting capture, completion and
// deletion stay mobile-only.
//
// Backend gate: table policies use public.can_use_vineyard_insights(), which
// currently requires System Admin + membership. Until the approved RLS change
// lands, ordinary members get a permission error — surfaced honestly as
// "access restricted", never as an empty list.
import { supabase } from "@/integrations/ios-supabase/client";
import type { VintageScope } from "@/lib/vintageScope";
import { isWithinVintage } from "@/lib/vintageScope";

export const SCOUT_PHOTOS_BUCKET = "scout-photos";
const PHOTO_SIGN_TTL_SECONDS = 60 * 60;

export interface ScoutVisit {
  id: string;
  vineyard_id: string;
  vintage_year: number | null;
  scout_date: string;
  status: string;
  visit_summary: string | null;
  weather_snapshot: Record<string, unknown> | null;
  scout_user_id: string | null;
  scout_name_snapshot: string | null;
  deleted_at: string | null;
}

export interface ScoutAssessment {
  id: string;
  scout_visit_id: string;
  vineyard_id: string;
  paddock_id: string | null;
  status: string;
  stop_context: Record<string, unknown> | null;
  deleted_at: string | null;
}

export interface ScoutObservation {
  id: string;
  assessment_id: string;
  vineyard_id: string;
  item_kind: string;
  value_code: string | null;
  value_label: string | null;
  notes: string | null;
  linked_pin_id: string | null;
  linked_growth_record_id: string | null;
  latitude: number | null;
  longitude: number | null;
  horizontal_accuracy: number | null;
  location_captured_at: string | null;
  location_status: string | null;
  deleted_at: string | null;
}

export interface ScoutObservationPhoto {
  id: string;
  observation_id: string;
  vineyard_id: string;
  storage_path: string;
  captured_at: string | null;
  latitude: number | null;
  longitude: number | null;
  horizontal_accuracy: number | null;
  location_status: string | null;
  deleted_at: string | null;
}

export interface ScoutVisitDetail {
  visit: ScoutVisit;
  /** Stops in recorded order (stop_context ordering, then created order). */
  assessments: ScoutAssessment[];
  observationsByAssessment: Map<string, ScoutObservation[]>;
  photosByObservation: Map<string, ScoutObservationPhoto[]>;
}

/** True when the backend refused the read (RLS / grant), not "no rows". */
export function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  if (e.code === "42501" || e.code === "PGRST301") return true;
  if (e.status === 401 || e.status === 403) return true;
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("permission denied") ||
    msg.includes("row-level security") ||
    msg.includes("not authorised") ||
    msg.includes("not authorized")
  );
}

/** Stop ordering key from stop_context; falls back to a large stable value. */
export function stopOrder(a: ScoutAssessment): number {
  const ctx = a.stop_context ?? {};
  for (const key of ["stop_index", "stopIndex", "stop_number", "stopNumber", "order"]) {
    const v = (ctx as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Stop label from stop_context, e.g. "Stop 2"; null when nothing recorded. */
export function stopLabel(a: ScoutAssessment, fallbackIndex: number): string {
  const n = stopOrder(a);
  if (n !== Number.MAX_SAFE_INTEGER) return `Stop ${n}`;
  return `Stop ${fallbackIndex + 1}`;
}

/** Stop capture time from stop_context, when mobile recorded one. */
export function stopTime(a: ScoutAssessment): string | null {
  const ctx = (a.stop_context ?? {}) as Record<string, unknown>;
  for (const key of ["stopped_at", "stoppedAt", "captured_at", "capturedAt", "time"]) {
    const v = ctx[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/** Per-stop weather snapshot from stop_context, when mobile recorded one. */
export function stopWeather(a: ScoutAssessment): Record<string, unknown> | null {
  const ctx = (a.stop_context ?? {}) as Record<string, unknown>;
  const w = ctx["weather"] ?? ctx["weather_snapshot"] ?? ctx["weatherSnapshot"];
  return w && typeof w === "object" && !Array.isArray(w)
    ? (w as Record<string, unknown>)
    : null;
}

export async function fetchScoutVisits(vineyardId: string): Promise<ScoutVisit[]> {
  const { data, error } = await supabase
    .from("scout_visits" as any)
    .select(
      "id, vineyard_id, vintage_year, scout_date, status, visit_summary, weather_snapshot, scout_user_id, scout_name_snapshot, deleted_at",
    )
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .order("scout_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ScoutVisit[];
}

export async function fetchScoutVisitDetail(
  vineyardId: string,
  visitId: string,
): Promise<ScoutVisitDetail | null> {
  const { data: visit, error: vErr } = await supabase
    .from("scout_visits" as any)
    .select(
      "id, vineyard_id, vintage_year, scout_date, status, visit_summary, weather_snapshot, scout_user_id, scout_name_snapshot, deleted_at",
    )
    .eq("id", visitId)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null)
    .maybeSingle();
  if (vErr) throw vErr;
  if (!visit) return null;

  const { data: assessments, error: aErr } = await supabase
    .from("scout_block_assessments" as any)
    .select("id, scout_visit_id, vineyard_id, paddock_id, status, stop_context, deleted_at")
    .eq("scout_visit_id", visitId)
    .eq("vineyard_id", vineyardId)
    .is("deleted_at", null);
  if (aErr) throw aErr;

  const orderedAssessments = ((assessments ?? []) as unknown as ScoutAssessment[])
    .slice()
    .sort((a, b) => stopOrder(a) - stopOrder(b) || a.id.localeCompare(b.id));

  const assessmentIds = orderedAssessments.map((a) => a.id);
  let observations: ScoutObservation[] = [];
  if (assessmentIds.length) {
    const { data: obs, error: oErr } = await supabase
      .from("scout_observations" as any)
      .select(
        "id, assessment_id, vineyard_id, item_kind, value_code, value_label, notes, linked_pin_id, linked_growth_record_id, latitude, longitude, horizontal_accuracy, location_captured_at, location_status, deleted_at",
      )
      .in("assessment_id", assessmentIds)
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null);
    if (oErr) throw oErr;
    observations = (obs ?? []) as unknown as ScoutObservation[];
  }

  const observationIds = observations.map((o) => o.id);
  let photos: ScoutObservationPhoto[] = [];
  if (observationIds.length) {
    const { data: ph, error: pErr } = await supabase
      .from("scout_observation_photos" as any)
      .select(
        "id, observation_id, vineyard_id, storage_path, captured_at, latitude, longitude, horizontal_accuracy, location_status, deleted_at",
      )
      .in("observation_id", observationIds)
      .eq("vineyard_id", vineyardId)
      .is("deleted_at", null);
    if (pErr) throw pErr;
    photos = (ph ?? []) as unknown as ScoutObservationPhoto[];
  }

  const observationsByAssessment = new Map<string, ScoutObservation[]>();
  for (const o of observations) {
    const list = observationsByAssessment.get(o.assessment_id) ?? [];
    list.push(o);
    observationsByAssessment.set(o.assessment_id, list);
  }
  const photosByObservation = new Map<string, ScoutObservationPhoto[]>();
  for (const p of photos) {
    const list = photosByObservation.get(p.observation_id) ?? [];
    list.push(p);
    photosByObservation.set(p.observation_id, list);
  }

  return {
    visit: visit as unknown as ScoutVisit,
    assessments: orderedAssessments,
    observationsByAssessment,
    photosByObservation,
  };
}

/**
 * Which linked growth-stage record ids still exist as canonical records.
 * A linked id that no longer resolves must be presented as a stored
 * snapshot, never as a verified canonical record.
 */
export async function fetchCanonicalGrowthRecordIds(ids: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.filter((v) => typeof v === "string" && v)));
  if (!unique.length) return new Set();
  const { data, error } = await supabase
    .from("growth_stage_records" as any)
    .select("id")
    .in("id", unique)
    .is("deleted_at", null);
  if (error) {
    // Verification is best-effort: on failure treat nothing as verified.
    if (isPermissionError(error)) return new Set();
    throw error;
  }
  return new Set(((data ?? []) as any[]).map((r) => String(r.id)));
}

/** Short-lived signed URL for a private scout photo; null when unavailable. */
export async function signScoutPhotoUrl(storagePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(SCOUT_PHOTOS_BUCKET)
      .createSignedUrl(storagePath, PHOTO_SIGN_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export interface ScoutVisitFilters {
  /** null = All vintages. */
  scope: VintageScope | null;
  search: string;
  /** "all" | "draft" | "completed" (other statuses pass through verbatim). */
  status: string;
  /** "all" or a paddock id the visit must have a stop in. */
  blockId: string;
}

export const ALL_STATUSES = "all";
export const ALL_BLOCKS = "all";

/**
 * Pure list filtering. Vintage scoping uses the visit's scout_date against
 * the canonical season window; visits whose stored vintage_year disagrees
 * with the window still follow the date (the date is authoritative).
 */
export function filterScoutVisits(
  visits: ScoutVisit[],
  filters: ScoutVisitFilters,
  assessmentsByVisit?: Map<string, ScoutAssessment[]>,
): ScoutVisit[] {
  const q = filters.search.trim().toLowerCase();
  return visits.filter((v) => {
    if (!isWithinVintage(v.scout_date, filters.scope)) return false;
    if (filters.status !== ALL_STATUSES && v.status !== filters.status) return false;
    if (filters.blockId !== ALL_BLOCKS) {
      const stops = assessmentsByVisit?.get(v.id) ?? [];
      if (!stops.some((a) => a.paddock_id === filters.blockId)) return false;
    }
    if (!q) return true;
    const hay = [v.scout_name_snapshot, v.visit_summary, v.status, v.scout_date, v.vintage_year]
      .filter((x) => x != null)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Distinct statuses present in the data, for the filter options. */
export function visitStatuses(visits: ScoutVisit[]): string[] {
  return Array.from(new Set(visits.map((v) => v.status).filter(Boolean))).sort();
}

/** Distinct block ids a set of visits has stops in (identity = assessment). */
export function visitedBlockIds(assessments: ScoutAssessment[]): string[] {
  return Array.from(
    new Set(assessments.map((a) => a.paddock_id).filter((v): v is string => !!v)),
  );
}

/** Measured GPS coordinate for an observation/photo; null when not recorded. */
export function measuredCoord(row: {
  latitude: number | null;
  longitude: number | null;
}): { lat: number; lng: number } | null {
  if (
    typeof row.latitude === "number" &&
    typeof row.longitude === "number" &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude)
  ) {
    return { lat: row.latitude, lng: row.longitude };
  }
  return null;
}

/** Human label for an observation's location evidence. */
export function locationLabel(row: {
  latitude: number | null;
  longitude: number | null;
  horizontal_accuracy: number | null;
  location_status: string | null;
}): string {
  const c = measuredCoord(row);
  if (!c) return "Location unavailable";
  const acc =
    typeof row.horizontal_accuracy === "number" && Number.isFinite(row.horizontal_accuracy)
      ? ` (±${Math.round(row.horizontal_accuracy)} m)`
      : "";
  return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}${acc}`;
}
