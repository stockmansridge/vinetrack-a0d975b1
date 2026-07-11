Add small numeric min/max labels to the bottom and top of the layer legend on the Satellite Map so the hover value has a clear scale reference.

## Changes

1. Extend the `LayerOption` type in `src/pages/tools/SatelliteMappingPage.tsx` with `legendMinValue` and `legendMaxValue` strings.
2. Add sensible numeric ranges to each `LAYERS` entry:
   - `NDVI`: `-1.0` to `1.0`
   - `NDRE`: `-1.0` to `1.0`
   - `MSAVI`: `-1.0` to `1.0`
   - `RECI`: `0` to `10`
   - `NDMI`: `-1.0` to `1.0`
   - `TRUE_COLOUR`: `0` to `255` (digital-number scale)
3. Update the legend UI below the gradient bar to render the numeric endpoints at the ends of the scale, keeping the existing qualitative labels (e.g., "Darker / Brighter") directly underneath them.

## Verification

- Typecheck passes.
- Visual check: legend gradient shows the numeric value at the bottom-left and top-right of the scale while hovering on the map.