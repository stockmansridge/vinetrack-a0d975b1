## Goal

When hovering over a paddock on Crop Health Maps, show an **Est. Row #** line in the popup, derived from the cursor's lat/lng and the paddock's stored row geometry.

## How it works

Each paddock in the DB carries a `rows` JSONB array where each row has a `number` plus `startPoint`/`endPoint` (lat/lng) — already parsed by `parseRows()` in `src/lib/paddockGeometry.ts`. For a given hover point we can find the row whose start→end line segment is closest to the cursor and display that row's `number`.

## Changes (frontend only)

1. **`src/lib/paddockGeometry.ts`** — add a small helper `estimateRowNumberAt(rows, latLng)`:
   - Skip rows without both start and end.
   - For each row, compute perpendicular distance from the point to the row's segment using an equirectangular projection around the point's latitude (accurate at row-spacing scale, cheap).
   - Return the `number` of the nearest row, plus the perpendicular distance in metres (so we can guard against absurd matches when the cursor is well outside the block).

2. **`src/pages/tools/SatelliteMappingPage.tsx`**:
   - Keep a paddock-id → parsed `rows` map derived from the existing `paddocks` query (memoised, no extra fetch).
   - In the hover handler, once `paddockId` is resolved, call `estimateRowNumberAt` with the hover lat/lng and store `estRow` on the hover state.
   - In the popup JSX (around line 1313), render an `Est. Row: <n>` line under the paddock name whenever `estRow` is available. Show it for every hover status (loading / ready / no_data / error) since it only depends on geometry, not on raster sampling.
   - If the nearest row is further than a sensible sanity threshold (e.g. > 25 m — larger than any realistic row spacing) or the paddock has no `rows` data, omit the line rather than showing a misleading number.

## Out of scope

- No backend, edge function, migration, or raster-processing changes.
- No change to how row geometry is captured or edited.
- Layer labels, toasts, and existing popup fields stay as they are.

## Caveat to surface in the UI

The label is **"Est. Row"** (not "Row") because accuracy depends on the paddock having up-to-date row start/end points; paddocks without recorded rows simply won't show the line.
