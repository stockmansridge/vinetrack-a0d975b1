
# Crop Health Maps — separate saved imagery from provider refresh, add server manifest, fix locks and caching

The goal is to make the page feel instant on revisit, stop falsely labelling paddocks with visible overlays as `Imagery missing`, never call Copernicus on load, and replace the boolean-ish refresh lock with a heartbeat-backed job so a stale lock cannot wedge the page.

## What the user will see change

- Revisiting `/tools/satellite-mapping` renders paddock overlays immediately from cache; no Copernicus call fires.
- Paddocks with saved overlays show `Imagery available` (or `... · Cell data incomplete` / `... · Upgrade available`), never `Imagery missing`.
- The diagnostics block is reorganised into three clear groups: Saved imagery / Package health / Provider freshness.
- Pressing `Refresh Imagery` shows real progress (`3 of 8 paddocks checked`) rather than a red "search failed" panel when a job is already running.
- If a refresh silently died, the page auto-recovers within ~2 min via heartbeat expiry and lets the user retry.
- `Repair Missing Assets` and `Refresh Imagery` use separate locks and no longer block each other.

## Backend (Lovable Cloud / iOS project via migrations + edge functions)

New table `satellite_paddock_manifest` (vineyard_id, paddock_id, latest_display_scene_id, latest_display_acquired_at, latest_complete_scene_id, latest_complete_acquired_at, latest_processing_version, available_layer_types text[], available_analytical_types text[], missing_display_count, missing_analytical_count, missing_summary_count, package_status enum, last_provider_check_at, last_successful_refresh_at, last_asset_repair_at, updated_at). Unique (vineyard_id, paddock_id). RLS by vineyard membership. Grants + RLS as per Lovable rules.

New table `satellite_refresh_jobs` (id, vineyard_id, job_type enum: provider_refresh|asset_repair|historical_backfill, requested_by, status enum: queued|running|complete|partial|failed|cancelled|expired, started_at, heartbeat_at, completed_at, expiry_at, current_paddock_id, total_paddocks, completed_paddocks, failed_paddocks, error). Partial unique index enforcing "at most one active (queued|running) job per (vineyard_id, job_type)". `has_active_refresh_job` / `claim_refresh_job` / `heartbeat_refresh_job` / `finish_refresh_job` / `expire_stale_refresh_jobs` SQL functions (SECURITY DEFINER with membership check). Stale = heartbeat_at < now() - interval '3 minutes' OR expiry_at < now() — expiring flips status to `expired` and releases the lock.

Trigger `refresh_paddock_manifest(paddock_id)` — recomputes one manifest row from `satellite_scenes` + `satellite_raster_assets` + `satellite_index_summaries` for the current processing version. Called from AFTER INSERT/UPDATE/DELETE triggers on those three tables (statement-level, batched via changed paddock ids in transition tables).

One-time backfill migration: `INSERT INTO satellite_paddock_manifest ... FROM satellite_scenes/assets/summaries` for every paddock that has ≥1 saved scene, so existing overlays are correctly classified immediately (fixes today's "8 missing / 0 complete" screenshot).

Edge functions:
- New `satellite-get-manifest` — returns `{ manifest_version, updated_at, paddocks: [...] }` for a vineyard. Auth via VineTrack session (same pattern as existing satellite fns).
- New `satellite-refresh-status` — returns the active job for a vineyard+type or the last completed one, and calls `expire_stale_refresh_jobs` first so callers see recovered state.
- New `satellite-asset-url` — authenticated stable endpoint for a single asset id; returns a signed URL plus `ETag: {assetId}:{processingVersion}`, `Cache-Control: private, max-age=600`, `Last-Modified` from asset updated_at, and handles `If-None-Match` → 304. Used as the stable logical URL for blob caching.
- Update `satellite-process-scene` and `satellite-backfill-analytical` to (a) claim/heartbeat/finish a job row instead of a boolean flag, (b) call `refresh_paddock_manifest` at the end of each paddock, (c) return `409 { active_job: {...} }` when the same (vineyard, job_type) already has a live job — never a generic 500. Existing rate-limit + concurrency behaviour is untouched.

Assets remain immutable — identity is already (paddock_id, provider_scene_id, index_type, asset_type, processing_version). No mutation of existing bytes.

## Frontend

New `src/lib/satelliteManifest.ts` — types + `fetchManifest(vineyardId)`, `fetchRefreshStatus(vineyardId, jobType)`, `getAssetUrl(assetId)` wrappers.

New `src/lib/satelliteCache.ts` — IndexedDB (via a tiny hand-rolled wrapper, no new deps) with two stores:
- `manifest` keyed `crop-health-manifest:{vineyardId}` — value = server manifest + `updated_at`.
- `asset-blob` keyed `crop-health-asset:{assetId}:{processingVersion}` — value = `{ blob, contentType, cachedAt, etag }`.
Plus in-memory LRU for decoded analytical rasters keyed `paddockId:sceneId:indexType:processingVersion` (moved out of the page component).

Rewrite `src/pages/tools/SatelliteMappingPage.tsx` load sequence:
1. On mount, read cached manifest → render boundaries + cached overlay URLs immediately (via cached blobs → `URL.createObjectURL`). Small `Checking saved imagery…` chip.
2. Fire `satellite-get-manifest` + `satellite-refresh-status` in parallel. No `satellite-search-scenes`, no `satellite-process-scene`, no Copernicus.
3. Reconcile: if server `updated_at` newer, fetch changed asset blobs via `satellite-asset-url` (respecting ETag/304 and cached blob). Leave unchanged paddocks alone.
4. If signed URL fetch fails but blob is cached, keep displaying the cached blob and retry URL renewal in background.

Rewrite completeness/diagnostics UI to read from the manifest (not from the raw scenes/assets recount that produced the false 0/8 numbers). Statuses per paddock:
- `display_available` → `Imagery available`
- `partial` → `Imagery available · Cell data incomplete`
- `upgrade_required` → `Imagery available · Upgrade available`
- `no_imagery` → `No saved imagery`
- active provider job for that paddock → `Checking for newer imagery`
- last refresh failed but display asset still there → `Existing imagery retained · Refresh failed`

Diagnostics panel groups: Saved imagery / Package health / Provider freshness (`Last provider check`, `Paddocks checked`, `New captures found`, `Refresh currently active`). Kill the ambiguous `Missing latest` metric.

Rewrite `Refresh Imagery` handler:
- Poll `satellite-refresh-status` first. If active, render an informational progress card (not the red error panel), poll heartbeat every 5s, show `X of Y paddocks checked`.
- If no active job, call the same incremental refresh flow already built (only missing/incomplete paddocks) but now the edge function claims the job row. On completion, invalidate only affected manifest/asset cache entries.
- Admin-only submenu: `Refresh normally` / `Force provider recheck`.
- `Repair Missing Assets` uses `job_type = 'asset_repair'`, independent lock.

Overlays are never cleared during refresh — the existing overlay layer keeps its current blob URLs until a new asset is confirmed downloaded, then swaps.

Error handling: a 409 from any refresh call renders as `Imagery refresh in progress` with progress data, never as `Crop Health Maps search failed`. Only genuine Copernicus errors show the red failure state, with wording `Copernicus imagery search failed`.

## Files touched (approx)

Migrations (2): `satellite_paddock_manifest` + triggers + backfill; `satellite_refresh_jobs` + SQL helpers.
Edge functions: new `satellite-get-manifest`, `satellite-refresh-status`, `satellite-asset-url`; edited `satellite-process-scene`, `satellite-backfill-analytical`.
Frontend: new `src/lib/satelliteManifest.ts`, `src/lib/satelliteCache.ts`; edited `src/pages/tools/SatelliteMappingPage.tsx` (load sequence, diagnostics, refresh handler, status badges, error panel); light edits to `src/lib/satelliteCompleteness.ts` to consume manifest rows.
Tests: extend `src/lib/satelliteCompleteness.test.ts` with manifest-derived scenarios; add a small `satelliteCache.test.ts`.

## Out of scope

Colour ramps, hover UX, storage bucket layout, Sentinel Hub processing recipes, non-crop-health pages.

## Approval

This is a substantial change touching DB schema, edge functions and the whole page. Reply `go` to implement, or tell me which sections to trim (e.g. skip the stable-URL asset endpoint and keep only blob caching against signed URLs, or ship the frontend fixes first and defer the manifest table).
