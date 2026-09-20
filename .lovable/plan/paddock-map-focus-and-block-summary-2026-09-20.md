# Paddock map focus and block summary

## Changes
- Make the Block Setup map Apple Maps only and remove the provider selector and OpenStreetMap fallback controls.
- Keep the Apple map framed to the selected vineyard when block selection causes overlays to refresh, preventing the view from jumping outward.
- Replace the automatic full-detail drawer on block click with a compact summary panel beside the map.
- Keep the right panel within the map’s height and place an **All block details** button at its bottom; that button opens the existing full-detail drawer.
- Preserve the existing full-detail content, block editing permissions, map geometry, rows, and calculations.

## Validation
- Add focused coverage for the Apple-only map view and click-to-summary/full-details flow where practical.
- Run focused tests and the TypeScript check.
- Verify the page visually at desktop and mobile widths.

## Technical details
- Reuse the existing Apple MapKit map and full-detail drawer.
- Reapply cached vineyard bounds after selection-driven overlay updates rather than allowing MapKit to reset to a world-scale region.
