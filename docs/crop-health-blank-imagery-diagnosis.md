# Crop Health — blank saved imagery diagnosis (19 Oct 2026)

Scope: Stockman's Ridge `fe952afe-437f-4be7-8cbf-fdd8e630411c`, all saved NDVI / True Colour assets.
Method: read-only download of private `satellite-assets` objects with the project service context
(no signed URLs or keys logged), full PNG RGBA decode (fast-png) and full TIFF cell read (geotiff).
No imagery provider was called. No stored rows or objects were modified.

## Decoded evidence — 1 Aug 2026 (S2A_MSIL2A_20260801T001251_N0512_R073_T55HFD)

| Paddock | File | Bytes | Decoded | Visible (alpha>0) | Valid cells |
|---|---|---|---|---|---|
| 05c2b156 | NDVI.png | 91 | 16×33 RGBA8 | 0 / 528 (all 0,0,0,0) | — |
| 05c2b156 | TRUE_COLOUR.png | 91 | identical bytes to NDVI.png | 0 / 528 | — |
| 05c2b156 | NDVI.analysis.tif | 522 | 16×33 Float32, EPSG:3857, res 8.125×10 m, no GDAL_NODATA tag | — | 0 / 528 (all -9999) |
| 53128d1c | NDVI / TRUE_COLOUR .png | 92 | 16×30 | 0 / 480 | — |
| 53128d1c | NDVI.analysis.tif | 520 | 16×30 | — | 0 / 480 |
| 89beffcb | NDVI / TRUE_COLOUR .png | 93 | 16×32 | 0 / 512 | — |
| 89beffcb | NDVI.analysis.tif | 521 | 16×32, res 7.5×10 m | — | 0 / 512 |

Survey of every saved v5/v6 NDVI + True Colour asset for the vineyard (123 files):
- 1 Aug: 0/8 NDVI displays and 0/8 analysis files contain data. One True Colour file has pixels but is 16×25 while its v6 row says 16×33 (bytes from another version).
- 30 Jul, 27 Jul, 25 Jul: 0 visible pixels in every file.
- 22 Jul: 4/8 displays have 32–171 visible pixels; 0/8 analysis files have valid cells.
- 20 Jul: one paddock, 133 visible pixels, 2 valid analysis cells.

There is no saved date with usable coloured NDVI across the vineyard.

## Root cause

1. **Provider returned no data for every pixel.** RGB is 0 as well as alpha, so the
   provider's output was `[0,0,0,0]` (dataMask = 0). The legacy polygon mask only scales alpha.
   Every analysis cell is -9999 too, independently of the mask. Why the provider returned
   no data for this window can't be confirmed without a provider call.
2. **QC gate deliberately bypassed.** In `satellite-process-scene`, when the coverage statistics returned no
   samples, `validCoveragePct` stayed `null`. Rejection only happens when coverage is
   below the threshold *and* catalogue cloud is above 40%. The catalogue cloud was 0, so the scene was accepted.
   `100 - null` then recorded `paddock_cloud_cover_pct = 100`.
3. **Nobody inspected the output before saving it.** The render was uploaded with `upsert: true`, the asset row
   upserted, and the scene marked `complete`. The manifest counts asset rows, so the date showed 8/8.
4. **Storage files shared between versions.** Storage paths had no processing version. 313
   storage paths are shared by more than one processing version: v6 overwrote v3 objects in place, so
   v3 rows now describe bytes they never produced (16×25 record vs 16×33 bytes). This is why
   matching file hashes (eTags) appear across v3 and v6 and across all ten indices. Fully transparent PNGs of
   the same size compress to identical bytes.

## Corrections

- `src/lib/satelliteRasterUsability.ts`: decodes saved bytes. Verdicts are
  `verified | legacy | blank | invalid`, with checks on record dimensions, visible pixels, valid cells,
  NDVI range, native 10 m UTM grid (v7) and acquisition-linked version.
- Crop Health page: blank or invalid files are never mounted or cached, and fail without a spinner. Date coverage
  is recomputed from verdicts (`stored_blank` timeline status). Per-paddock text distinguishes
  "saved but blank" from "no capture" and "loading". The Admin panel shows pixel evidence and counts.
- v7 pipeline: after encoding, the PNG is decoded and visible pixels counted. The GeoTIFF read-back valid
  cells must be > 0 and equal the statistics count. All of this happens before any storage write.
  The proof now carries `valid_pixel_count`, `display_visible_pixel_count` and `analytical_valid_cell_count`.
- Migration `0007_satellite_raster_identity_and_blank_guard`: a trigger refuses a new or updated
  row whose `storage_path` belongs to another processing version, and v7 rows without positive byte proofs or
  a version-scoped path. Existing rows are untouched.
- Legacy `satellite-process-scene` (source only, **not deployed**): refuses blank renders and
  all-no-data analysis rasters, uses version-scoped keys with `upsert: false`, and records `null` cloud
  when coverage is unknown.

## Remaining step to coloured imagery

The saved rasters are empty, so more frontend work can't produce colour. A real recent
provider acquisition and v7 processing run is required. That run remains gated by an approved hard budget,
`SATELLITE_RUNTIME_ACCEPTED`, and all ingestion controls (currently off).
