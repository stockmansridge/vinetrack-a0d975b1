This is a large change touching the manifest edge function, the mapping page, the SatelliteMap component and the date slider. I'll ship it in two slices so we can validate each before moving on.

## Slice 1 — Data & rendering consistency (Part A + Part C)

**Manifest (server) — `satellite-get-manifest`**
- Extend each `date_coverage` entry with `layer_coverage: Record<SatelliteIndexType, { available: number; total: number; percent: number; available_paddock_ids; missing_paddock_ids }>` computed from the per-paddock `layers[]` bundle (usable = display asset present + valid bounds + current processing version).
- Keep the existing `coverage_percent` (scene-level) for back-compat, add `scene_coverage_count`.

**Unified display-state model — `SatelliteMappingPage`**
- New `useDisplayState(selectedDate, selectedLayer, activePaddocks, manifest, overlayStatus)` returning:
  `{ totalPaddocks, sceneAvailable, layerAvailable, assetLoaded, overlayMounted, unavailable, perPaddock[] }`
  where each `perPaddock` carries: `scene_id`, `acquired_at`, `display_asset_id`, `analytical_asset_id`, `processing_version`, `storage_path`, `bounds`, `load_status`, `mount_status`, `reason`.
- Reasons: `displayed | no_scene_for_date | selected_layer_not_generated | display_asset_metadata_invalid | display_asset_fetch_failed | asset_decoded_overlay_not_mounted | bounds_invalid | package_version_mismatch`.
- Every consumer (slider coverage, status counts, per-paddock detail card, diagnostics, legend) reads from this model.

**Overlay selection & keying**
- Replace any global "selected scene" fallback with per-paddock lookup keyed on `paddock_id + date + layer + DISPLAY_RASTER + preferred processing_version`.
- Active overlay collection keyed `${paddockId}:${sceneId}:${indexType}:${assetId}`.
- Remove the scene-shim reconstruction paths that borrow assets across dates/paddocks/layers or promote analytical→display.

**MapKit lifecycle observability — `SatelliteMap`**
- Add `onOverlayLoad`, `onOverlayError`, `onOverlayMounted`, `onOverlayUnmounted` (paddockId, assetId).
- Page tracks `overlayStatus: Map<key, 'loading'|'loaded'|'error'|'mounted'>`; `overlayMounted` count drives the customer-facing "Paddocks displayed" number.

**Wording**
- Per-paddock strings: `Imagery displayed`, `Image available but still loading`, `No <LAYER> imagery saved for <date>`, `<LAYER> asset could not be loaded`, `<LAYER> processing incomplete`, `Cell data incomplete`.
- Slider coverage line uses `layer_coverage[selectedLayer]`.

**Refresh Imagery progress & reconciliation**
- Replace toast-only feedback with a persistent progress panel (fixed, over the map) driven by the existing refresh-job heartbeat: overall (`Paddock X of N`), current paddock name, phase (`Checking Copernicus imagery` → `Processing NDVI, NDMI and other saved layers`), per-paddock rows (queued/searching/found/processing/saved/loaded/no-capture/failed).
- On finish: refetch manifest, invalidate affected IDB cache entries by (paddock_id, date), await new asset loads + overlay mounts, then show summary: New captures, Paddocks updated, Unchanged, No suitable capture, Overlays now visible X of N. Separate line if processing succeeded but overlay failed to mount.

**Stale-error clearing**
- On successful date/layer switch, clear prior missing-asset and refresh error banners.

**Selected-date audit output (debug drawer)**
- Table for every active paddock on the selected date with all fields listed in §2 + final reason.

## Slice 2 — Laptop layout (Part B)

**Full-width map + overlay controls**
- Remove the permanent tall right sidebar. Map fills main width.
- Top-left overlay: compact Vineyard/Paddock/Layer control group + opacity slider (in a translucent panel).
- Top-right overlay: Map layer control, Refresh Imagery, Details, Full Screen (Admin tools for sysadmins).
- Bottom-centre overlay: `SatelliteDateSlider` in translucent panel, `max-w-[900px] w-[calc(100%-32px)]`, `bottom-4`, above legend/attribution.
- Bottom-right overlay: legend (unchanged).

**Right details drawer**
- New `SatelliteDetailsDrawer` (shadcn `Sheet` or custom absolute panel inside map container).
- Tabs: `Details` (per-paddock display state + selected-date audit), `History` (existing `SavedImageryHistory`), `Admin tools` (diagnostics, package health, cache diagnostics, Repair Missing Assets, Force Provider Check — sysadmin-only).
- Positioned `absolute inset-y-0 right-0` inside the map container so it never overlaps the app header; internal scroll; Escape closes; width ~420px desktop, full-width mobile.

**Full-screen (application) mode**
- CSS-only fixed container: `position: fixed; top: var(--app-header-height,56px); left:0; right:0; bottom:0; z-index:40`.
- Toggle via Full Screen button; Escape exits; preserves MapKit instance and viewport (no remount).
- Timeline, legend, drawer remain available.

**Laptop fit**
- Normal mode map uses `h-[calc(100vh-var(--app-header-height,56px)-var(--satellite-toolbar-height,96px))]` with `min-h-[520px]`.
- Verified against 1366×768 and 1440×900.

## Technical notes
- Files changed: `supabase/functions/satellite-get-manifest/index.ts`, `src/lib/satelliteManifest.ts` (types), `src/pages/tools/SatelliteMappingPage.tsx`, `src/components/SatelliteMap.tsx`, `src/components/satellite/SatelliteDateSlider.tsx`, new `src/components/satellite/SatelliteDetailsDrawer.tsx`, new `src/components/satellite/SatelliteRefreshProgressPanel.tsx`, new `src/hooks/useSatelliteDisplayState.ts`.
- No changes to Copernicus formulas, index math, asset formats, provider credentials, IDB cache identity, manifest v3 asset shape, playback timing, crossfade behaviour.
- Typecheck via `bunx tsgo --noEmit`; screenshots via Playwright at 1366×768 and 1440×900, normal + full-screen, full-coverage and partial-coverage NDVI dates.

## Order
1. Ship Slice 1, validate against the 2026-07-09 NDVI case (coverage matches mounted overlays; every "displayed" paddock has a visible raster; unavailable paddocks each have a specific reason; refresh shows progress + reconciles).
2. Then ship Slice 2 layout rework.

Confirm to proceed with **Slice 1 first**, or say "both" and I'll ship them back-to-back.