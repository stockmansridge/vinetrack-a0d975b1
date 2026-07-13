// Completeness inspection for satellite imagery.
//
// A scene package for one paddock is considered complete only when — for the
// current processing version — every required index has its display asset,
// and every numeric index also has its analytical asset AND a summary row.
//
// The refresh flow uses this report to skip complete work and only target
// missing items. Nothing here talks to the network.

import type { SatelliteIndexType } from "@/types/satellite";

// Must match `PROCESSING_VERSION` in supabase/functions/_shared/satellite-cdse.ts.
export const CURRENT_PROCESSING_VERSION = "sentinel2-v3-eleven-layers";

// Consider imagery current when the newest completed scene is within this many
// days of "now". Older-only imagery is treated as a missing latest scene.
export const LATEST_WINDOW_DAYS = 3;

export const REQUIRED_INDICES: SatelliteIndexType[] = [
  "TRUE_COLOUR",
  "NDVI",
  "EVI",
  "GNDVI",
  "MSAVI",
  "NDRE",
  "RECI",
  "GCI",
  "RENDVI",
  "NDMI",
  "PSRI",
];

// TRUE_COLOUR is a visual reference only — no analytical raster or summary.
export function requiresAnalytical(index: SatelliteIndexType): boolean {
  return index !== "TRUE_COLOUR";
}
export function requiresSummary(index: SatelliteIndexType): boolean {
  return index !== "TRUE_COLOUR";
}

export type AssetKind = "DISPLAY_RASTER" | "ANALYTICAL_RASTER";

export interface CompletenessScene {
  id: string;
  paddock_id: string;
  provider_scene_id: string;
  acquired_at: string;
  scene_cloud_cover_pct: number | null;
  processing_status: string;
}
export interface CompletenessAsset {
  satellite_scene_id: string;
  index_type: SatelliteIndexType;
  asset_type?: AssetKind | string | null;
  storage_path: string;
  processing_version?: string | null;
}
export interface CompletenessSummary {
  satellite_scene_id: string;
  index_type: SatelliteIndexType;
}

export interface CompletenessPaddockInput {
  id: string;
  name: string;
}

export type PaddockCompletenessState =
  | "complete"
  | "missing_latest_scene"
  | "incomplete_scene"
  | "old_processing_version";

export interface PaddockCompleteness {
  paddockId: string;
  paddockName: string;
  state: PaddockCompletenessState;
  latestSceneId: string | null;
  latestProviderSceneId: string | null;
  latestAcquiredAt: string | null;
  latestSceneCloudCoverPct: number | null;
  onOldProcessingVersion: boolean;
  // True when this paddock has ANY saved display raster (any scene, any
  // processing version). Drives the "Imagery available" vs "No saved
  // imagery" badge in the UI — never label a paddock with saved display
  // rasters as "Imagery missing".
  hasSavedDisplayImagery: boolean;
  // True when a saved display raster exists but the newest completed scene
  // is older than the freshness window — UI shows "Refresh needed" rather
  // than "Imagery missing".
  savedImageryStale: boolean;
  // Indices with NO stored assets at all on the latest scene.
  missingLayers: SatelliteIndexType[];
  missingDisplayLayers: SatelliteIndexType[];
  missingAnalyticalLayers: SatelliteIndexType[];
  missingSummaries: SatelliteIndexType[];
  // Deduplicated union of every index this paddock needs re-processed.
  indicesRequiringWork: SatelliteIndexType[];
}


export interface CompletenessTotals {
  totalPaddocks: number;
  completePaddocks: number;
  missingPaddocks: number;
  incompletePaddocks: number;
  oldVersionPaddocks: number;
  missingDisplay: number;
  missingAnalytical: number;
  missingSummaries: number;
  totalMissing: number; // number of paddocks needing any work
}

export interface CompletenessReport {
  perPaddock: PaddockCompleteness[];
  totals: CompletenessTotals;
}

function normaliseKind(a: CompletenessAsset): AssetKind {
  if (a.asset_type === "DISPLAY_RASTER" || a.asset_type === "ANALYTICAL_RASTER") return a.asset_type;
  return a.storage_path.endsWith(".png") ? "DISPLAY_RASTER" : "ANALYTICAL_RASTER";
}

export interface InspectArgs {
  paddocks: CompletenessPaddockInput[];
  scenes: CompletenessScene[];
  assets: CompletenessAsset[];
  summaries: CompletenessSummary[];
  processingVersion?: string;
  latestWindowDays?: number;
  now?: Date;
}

export function inspectCompleteness({
  paddocks,
  scenes,
  assets,
  summaries,
  processingVersion = CURRENT_PROCESSING_VERSION,
  latestWindowDays = LATEST_WINDOW_DAYS,
  now = new Date(),
}: InspectArgs): CompletenessReport {
  const cutoff = now.getTime() - latestWindowDays * 86400_000;

  // Newest completed scene per paddock.
  const newestByPaddock = new Map<string, CompletenessScene>();
  for (const s of scenes) {
    if (s.processing_status !== "complete") continue;
    const cur = newestByPaddock.get(s.paddock_id);
    if (!cur || s.acquired_at > cur.acquired_at) newestByPaddock.set(s.paddock_id, s);
  }

  // Index assets & summaries by scene for quick lookup.
  const displayBySceneIndex = new Map<string, Set<SatelliteIndexType>>();
  const analyticalBySceneIndex = new Map<string, Set<SatelliteIndexType>>();
  const versionBySceneIndex = new Map<string, Set<string>>();
  for (const a of assets) {
    const kind = normaliseKind(a);
    const versionOk = (a.processing_version ?? "") === processingVersion;
    if (!versionOk) {
      const set = versionBySceneIndex.get(a.satellite_scene_id) ?? new Set<string>();
      set.add(String(a.processing_version ?? "unknown"));
      versionBySceneIndex.set(a.satellite_scene_id, set);
      continue;
    }
    const target = kind === "DISPLAY_RASTER" ? displayBySceneIndex : analyticalBySceneIndex;
    const set = target.get(a.satellite_scene_id) ?? new Set<SatelliteIndexType>();
    set.add(a.index_type);
    target.set(a.satellite_scene_id, set);
  }
  const summariesBySceneIndex = new Map<string, Set<SatelliteIndexType>>();
  for (const sum of summaries) {
    const set = summariesBySceneIndex.get(sum.satellite_scene_id) ?? new Set<SatelliteIndexType>();
    set.add(sum.index_type);
    summariesBySceneIndex.set(sum.satellite_scene_id, set);
  }

  // Paddocks that have ANY saved display raster on any scene (regardless of
  // processing version / freshness). Used to distinguish "no saved imagery"
  // from "saved imagery exists but may be stale or on an old version".
  const sceneIdToPaddockId = new Map<string, string>();
  for (const s of scenes) sceneIdToPaddockId.set(s.id, s.paddock_id);
  const paddocksWithAnyDisplay = new Set<string>();
  for (const a of assets) {
    const kind = normaliseKind(a);
    if (kind !== "DISPLAY_RASTER") continue;
    const pid = sceneIdToPaddockId.get(a.satellite_scene_id);
    if (pid) paddocksWithAnyDisplay.add(pid);
  }

  const perPaddock: PaddockCompleteness[] = [];
  const totals: CompletenessTotals = {
    totalPaddocks: paddocks.length,
    completePaddocks: 0,
    missingPaddocks: 0,
    incompletePaddocks: 0,
    oldVersionPaddocks: 0,
    missingDisplay: 0,
    missingAnalytical: 0,
    missingSummaries: 0,
    totalMissing: 0,
  };

  for (const p of paddocks) {
    const latest = newestByPaddock.get(p.id) ?? null;
    const latestMs = latest ? new Date(latest.acquired_at).getTime() : NaN;
    const withinWindow = Number.isFinite(latestMs) && latestMs >= cutoff;
    const hasSavedDisplayImagery = paddocksWithAnyDisplay.has(p.id);

    if (!latest || !withinWindow) {
      perPaddock.push({
        paddockId: p.id,
        paddockName: p.name,
        state: "missing_latest_scene",
        latestSceneId: latest?.id ?? null,
        latestProviderSceneId: latest?.provider_scene_id ?? null,
        latestAcquiredAt: latest?.acquired_at ?? null,
        latestSceneCloudCoverPct: latest?.scene_cloud_cover_pct ?? null,
        onOldProcessingVersion: false,
        hasSavedDisplayImagery,
        savedImageryStale: hasSavedDisplayImagery,
        missingLayers: [...REQUIRED_INDICES],
        missingDisplayLayers: [...REQUIRED_INDICES],
        missingAnalyticalLayers: REQUIRED_INDICES.filter(requiresAnalytical),
        missingSummaries: REQUIRED_INDICES.filter(requiresSummary),
        indicesRequiringWork: [...REQUIRED_INDICES],
      });
      totals.missingPaddocks += 1;
      totals.totalMissing += 1;
      continue;
    }


    const displays = displayBySceneIndex.get(latest.id) ?? new Set();
    const analyticals = analyticalBySceneIndex.get(latest.id) ?? new Set();
    const summariesSet = summariesBySceneIndex.get(latest.id) ?? new Set();
    const olderVersionSeen = versionBySceneIndex.has(latest.id);

    const missingLayers: SatelliteIndexType[] = [];
    const missingDisplayLayers: SatelliteIndexType[] = [];
    const missingAnalyticalLayers: SatelliteIndexType[] = [];
    const missingSummaries: SatelliteIndexType[] = [];

    for (const idx of REQUIRED_INDICES) {
      const hasDisplay = displays.has(idx);
      const hasAnalytical = analyticals.has(idx);
      const hasSummary = summariesSet.has(idx);
      const needsAnalytical = requiresAnalytical(idx);
      const needsSummary = requiresSummary(idx);
      if (!hasDisplay) missingDisplayLayers.push(idx);
      if (needsAnalytical && !hasAnalytical) missingAnalyticalLayers.push(idx);
      if (needsSummary && !hasSummary) missingSummaries.push(idx);
      const missingAll =
        !hasDisplay &&
        (!needsAnalytical || !hasAnalytical) &&
        (!needsSummary || !hasSummary);
      if (missingAll) missingLayers.push(idx);
    }

    const indicesRequiringWork = Array.from(new Set([
      ...missingDisplayLayers,
      ...missingAnalyticalLayers,
      ...missingSummaries,
    ]));

    let state: PaddockCompletenessState;
    if (indicesRequiringWork.length === 0) {
      state = "complete";
      totals.completePaddocks += 1;
    } else if (olderVersionSeen && missingDisplayLayers.length + missingAnalyticalLayers.length > 0) {
      state = "old_processing_version";
      totals.oldVersionPaddocks += 1;
      totals.incompletePaddocks += 1;
      totals.totalMissing += 1;
    } else {
      state = "incomplete_scene";
      totals.incompletePaddocks += 1;
      totals.totalMissing += 1;
    }

    totals.missingDisplay += missingDisplayLayers.length;
    totals.missingAnalytical += missingAnalyticalLayers.length;
    totals.missingSummaries += missingSummaries.length;

    perPaddock.push({
      paddockId: p.id,
      paddockName: p.name,
      state,
      latestSceneId: latest.id,
      latestProviderSceneId: latest.provider_scene_id,
      latestAcquiredAt: latest.acquired_at,
      latestSceneCloudCoverPct: latest.scene_cloud_cover_pct,
      onOldProcessingVersion: olderVersionSeen,
      hasSavedDisplayImagery: paddocksWithAnyDisplay.has(p.id) || (displays.size > 0),
      savedImageryStale: false,
      missingLayers,
      missingDisplayLayers,
      missingAnalyticalLayers,
      missingSummaries,
      indicesRequiringWork,
    });
  }

  return { perPaddock, totals };
}

export function describePaddockMissingItems(p: PaddockCompleteness): string[] {
  if (p.state === "complete") return ["Complete"];
  if (p.state === "missing_latest_scene") {
    return [p.hasSavedDisplayImagery ? "Refresh needed to check for newer imagery" : "No saved imagery"];
  }
  const parts: string[] = [];
  for (const idx of p.missingDisplayLayers) parts.push(`Missing ${idx} display`);
  for (const idx of p.missingAnalyticalLayers) parts.push(`Missing ${idx} analytical`);
  for (const idx of p.missingSummaries) parts.push(`Missing ${idx} summary`);
  if (p.onOldProcessingVersion) parts.push("Requires version upgrade");
  return parts.length ? parts : ["Complete"];
}

// ---------------------------------------------------------------------------
// Manifest-derived report
// ---------------------------------------------------------------------------
// The server-side `satellite_paddock_manifest` table is the source of truth
// for what display / analytical / summary assets exist per paddock for the
// CURRENT processing version. Prefer it over the client-side recount from raw
// scenes/assets — the recount was misclassifying paddocks with visible
// overlays as "Imagery missing" whenever the loaded scenes/assets slice was
// incomplete.

export type ManifestPackageStatusLite =
  | "complete"
  | "partial"
  | "display_available"
  | "upgrade_required"
  | "no_imagery";

export interface ManifestPaddockLite {
  paddock_id: string;
  latest_display_scene_id: string | null;
  latest_display_acquired_at: string | null;
  available_layer_types: SatelliteIndexType[] | null;
  available_analytical_types: SatelliteIndexType[] | null;
  missing_display_count: number | null;
  missing_analytical_count: number | null;
  missing_summary_count: number | null;
  package_status: ManifestPackageStatusLite;
}

export function reportFromManifest(
  paddocks: CompletenessPaddockInput[],
  manifestRows: ManifestPaddockLite[],
): CompletenessReport {
  const byId = new Map(manifestRows.map((r) => [r.paddock_id, r]));
  const perPaddock: PaddockCompleteness[] = [];
  const totals: CompletenessTotals = {
    totalPaddocks: paddocks.length,
    completePaddocks: 0,
    missingPaddocks: 0,
    incompletePaddocks: 0,
    oldVersionPaddocks: 0,
    missingDisplay: 0,
    missingAnalytical: 0,
    missingSummaries: 0,
    totalMissing: 0,
  };

  for (const p of paddocks) {
    const m = byId.get(p.id);
    if (!m || m.package_status === "no_imagery") {
      perPaddock.push({
        paddockId: p.id,
        paddockName: p.name,
        state: "missing_latest_scene",
        latestSceneId: null,
        latestProviderSceneId: null,
        latestAcquiredAt: null,
        latestSceneCloudCoverPct: null,
        onOldProcessingVersion: false,
        hasSavedDisplayImagery: false,
        savedImageryStale: false,
        missingLayers: [...REQUIRED_INDICES],
        missingDisplayLayers: [...REQUIRED_INDICES],
        missingAnalyticalLayers: REQUIRED_INDICES.filter(requiresAnalytical),
        missingSummaries: REQUIRED_INDICES.filter(requiresSummary),
        indicesRequiringWork: [...REQUIRED_INDICES],
      });
      totals.missingPaddocks += 1;
      totals.totalMissing += 1;
      continue;
    }

    const availDisplay = new Set(m.available_layer_types ?? []);
    const availAnalytical = new Set(m.available_analytical_types ?? []);
    const missingDisplayLayers = REQUIRED_INDICES.filter((i) => !availDisplay.has(i));
    const missingAnalyticalLayers = REQUIRED_INDICES.filter(
      (i) => requiresAnalytical(i) && !availAnalytical.has(i),
    );
    // Manifest tracks summary count but not exact index list; approximate with
    // the analytical-missing list truncated to the count for display purposes.
    const missingSummaries = missingAnalyticalLayers.slice(0, m.missing_summary_count ?? 0);
    const indicesRequiringWork = Array.from(new Set([
      ...missingDisplayLayers,
      ...missingAnalyticalLayers,
      ...missingSummaries,
    ]));

    let state: PaddockCompletenessState;
    if (m.package_status === "complete") {
      state = "complete";
      totals.completePaddocks += 1;
    } else if (m.package_status === "upgrade_required") {
      state = "old_processing_version";
      totals.oldVersionPaddocks += 1;
      totals.incompletePaddocks += 1;
      totals.totalMissing += 1;
    } else {
      state = "incomplete_scene";
      totals.incompletePaddocks += 1;
      totals.totalMissing += 1;
    }

    totals.missingDisplay += missingDisplayLayers.length;
    totals.missingAnalytical += missingAnalyticalLayers.length;
    totals.missingSummaries += missingSummaries.length;

    perPaddock.push({
      paddockId: p.id,
      paddockName: p.name,
      state,
      latestSceneId: m.latest_display_scene_id,
      latestProviderSceneId: null,
      latestAcquiredAt: m.latest_display_acquired_at,
      latestSceneCloudCoverPct: null,
      onOldProcessingVersion: m.package_status === "upgrade_required",
      hasSavedDisplayImagery: true,
      savedImageryStale: false,
      missingLayers: missingDisplayLayers,
      missingDisplayLayers,
      missingAnalyticalLayers,
      missingSummaries,
      indicesRequiringWork,
    });
  }

  return { perPaddock, totals };
}

