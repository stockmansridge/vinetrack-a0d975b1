// Client wrappers for the crop-health manifest, refresh-status and
// per-asset signed-URL edge functions. All calls go through the VineTrack
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

export function fetchManifest(vineyardId: string): Promise<ManifestResponse> {
  return invoke<ManifestResponse>("satellite-get-manifest", { vineyard_id: vineyardId });
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
