# Slice 2 — Map-First Crop Health Maps

Convert `SatelliteMappingPage` from a stacked layout with a tall right-side toolbar into a map-first workspace where controls live over the map and secondary information moves into a right-hand drawer.

No changes to the view model, manifest v3, Copernicus/asset endpoints, IndexedDB cache identity, playback timing, crossfade, analytical raster format, or overlay lifecycle identity.

## New components

Create four small components under `src/components/satellite/`:

1. **`MapWorkspaceDrawer.tsx`** — right-side drawer overlaid on the map container. Tabs: `Details`, `History`, `Admin` (Admin tab hidden unless `isSystemAdmin`). Uses shadcn `Sheet` with `side="right"` on desktop (width 380–440 px) and bottom sheet on mobile. Escape closes; returns focus to the trigger. Body is scrollable.
2. **`MapControlsBar.tsx`** — top-left overlay: `Vineyard`, `Paddock`, `Map Layer` compact selects; collapses to a "Map controls" popover under 900 px.
3. **`MapActionsBar.tsx`** — top-right overlay: `Details`, `History`, `Full Screen`, and (admin only) `Admin` buttons plus the primary `Check for New Imagery` action.
4. **`MapLegend.tsx`** — extract existing legend markup, add an opacity slider in the expanded state.

## Layout restructure — `SatelliteMappingPage.tsx`

Replace the outer `flex-col lg:flex-row` (map + right toolbar + stacked timeline + saved history) with:

```text
<div class="flex flex-col h-[calc(100dvh-var(--vt-header-h,4rem))]">
  <header row (compact title + admin/beta badge + short description)>
  <div ref=workspace class="relative flex-1 min-h-0">
      <SatelliteMap fills 100%/100%>
      <MapControlsBar   absolute top-3 left-3 />
      <MapActionsBar    absolute top-3 right-3 />
      <RefreshProgressPanel absolute top-3 right-3 (offset when actions bar present) />
      <SatelliteDateSlider absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(900px,calc(100%-32px))] />
      <MapLegend        absolute bottom-3 right-3 />
      <MapWorkspaceDrawer opens as absolute right-0 top-0 bottom-0 width 400 />
  </div>
</div>
```

Remove the permanent right sidebar `Card` and the below-map `SavedImageryHistory` card — their contents move into the drawer.

## Drawer content mapping

- **Details** — selected date, layer name, mounted coverage, paddocks displayed/unavailable, per-paddock status list, selected paddock info, cell/package warnings. Sourced only from `useCropHealthViewModel`.
- **History** — existing `SavedImageryHistory` component with monthly grouping and filters. Selecting a date stops playback, clears preview, commits date.
- **Admin** — Repair Missing Assets, Build 12-Month History, Package Health, Overlay Health, Copernicus status, processing jobs, browser-cache/manifest diagnostics.

## Map-focus mode

Add local `mapFocus` boolean. When on, the workspace div becomes `fixed inset-0 top-[var(--vt-header-h)] left-[var(--vt-sidebar-w,0)]` with `z-40`. All overlays keep working. `Esc` exits focus (only if no drawer open). "Exit Full Screen" button appears in the actions bar.

Do **not** call MapKit `fitBounds` on focus toggle or drawer open/close — only call `map.mapkit?.map?.invalidateSize?.()` (or the local resize helper `SatelliteMap` already exposes via `ResizeObserver`; verify it does — otherwise add a `mapRef.current?.resize()` hook). Preserve region.

## Timeline / legend / refresh placement

- `SatelliteDateSlider` — bottom-centre, translucent panel `bg-background/90 backdrop-blur border shadow-md`; keep all existing props.
- `MapLegend` — bottom-right, collapsed by default under 1024 px width.
- `RefreshProgressPanel` — already absolute top-3 right-3; shift to `top-16` when actions bar is present so they don't overlap.

## Opacity control

Move opacity slider into the expanded `MapLegend`. Delete from the toolbar. Behaviour unchanged (`setOpacity` on the same state).

## Header offset

Read `var(--vt-header-h)` if defined; fall back to `4rem`. Do not hard-code totals.

## Accessibility

- All icon buttons get `aria-label`.
- Drawer tabs use `Tabs` from shadcn.
- Escape closes drawer first, then exits map focus.
- `useEffect` to trap Escape at page level.
- Focus returns to the button that opened the drawer (Sheet handles this).

## Files

**New:**
- `src/components/satellite/MapWorkspaceDrawer.tsx`
- `src/components/satellite/MapControlsBar.tsx`
- `src/components/satellite/MapActionsBar.tsx`
- `src/components/satellite/MapLegend.tsx`

**Edited:**
- `src/pages/tools/SatelliteMappingPage.tsx` — swap layout, hoist state, delete replaced markup.

**Untouched:**
- `src/components/SatelliteMap.tsx`
- `src/components/satellite/SatelliteDateSlider.tsx`
- `src/components/satellite/RefreshProgressPanel.tsx`
- `src/components/satellite/OverlayHealthPanel.tsx`
- `src/lib/cropHealthViewModel.ts`, `src/hooks/useCropHealthViewModel.ts`

## Validation

- `bunx tsgo --noEmit` passes.
- Vitest suite passes (9/9 view model + others).
- Playwright screenshots at 1366×768 normal + focus, Details/History drawers open, tablet 768.
- Manual: MapKit centre/zoom preserved across drawer open, focus toggle, layer change.

## Deliberately deferred

- Compare Dates (next phase).
- Wording overhaul beyond the primary action label and copy strings listed in §12.
- Refactoring `SatelliteMap.tsx` internals — Slice 1 already stabilised overlay identity.

Awaiting approval — this is a heavy restructure of a 3245-line file and I want to confirm the approach before ripping the old layout apart.
