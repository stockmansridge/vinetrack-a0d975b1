// Client wrappers for the crop-health manifest, refresh-status and
// per-asset stable asset endpoint. All calls go through the VineTrack
// iOS session (system-admin gated), matching the pattern used elsewhere in
// SatelliteMappingPage.
import { supabase } from "@/integrations/supabase/client";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import type { SatelliteIndexType } from "@/types/satellite";

async function invoke<T = any>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await iosSupabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in to VineTrack");
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return data as T;
}

// Fetch bytes from the stable authenticated asset endpoint. Supports
// If-None-Match / 304 so cached blobs are reused without re-download.
export interface AssetFetchResult {
  status: 200 | 304;
  blob: Blob | null;   // present on 200, null on 304
  etag: string | null;
  contentType: string | null;
}

export async function fetchAssetBytes(
  assetId: string,
  ifNoneMatch?: string | null,
): Promise<AssetFetchResult> {
  const { data: { session } } = await iosSupabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in to VineTrack");
  const base = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const anon = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base) throw new Error("Supabase URL not configured");
  const url = `${base}/functions/v1/satellite-get-asset?asset_id=${encodeURIComponent(assetId)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  };
  if (anon) headers.apikey = anon;
  if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
  const res = await fetch(url, { method: "GET", headers });
  const etag = res.headers.get("ETag");
  if (res.status === 304) return { status: 304, blob: null, etag, contentType: null };
  if (!res.ok) throw new Error(`asset fetch failed (${res.status})`);
  const blob = await res.blob();
  return { status: 200, blob, etag, contentType: res.headers.get("Content-Type") };
}


export type ManifestPackageStatus =
  | "complete"
  | "partial"
  | "display_available"
  | "upgrade_required"
  | "no_imagery";

export interface ManifestPaddock {
  vineyard_id: string;
  paddock_id: string;
  latest_display_scene_id: string | null;
  latest_display_acquired_at: string | null;
  latest_complete_scene_id: string | null;
  latest_complete_acquired_at: string | null;
  latest_processing_version: string | null;
  available_layer_types: SatelliteIndexType[];
  available_analytical_types: SatelliteIndexType[];
  missing_display_count: number;
  missing_analytical_count: number;
  missing_summary_count: number;
  package_status: ManifestPackageStatus;
  last_provider_check_at: string | null;
  last_successful_refresh_at: string | null;
  last_asset_repair_at: string | null;
  updated_at: string;
}

export interface ManifestResponse {
  manifest_version: string;
  vineyard_id: string;
  updated_at: string | null;
  paddocks: ManifestPaddock[];
  // v2 additions — server-side date-coverage index.
  date_coverage?: ManifestDateEntry[];
  recommended_default_date?: string | null;
  newest_saved_date?: string | null;
  oldest_saved_date?: string | null;
  total_saved_dates?: number;
  provider_freshness?: ProviderFreshness;
  stats?: { scene_rows_scanned: number; asset_rows_scanned: number };
}

export interface ManifestLayerAsset {
  asset_id: string;
  index_type: SatelliteIndexType;
  asset_type: "DISPLAY_RASTER" | "ANALYTICAL_RASTER";
  processing_version: string | null;
  storage_path: string | null;
  mime_type: string | null;
  bounds: { north: number; south: number; east: number; west: number } | null;
  raster_width: number | null;
  raster_height: number | null;
  native_resolution_m: number | null;
  display_resolution_m: number | null;
  data_type: string | null;
  scale_factor: number | null;
  no_data_sentinel: number | null;
  row_orientation: string | null;
  colour_scale: unknown;
  etag: string;
}

export interface ManifestLayerSummary {
  mean_value: number | null;
  median_value: number | null;
  minimum_value: number | null;
  maximum_value: number | null;
  standard_deviation: number | null;
  percentile_10: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  percentile_90: number | null;
}

export interface ManifestLayerBundle {
  index_type: SatelliteIndexType;
  display: ManifestLayerAsset | null;
  analytical: ManifestLayerAsset | null;
  summary: ManifestLayerSummary | null;
}

export interface ManifestDatePaddock {
  paddock_id: string;
  scene_id: string;
  provider_scene_id: string | null;
  provider: string;
  acquired_at: string;
  acquisition_date: string;
  processing_version: string | null;
  paddock_valid_coverage_pct: number | null;
  paddock_cloud_cover_pct: number | null;
  scene_cloud_cover_pct: number | null;
  available_display_layers: SatelliteIndexType[];
  available_analytical_layers: SatelliteIndexType[];
  package_version_mismatch: boolean;
  layers: ManifestLayerBundle[];
}

export type ManifestDateMissingReason =
  | "no_scene_for_date"
  | "scene_not_complete"
  | "package_version_mismatch";

export interface ManifestLayerCoverage {
  available: number;
  total: number;
  percent: number;
  available_paddock_ids: string[];
  missing_paddock_ids: string[];
}

export interface ManifestDateEntry {
  acquisition_date: string; // YYYY-MM-DD
  active_paddock_count: number;
  available_paddock_count: number;
  scene_coverage_count?: number;
  coverage_percent: number;
  layer_coverage?: Partial<Record<SatelliteIndexType, ManifestLayerCoverage>>;
  available_paddock_ids: string[];
  missing_paddock_ids: string[];
  missing_paddocks: { paddock_id: string; reason: ManifestDateMissingReason }[];
  paddocks: ManifestDatePaddock[];
  updated_at: string;
}


export type ProviderCheckStatus =
  | "never_checked" | "checked_recently" | "check_due" | "checking" | "failed";

export interface ProviderFreshness {
  last_provider_check_at: string | null;
  last_provider_check_status: string | null;
  next_recommended_provider_check_at: string | null;
  provider_check_interval_days: number;
  provider_check_status: ProviderCheckStatus;
  active_job_id: string | null;
}

export type RefreshJobStatus =
  | "queued" | "running" | "complete" | "partial" | "failed" | "cancelled" | "expired";

export type RefreshJobType = "provider_refresh" | "asset_repair" | "historical_backfill";

export interface RefreshJob {
  id: string;
  vineyard_id: string;
  job_type: RefreshJobType;
  requested_by: string | null;
  status: RefreshJobStatus;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  expiry_at: string | null;
  current_paddock_id: string | null;
  total_paddocks: number;
  completed_paddocks: number;
  failed_paddocks: number;
  error: string | null;
}

export interface RefreshStatusResponse {
  active_job: RefreshJob | null;
  last_job: RefreshJob | null;
}

export interface AssetUrlResponse {
  asset_id: string;
  signed_url: string;
  expires_in: number;
  etag: string;
  last_modified: string | null;
  processing_version: string | null;
  asset_type: string | null;
  index_type: SatelliteIndexType | null;
  content_type: string | null;
}

export function fetchManifest(
  vineyardId: string,
  activePaddockIds?: string[],
): Promise<ManifestResponse> {
  return invoke<ManifestResponse>("satellite-get-manifest", {
    vineyard_id: vineyardId,
    active_paddock_ids: activePaddockIds,
  });
}

export function fetchRefreshStatus(
  vineyardId: string,
  jobType?: RefreshJobType,
): Promise<RefreshStatusResponse> {
  return invoke<RefreshStatusResponse>("satellite-refresh-status", {
    vineyard_id: vineyardId,
    job_type: jobType,
  });
}

export function fetchAssetUrl(assetId: string): Promise<AssetUrlResponse> {
  return invoke<AssetUrlResponse>("satellite-asset-url", { asset_id: assetId });
}

// ---- Refresh job lock (claim / heartbeat / finish) ----

export class RefreshInProgressError extends Error {
  activeJob: RefreshJob | null;
  constructor(activeJob: RefreshJob | null) {
    super("Refresh already in progress");
    this.name = "RefreshInProgressError";
    this.activeJob = activeJob;
  }
}

export async function claimRefreshJob(
  vineyardId: string,
  jobType: RefreshJobType,
  totalPaddocks: number,
): Promise<RefreshJob> {
  try {
    const res = await invoke<{ job: RefreshJob }>("satellite-refresh-job", {
      action: "claim",
      vineyard_id: vineyardId,
      job_type: jobType,
      total_paddocks: totalPaddocks,
    });
    return res.job;
  } catch (e: any) {
    const details = e?.details ?? e?.context?.details ?? null;
    if (details?.error === "refresh_in_progress") {
      throw new RefreshInProgressError(details.active_job ?? null);
    }
    throw e;
  }
}

export function heartbeatRefreshJob(
  jobId: string,
  fields: { currentPaddockId?: string | null; completedPaddocks?: number; failedPaddocks?: number } = {},
): Promise<void> {
  return invoke<void>("satellite-refresh-job", {
    action: "heartbeat",
    job_id: jobId,
    current_paddock_id: fields.currentPaddockId ?? null,
    completed_paddocks: fields.completedPaddocks,
    failed_paddocks: fields.failedPaddocks,
  }).then(() => undefined);
}

export function finishRefreshJob(
  jobId: string,
  status: "complete" | "partial" | "failed" | "cancelled",
  errorMessage?: string,
): Promise<void> {
  return invoke<void>("satellite-refresh-job", {
    action: "finish",
    job_id: jobId,
    status,
    error: errorMessage,
  }).then(() => undefined);
}
