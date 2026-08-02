# Crop Health Maps — aligned imagery + automatic date backfill

This is a large change spanning imagery processing, a new backfill job engine, a scheduled
job, and Crop Health Maps UI. It is planned in four phases so each one is testable on its own.

## Phase 1 — Aligned, polygon-clipped imagery (fixes the overlapping dark rectangles)

Goal: every paddock renders as a clean shape, no rectangles, no stacked darkening.

- Snap every raster to one shared grid: fixed CRS (EPSG:3857), fixed resolution per index
  (10 m native, fixed display metres/pixel), and a bbox snapped to whole-pixel multiples of
  that resolution from a global origin. Two touching paddocks then share exact pixel edges.
- Bake a true alpha mask into the display raster: the provider evalscript already returns
  `dataMask`; extend it so pixels outside the saved paddock polygon return alpha 0, and
  clip the request geometry to the polygon itself rather than the bbox.
- Client rendering: draw each paddock overlay with its baked alpha only, never the
  rectangular bounds; remove any translucent polygon fill drawn on top of imagery, and give
  overlays a single deterministic z-order (sorted by paddock id) so stacking is stable.
- Mosaic first, clip second: when a capture date has more than one provider tile touching a
  vineyard, request the date as one mosaicked composite (`mosaickingOrder`) so seams do not
  appear inside a paddock.
- Duplicate protection: unique index on
  `(vineyard_id, paddock_id, provider, acquisition_date, index_type, asset_type,
  processing_version)` for raster assets, with processing upserting on that key.
- Bump `PROCESSING_VERSION` so old, unaligned assets are superseded rather than mixed in.

## Phase 2 — Expected-date discovery and outcome recording

- New table `satellite_expected_dates` keyed by
  `(vineyard_id, paddock_id, index_type, expected_date)` with an `outcome` column:
  `pending, available, downloaded, processing, no_provider_capture, cloud_obscured,
  invalid_coverage, failed, retry_pending`, plus `attempts`, `next_retry_at`, `last_error`.
- Discovery derives expected dates from the existing configured provider cadence and the
  configured historical limit — no hard-coded dates in the UI. It compares expected dates to
  saved imagery and records gaps *between* saved dates, not only dates newer than the latest.
- Terminal outcomes (`no_provider_capture`, `cloud_obscured`, `invalid_coverage`) are never
  re-requested; `failed` becomes `retry_pending` with exponential backoff.
- Cloudy/unavailable dates stay visible in history as unavailable.

## Phase 3 — Persistent backfill job engine (runs without the browser)

- New table `satellite_backfill_jobs`: vineyard, requested paddocks, index type, newest and
  oldest date checked, missing dates found, completed/skipped/failed counts, status
  (`queued, discovering, downloading, processing, completed, completed_with_warnings,
  failed, cancelled`), started/completed times, last error, heartbeat.
- New edge function `satellite-backfill-run` processes one small batch per invocation and
  re-enqueues itself: newest missing date first, all paddocks for that date before moving
  backwards. Idempotent, resumable, and guarded by a per-vineyard advisory lock so two runs
  cannot process the same vineyard/date.
- Priority order: latest imagery, then recent gaps, then older gaps, then retry-eligible
  failures.
- Scheduled per-vineyard check (pg_cron) runs the same engine on the configured cadence, so
  the page never needs to be open.

## Phase 4 — Crop Health Maps UI

- "Check for New Imagery" now runs discovery and, when historical gaps exist, shows the
  confirmation dialog:
  "Fill missing imagery dates? VineTrack will check the latest available imagery first, then
  work backwards to fill gaps… You can leave this page while the work continues."
  with Cancel / Start Backfill and an "Automatically check for and fill missing dates in
  future" checkbox (default on for system admins during beta).
- Refresh panel reports dates *and* paddocks: current capture date, dates completed x of y,
  paddocks completed x of y, per-paddock status rows, totals for downloaded / unavailable /
  failed, and estimated remaining. Closing the panel does not cancel the job.
- Timeline states: available, processing, cloud/shadow unavailable, no provider capture,
  failed, not yet checked. A date only reads "available" once every selected paddock has a
  processed image or a recorded unavailable outcome; partial dates read
  "Imagery available for 6 of 8 paddocks" and render only the completed paddocks — never
  stretched or substituted from another date.

## Technical notes

- New tables live on the Crop Health backend project alongside `satellite_scenes` and
  `satellite_raster_assets`, with RLS + GRANTs (service_role write, system-admin read via
  the existing edge-function gate).
- Reprocessing at the new alignment version is done by the backfill engine itself, so no
  separate migration job is needed; current imagery stays usable while it runs.
- Existing functions touched: `satellite-process-scene` (grid snapping, polygon mask,
  mosaicking, upsert key), `satellite-get-manifest` (per-date outcome states),
  `satellite-refresh-job` (job-type reuse). New: `satellite-discover-dates`,
  `satellite-backfill-run`.

## Suggested build order

Phase 1 first — it fixes the visible defect on the screenshot and is independently
shippable. Then 2, 3, 4.
