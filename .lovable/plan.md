# Satellite Mapping — keep user zoom, and let the map own the screen

Two problems to fix on `/tools/satellite-mapping`:

1. Zooming into a paddock snaps the map back out to the fit-all view.
2. Header, dev notice, toolbar, layer description and diagnostics push the map below the fold, so it feels small.

## 1. Stop the map from zooming back out

**Root cause.** In `src/components/SatelliteMap.tsx`, the polygon-rendering effect also assigns `map.region = new mapkit.CoordinateRegion(...)` to fit paddocks. Its deps include `paddocks` and `onPaddockClick`. The parent (`SatelliteMappingPage`) rebuilds `paddocks` inline every render and re-renders on every pointer hover (tooltip / `cellRect` state). Every hover ⇒ effect fires ⇒ `map.region` reset ⇒ user's zoom is lost.

**Fix (in `src/components/SatelliteMap.tsx`).** Decouple polygon rebuild from region fitting, and only fit when the fit actually needs to change.

- Add a `lastFitSigRef` (ref).
- Keep `sig` (already memoized from paddock ids + count + `selectedPaddockId`) as the fit key.
- In the effect:
  - Rebuild polygon overlays when `sig` changes.
  - Only run the `map.region = …` fit when `lastFitSigRef.current !== sig`, then store `sig`.
  - When `selectedPaddockId` becomes `null`/`"all"`, treat that as an explicit user request to fit-all and refit; otherwise leave the user's current zoom untouched.
- Remove `paddocks` and `onPaddockClick` from the effect deps. Use `paddocksRef` / `onPaddockClickRef` (updated each render) so click handlers stay current without retriggering the effect.

Net result: pan/zoom stays put across hover-driven re-renders. Initial load still fits all paddocks. Selecting a specific paddock still zooms to it. Switching back to "All paddocks" refits.

## 2. Layout: map above the fold

Rework `src/pages/tools/SatelliteMappingPage.tsx` so the map dominates the viewport, roughly like a mapping app rather than a stacked report.

Layout plan (desktop ≥ `lg`):

```text
┌───────────────────────────────────────────────────────────────┐
│ Compact header row: title · admin badge · Process · Generate  │
├───────────────────────────────┬───────────────────────────────┤
│                               │  Controls panel (scrollable)  │
│                               │  - Vineyard / Paddock         │
│           MAP                 │  - Date / Layer / Opacity     │
│      (fills remaining         │  - Layer description          │
│       viewport height)        │  - Batch progress             │
│                               │  - Admin diagnostics          │
│                               │                               │
└───────────────────────────────┴───────────────────────────────┘
```

Concrete changes:

- Wrap the page in a flex column that fills the viewport: `min-h-[calc(100vh-4rem)]` (header is 64px per `AppLayout`) and reduce outer padding (`p-2 md:p-3`).
- Collapse the current header block into one compact row: keep title + "System Admin Only" badge on the left; move the primary action buttons (Process Latest Imagery, Generate Cell Readings, Retry) into the same row on the right. Drop the descriptive paragraph and the amber "under active development" notice from the top — surface the dev-only note as a small inline pill next to the badge instead.
- Split the body into a two-column flex row that grows to fill remaining height:
  - Left: the Map card, `flex-1`, with `h-full`. Replace the fixed `h-[560px]` on the map container with `h-full min-h-[420px]` so it fills the column.
  - Right: a `w-[340px] shrink-0` sidebar containing the existing toolbar controls, layer description, batch progress and admin diagnostics, stacked vertically inside a single scrollable `Card` (`overflow-y-auto`).
- Mobile (`< lg`): stack vertically — map first at `h-[70vh]`, controls below. No functional change; just no side-by-side.
- Keep every existing control, query, mutation, tooltip and hover behaviour exactly as-is. This is presentation only.

## Files changed

- `src/components/SatelliteMap.tsx` — zoom-preservation fix.
- `src/pages/tools/SatelliteMappingPage.tsx` — layout restructure only; no data / logic changes.

## Verification

- Typecheck.
- Manual: open Satellite Mapping, zoom in with scroll/pinch, hover across paddocks — zoom must stay put. Selecting a paddock refits to it; switching back to "All paddocks" refits to all. On desktop, the map fills the area between the app header and the bottom of the viewport, with controls in a right-hand sidebar.
