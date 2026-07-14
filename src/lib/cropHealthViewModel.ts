// Pure, deterministic derivation of the Crop Health Maps selected-date/layer
// view model. No React, no fetching, no side effects — safe to unit-test.
//
// Every customer-facing status (map overlay input, timeline coverage, per-
// paddock detail list, legend coverage, refresh completion summary, missing-
// paddock statuses, diagnostics, hover availability) must consume the output
// of this function via `useCropHealthViewModel`, never re-derive from raw
// manifest state.

import type {
  ManifestResponse,
  ManifestDateEntry,
  ManifestDatePaddock,
  ManifestPaddock,
  ManifestLayerBundle,
} from "./satelliteManifest";
import type { SatelliteIndexType } from "@/types/satellite";

// ---------- Types ----------

export type CropHealthSceneStatus = "none" | "incomplete" | "complete";

export type CropHealthDisplayStatus =
  | "not_available"
  | "not_generated"
  | "loading"
  | "loaded"
  | "mounted"
  | "failed";

export type CropHealthAnalyticalStatus =
  | "not_available"
  | "missing"
  | "loading"
  | "ready"
  | "failed";

export type CropHealthPackageStatus =
  | "none"
  | "partial"
  | "complete"
  | "upgrade_required";

export type CropHealthRefreshPhase =
  | "idle"
  | "queued"
  | "searching"
  | "processing"
  | "saving"
  | "reconciling"
  | "complete"
  | "failed";

export type CropHealthAvailabilityReason =
  | "displayed"
  | "loading"
  | "no_scene_for_date"
  | "selected_layer_missing"
  | "scene_incomplete"
  | "asset_load_failed"
  | "overlay_mount_failed"
  | "cell_data_incomplete"
  | "package_upgrade_required";

export interface CropHealthPaddockViewState {
  paddockId: string;
  paddockName: string;

  acquisitionDate: string | null;
  selectedLayer: SatelliteIndexType;

  sceneId: string | null;
  displayAssetId: string | null;
  analyticalAssetId: string | null;

  sceneStatus: CropHealthSceneStatus;
  displayStatus: CropHealthDisplayStatus;
  analyticalStatus: CropHealthAnalyticalStatus;
  packageStatus: CropHealthPackageStatus;
  refreshStatus: CropHealthRefreshPhase;

  availabilityReason: CropHealthAvailabilityReason;

  displayMounted: boolean;
  cellHoverReady: boolean;

  sceneCloudCoverPct: number | null;
  validCoveragePct: number | null;
  nativeResolutionM: number | null;

  errorMessage: string | null;

  /** Stable keys for cross-component lookups. */
  displayKey: string;
  analyticalKey: string;
}

export interface CropHealthSelectedDateSummary {
  activePaddocks: number;
  scenesAvailable: number;
  layerAssetsAvailable: number;
  assetsLoaded: number;
  overlaysMounted: number;
  unavailable: number;

  completePackages: number;
  partialPackages: number;
  upgradeRequired: number;

  analyticalReady: number;
  analyticalMissing: number;
  analyticalFailed: number;

  // Customer-facing coverage: mounted overlays / active paddocks × 100.
  coveragePercent: number;
}

export type AssetLoadPhase = "loading" | "loaded" | "failed";
export interface AssetLoadState {
  phase: AssetLoadPhase;
  errorMessage?: string | null;
}

export type OverlayLifecyclePhase = "mounted" | "unmounted" | "error";
export interface OverlayLifecycleState {
  phase: OverlayLifecyclePhase;
  errorMessage?: string | null;
}

export interface CropHealthViewModelInput {
  manifest: ManifestResponse | null | undefined;
  selectedDate: string | null;
  selectedLayer: SatelliteIndexType;
  activePaddocks: { id: string; name: string }[];
  /** Keyed by `displayKeyFor(paddockId, date, layer, assetId)`. */
  displayLoadState: ReadonlyMap<string, AssetLoadState>;
  /** Keyed by `analyticalKeyFor(paddockId, sceneId, layer, assetId)`. */
  analyticalLoadState: ReadonlyMap<string, AssetLoadState>;
  /** Keyed by `displayKeyFor(...)`. */
  overlayLifecycle: ReadonlyMap<string, OverlayLifecycleState>;
  /** Per-paddock refresh phase from an active job (optional). */
  refreshPhaseByPaddock?: ReadonlyMap<string, CropHealthRefreshPhase>;
}

export interface CropHealthViewModel {
  paddocks: CropHealthPaddockViewState[];
  byId: Record<string, CropHealthPaddockViewState>;
  summary: CropHealthSelectedDateSummary;
}

// ---------- Key helpers ----------

export function displayKeyFor(
  paddockId: string,
  acquisitionDate: string | null,
  layer: SatelliteIndexType,
  displayAssetId: string | null,
): string {
  return `${paddockId}|${acquisitionDate ?? "-"}|${layer}|${displayAssetId ?? "-"}`;
}

export function analyticalKeyFor(
  paddockId: string,
  sceneId: string | null,
  layer: SatelliteIndexType,
  analyticalAssetId: string | null,
): string {
  return `${paddockId}|${sceneId ?? "-"}|${layer}|${analyticalAssetId ?? "-"}`;
}

// ---------- Package-status mapping ----------

function mapPackageStatus(p: ManifestPaddock | undefined): CropHealthPackageStatus {
  if (!p) return "none";
  switch (p.package_status) {
    case "complete":
      return "complete";
    case "upgrade_required":
      return "upgrade_required";
    case "partial":
    case "display_available":
      return "partial";
    case "no_imagery":
    default:
      return "none";
  }
}

// ---------- Derivation ----------

export function deriveCropHealthViewModel(
  input: CropHealthViewModelInput,
): CropHealthViewModel {
  const {
    manifest,
    selectedDate,
    selectedLayer,
    activePaddocks,
    displayLoadState,
    analyticalLoadState,
    overlayLifecycle,
    refreshPhaseByPaddock,
  } = input;

  const dateEntry: ManifestDateEntry | undefined = selectedDate
    ? manifest?.date_coverage?.find((d) => d.acquisition_date === selectedDate)
    : undefined;

  const packageByPaddock = new Map<string, ManifestPaddock>();
  for (const p of manifest?.paddocks ?? []) packageByPaddock.set(p.paddock_id, p);

  const paddockOnDate = new Map<string, ManifestDatePaddock>();
  for (const p of dateEntry?.paddocks ?? []) paddockOnDate.set(p.paddock_id, p);

  const missingReasonByPaddock = new Map<string, string>();
  for (const m of dateEntry?.missing_paddocks ?? []) {
    missingReasonByPaddock.set(m.paddock_id, m.reason);
  }

  const paddocks: CropHealthPaddockViewState[] = activePaddocks.map((meta) => {
    const paddockId = meta.id;
    const packageStatus = mapPackageStatus(packageByPaddock.get(paddockId));
    const refreshStatus: CropHealthRefreshPhase =
      refreshPhaseByPaddock?.get(paddockId) ?? "idle";

    const dp = paddockOnDate.get(paddockId);
    const layerBundle: ManifestLayerBundle | undefined = dp?.layers?.find(
      (l) => l.index_type === selectedLayer,
    );

    const sceneId = dp?.scene_id ?? null;
    const displayAssetId = layerBundle?.display?.asset_id ?? null;
    const analyticalAssetId = layerBundle?.analytical?.asset_id ?? null;

    const displayKey = displayKeyFor(paddockId, selectedDate, selectedLayer, displayAssetId);
    const analyticalKey = analyticalKeyFor(paddockId, sceneId, selectedLayer, analyticalAssetId);

    // Scene status ---
    let sceneStatus: CropHealthSceneStatus = "none";
    if (dp) {
      sceneStatus = dp.package_version_mismatch ? "incomplete" : "complete";
    } else if (missingReasonByPaddock.get(paddockId) === "scene_not_complete") {
      sceneStatus = "incomplete";
    }

    // Display status ---
    let displayStatus: CropHealthDisplayStatus;
    if (!dp) {
      displayStatus = "not_available";
    } else if (!displayAssetId) {
      displayStatus = "not_generated";
    } else {
      const load = displayLoadState.get(displayKey);
      const life = overlayLifecycle.get(displayKey);
      if (life?.phase === "mounted") displayStatus = "mounted";
      else if (life?.phase === "error") displayStatus = "failed";
      else if (load?.phase === "failed") displayStatus = "failed";
      else if (load?.phase === "loaded") displayStatus = "loaded";
      else if (load?.phase === "loading") displayStatus = "loading";
      else displayStatus = "loading";
    }

    // Analytical status ---
    let analyticalStatus: CropHealthAnalyticalStatus;
    if (!dp) {
      analyticalStatus = "not_available";
    } else if (!analyticalAssetId) {
      analyticalStatus = "missing";
    } else {
      const load = analyticalLoadState.get(analyticalKey);
      if (load?.phase === "failed") analyticalStatus = "failed";
      else if (load?.phase === "loaded") analyticalStatus = "ready";
      else if (load?.phase === "loading") analyticalStatus = "loading";
      else analyticalStatus = "loading";
    }

    const displayMounted = displayStatus === "mounted";
    const cellHoverReady = analyticalStatus === "ready";

    // Availability reason — deterministic priority.
    let availabilityReason: CropHealthAvailabilityReason;
    if (packageStatus === "upgrade_required") {
      availabilityReason = "package_upgrade_required";
    } else if (!dp) {
      availabilityReason = "no_scene_for_date";
    } else if (!displayAssetId) {
      availabilityReason = "selected_layer_missing";
    } else if (sceneStatus === "incomplete") {
      availabilityReason = "scene_incomplete";
    } else if (displayStatus === "failed") {
      availabilityReason = overlayLifecycle.get(displayKey)?.phase === "error"
        ? "overlay_mount_failed"
        : "asset_load_failed";
    } else if (displayStatus === "mounted") {
      availabilityReason = cellHoverReady ? "displayed" : "cell_data_incomplete";
    } else {
      availabilityReason = "loading";
    }

    const errorMessage =
      displayLoadState.get(displayKey)?.errorMessage
      ?? overlayLifecycle.get(displayKey)?.errorMessage
      ?? analyticalLoadState.get(analyticalKey)?.errorMessage
      ?? null;

    return {
      paddockId,
      paddockName: meta.name,
      acquisitionDate: selectedDate,
      selectedLayer,
      sceneId,
      displayAssetId,
      analyticalAssetId,
      sceneStatus,
      displayStatus,
      analyticalStatus,
      packageStatus,
      refreshStatus,
      availabilityReason,
      displayMounted,
      cellHoverReady,
      sceneCloudCoverPct: dp?.paddock_cloud_cover_pct ?? null,
      validCoveragePct: dp?.paddock_valid_coverage_pct ?? null,
      nativeResolutionM: layerBundle?.display?.native_resolution_m ?? null,
      errorMessage,
      displayKey,
      analyticalKey,
    };
  });

  // Aggregate summary ---
  const summary: CropHealthSelectedDateSummary = {
    activePaddocks: paddocks.length,
    scenesAvailable: 0,
    layerAssetsAvailable: 0,
    assetsLoaded: 0,
    overlaysMounted: 0,
    unavailable: 0,
    completePackages: 0,
    partialPackages: 0,
    upgradeRequired: 0,
    analyticalReady: 0,
    analyticalMissing: 0,
    analyticalFailed: 0,
    coveragePercent: 0,
  };

  for (const p of paddocks) {
    if (p.sceneStatus !== "none") summary.scenesAvailable += 1;
    if (p.displayAssetId) summary.layerAssetsAvailable += 1;
    if (p.displayStatus === "loaded" || p.displayStatus === "mounted") summary.assetsLoaded += 1;
    if (p.displayStatus === "mounted") summary.overlaysMounted += 1;
    if (p.availabilityReason !== "displayed" && p.availabilityReason !== "cell_data_incomplete") {
      summary.unavailable += 1;
    }

    if (p.packageStatus === "complete") summary.completePackages += 1;
    else if (p.packageStatus === "partial") summary.partialPackages += 1;
    else if (p.packageStatus === "upgrade_required") summary.upgradeRequired += 1;

    if (p.analyticalStatus === "ready") summary.analyticalReady += 1;
    else if (p.analyticalStatus === "missing" || p.analyticalStatus === "not_available") {
      summary.analyticalMissing += 1;
    } else if (p.analyticalStatus === "failed") summary.analyticalFailed += 1;
  }

  summary.coveragePercent =
    summary.activePaddocks > 0
      ? Math.round((summary.overlaysMounted / summary.activePaddocks) * 1000) / 10
      : 0;

  const byId: Record<string, CropHealthPaddockViewState> = {};
  for (const p of paddocks) byId[p.paddockId] = p;

  return { paddocks, byId, summary };
}
