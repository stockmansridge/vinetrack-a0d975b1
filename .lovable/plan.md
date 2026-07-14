
# Slice 1 — Unified Crop Health View Model + Overlay Health

Scope note: Slice 2 (map-first layout, drawer, full-screen) is not started until you accept Slice 1 against the 9 July 2026 NDVI case. No Copernicus, manifest v3, asset endpoint, IDB cache identity, playback timing, or analytical-raster format changes in this phase.

## 1. New files

- `src/hooks/useCropHealthViewModel.ts` — single authoritative hook.
  - Inputs: `manifest` (v3), `selectedDate`, `selectedLayer`, `activePaddockIds`, `activePaddocksMeta` (id → name), `displayLoadState` (Map key → `loading|loaded|failed` + error), `analyticalLoadState` (same), `overlayLifecycle` (Map key → `mounted|unmounted|error`), `refreshJob` (active job + per-paddock phase map), `packageHealth` (from manifest paddock rows).
  - Outputs: `{ paddocks: CropHealthPaddockViewState[]; byId: Record<string, CropHealthPaddockViewState>; summary: CropHealthSelectedDateSummary; keys: { displayKey(p), analyticalKey(p) } }`.
  - Keying: `displayKey = paddockId|acquisitionDate|selectedLayer|displayAssetId`, `analyticalKey = paddockId|sceneId|selectedLayer|analyticalAssetId`. No global "current scene id".
  - Pure derivation only. No fetching, no side effects. Stable memoisation on inputs.

- `src/lib/cropHealthViewModel.ts` — types + pure `deriveCropHealthViewModel(input)` used by the hook and by tests.
  - Exports `CropHealthPaddockViewState`, `CropHealthSelectedDateSummary`, `CropHealthAvailabilityReason`, `CropHealthDisplayStatus`, `CropHealthAnalyticalStatus`, `CropHealthPackageStatus`, `CropHealthRefreshPhase`.
  - Deterministic reason resolution order (first match wins): package_upgrade_required → no_scene_for_date → selected_layer_missing → scene_incomplete → asset_load_failed → overlay_mount_failed → loading → cell_data_incomplete → displayed.

- `src/lib/cropHealthCopy.ts` — single mapping `reasonToCustomerMessage(reason, layerLabel)` implementing the wording table in section 7. Reused by timeline coverage text, per-paddock list, refresh summary, drawer (Slice 2), missing-paddock statuses.

- `src/components/satellite/OverlayHealthPanel.tsx` — admin-only diagnostic (section 10-11). Consumes the same view model. Compact header + collapsible per-paddock table (paddock, scene, display asset, load status, mount status, analytical status, availability reason, last error). Hidden entirely for non-admin.

- `src/test/cropHealthViewModel.test.ts` — deterministic fixtures for: full coverage, mixed loading/mounted, layer missing on some paddocks, asset load failure, mount failure, package upgrade required, mid-refresh state, date/layer change clears stale errors.

## 2. Edits to `SatelliteMappingPage.tsx`

Refactor in place — no rewrite. Concretely:

- Replace ad-hoc `useMemo` blocks that compute "paddocks displayed", coverage %, missing reasons, per-paddock status strings with a single `const vm = useCropHealthViewModel({...})` call.
- Convert existing display/analytical loader `useState` maps to the keying scheme above and pass through to the hook.
- Wire `SatelliteMap` callbacks (`onOverlayLoad/Error/Mounted/Unmounted`) to update `overlayLifecycle` keyed by `{paddockId, sceneId, indexType, assetId}` — never URL. Confirm `SatelliteMap` already emits these payload fields; if any field is missing, thread it through (props-only change, no lifecycle rework).
- Coverage headline in timeline + per-paddock list + refresh completion summary + missing-paddock statuses + hover availability all read from `vm`.
- Delete the client-side "borrow scene across dates/paddocks/layers" shims already flagged in `.lovable/plan.md`; the hook's reason resolver replaces them.
- Stale-state clearing: on `selectedDate`/`selectedLayer` change, clear entries in `displayLoadState`/`analyticalLoadState`/`overlayLifecycle` whose key prefix no longer matches; keep last-mounted overlay visible until the new one mounts (existing crossfade path preserved).
- Mount `OverlayHealthPanel` inside the existing admin diagnostics section — no layout changes to the page in this slice.

## 3. Edits to `SatelliteMap.tsx`

Callback payload audit only. Ensure `onOverlayLoad/Error/Mounted/Unmounted` each pass `{ paddockId, sceneId, indexType, assetId, overlayKey }`. No lifecycle logic change.

## 4. Edits to `RefreshProgressPanel.tsx`

Read per-paddock phase from `vm` rather than internal derivation for the completion summary line. Progress rows during an in-flight job remain driven by the existing heartbeat data (unchanged in this slice).

## 5. Explicitly out of scope for Slice 1

- No layout, drawer, full-screen, slider-repositioning changes.
- No wording change to the "Refresh Imagery" button (that moves to Slice 2 per section 25).
- No manifest edge-function edits — v3 already exposes `layer_coverage` per the prior plan; if it turns out it does not, I stop and report rather than editing the function in this slice.
- No changes to IDB cache keys or the asset endpoint.

## 6. Validation before declaring Slice 1 done

- `bunx tsgo --noEmit` clean.
- `bunx vitest run src/test/cropHealthViewModel.test.ts` green.
- Manual: on 9 July 2026 NDVI, report per-paddock (scene found / layer asset found / asset loaded / overlay mounted / analytical ready / final status) and confirm the four invariants in section "Slice 1 validation".

## 7. Open confirmations before I start

1. OK to leave the "Refresh Imagery" → "Check for New Imagery" rename for Slice 2 (keeps Slice 1 diff smaller and consistent with section 25)?
2. OK that `OverlayHealthPanel` sits inside the existing admin diagnostics block in Slice 1, then moves into the Admin drawer tab in Slice 2 — rather than building the drawer now?
3. If the manifest edge function is missing `layer_coverage` on `date_coverage`, I stop and report (per scope), rather than editing `satellite-get-manifest`. Confirm.

Reply "go" (or with adjustments) and I'll ship Slice 1 in the next turn.
