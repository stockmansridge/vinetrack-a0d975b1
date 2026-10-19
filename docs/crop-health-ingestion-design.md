# Crop Health Maps imagery ingestion — audit and staged replacement design

Inspection and design only. Nothing in this plan is activated until each gate below is passed and field-tested. Map layout and diagnostic UI stay unchanged.

## 1. Audit findings (confirmed in code this turn)

- `supabase/functions/_shared/satellite-cdse.ts:650-652` — `fetchWithRetry` treats `Retry-After` as seconds (`retryAfter * 1000`, capped at 20 s). If Copernicus sends milliseconds (per your doc reading), a 5000 ms hint becomes a 20 s wait, burning the edge budget. Fix: parse as ms, accept an HTTP-date form, clamp, and never multiply.
- `satellite-cdse.ts:72-98` — native resolutions declared correctly: TRUE_COLOUR, NDVI, EVI, GNDVI, MSAVI, GCI = 10 m (B02/B03/B04/B08); NDRE, RECI, RENDVI, NDMI, PSRI = 20 m (B05/B06/B8A/B11). Note PSRI uses B06 (20 m), so it is 20 m even though it also uses B02/B04.
- `satellite-process-scene/index.ts:150,176` — writes `satellite_scenes.spatial_resolution_m: 10` for every scene regardless of which layers exist. The scene row therefore implies 10 m for 20 m layers. Per-asset `native_resolution_m` is correct; the scene-level field is misleading.
- `satellite-process-scene` renders all 11 layers (display PNG + analytical GeoTIFF + statistics) in one invocation, against the ~150 s limit (comment at `satellite-backfill-analytical/index.ts:43`). Any timeout leaves a partial scene.
- `satellite-backfill-run` and `-discover` authenticate a System Admin (`admin.ok`) and forward the human `Authorization` header to `satellite-process-scene` (`backfill-run:83,151`). They cannot run unattended.
- `src/components/satellite/BackfillPanel.tsx:49-59` — a `useEffect` loops `runBackfillBatch({ batchSize: 2 })` only while the page is open; UI copy at line 160 says "in the background", which is not true.
- Production state you supplied (not re-queried by me): last scene 1 Aug 2026, no satellite cron job, one backfill job stuck `processing` since 2 Aug, 337 pending expected dates, no `satellite_backfill_settings` rows. This is consistent with the code: nothing runs unless an admin keeps the page open.
- Completeness: `refresh_paddock_manifest` already distinguishes `complete / partial / display_available / upgrade_required` per paddock, but `satellite_expected_dates.outcome = 'downloaded'` is date-level and can be set while layers are missing. Freshness (newest date) and completeness (all layers) are not reported separately.

## 2. Target architecture

```text
 pg_cron (daily 03:00 vineyard-agnostic)      pg_cron (every 10 min)
        |                                            |
  satellite-discover  ---- inserts units ---->  satellite_ingest_units (queue)
  (catalogue search only,                            |
   per opted-in vineyard,                    satellite-worker
   newest-first + bounded history)           claim 1 unit (lease) -> 1 CDSE call group
                                             -> write asset -> verify -> mark done
                                                     |
                                     manifest trigger (existing) -> freshness/completeness
```

Work unit = one (paddock, scene date, layer, asset kind). Small enough to finish in seconds, so no invocation approaches the edge limit.

## 3. Database changes (proposed SQL, not to be applied yet)

New/changed objects, all in `public`, RLS on, service-role only for writes:

1. `satellite_ingest_settings` (replaces unused `satellite_backfill_settings` or extends it): `vineyard_id pk`, `enabled bool default false`, `history_days int default 90`, `max_units_per_day int default 200`, `paused_reason text`, `paused_at`.
2. `satellite_ingest_units`: `id`, `vineyard_id`, `paddock_id`, `provider_scene_id`, `acquired_at`, `acquisition_date date`, `index_type`, `asset_kind ('display'|'analytical'|'summary')`, `priority int` (recent = high), `status ('pending'|'leased'|'done'|'skipped_cloud'|'failed'|'dead')`, `attempts`, `next_attempt_at`, `lease_owner uuid`, `lease_expires_at`, `last_error`, `processing_version`. Unique `(paddock_id, provider_scene_id, index_type, asset_kind, processing_version)` = idempotency key.
3. `satellite_provider_throttle` single-row-per-provider: `next_allowed_at`, `retry_after_until`, `tokens`, used by every worker before any CDSE call.
4. `satellite_ingest_runs` log: worker id, started/finished, units claimed/completed/failed, http 429 count — for monitoring.
5. Functions (SECURITY DEFINER, `search_path=public`, EXECUTE to `service_role` only):
   - `claim_ingest_unit(p_worker uuid, p_lease interval)` — `UPDATE … WHERE id = (SELECT id … WHERE status IN ('pending','failed') AND next_attempt_at <= now() AND vineyard enabled AND not paused ORDER BY priority DESC, acquisition_date DESC FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`; also reclaims `leased` rows with expired lease (crash recovery).
   - `complete_ingest_unit(id, worker, status, error)` — only succeeds if `lease_owner = worker`; failures set exponential `next_attempt_at`, `dead` after N attempts.
   - `reserve_provider_slot(provider)` — atomically checks/advances `next_allowed_at`; returns wait ms or 0.
   - `record_provider_backoff(provider, until)` — sets `retry_after_until` from a 429.
6. Retire stuck state: one-off, reviewed statement to mark the 2 Aug backfill job `expired` and convert pending `satellite_expected_dates` into queue units (or leave them as history). Not run until approval.
7. Cron jobs via the managed HTTP schedule tools (not raw SQL): `satellite-discover` daily (1/day), `satellite-worker` every 10 min (144/day — costs Cloud uptime; justified only while queue has work; worker exits immediately when empty). Created disabled-equivalent: functions return early unless a global kill-switch row says enabled.

## 4. Edge functions

- `satellite-discover` (new): cron-auth via `authenticateCronRequest`; for each enabled vineyard, catalogue search last 10 days plus one history slice per run (newest-first, up to `history_days`); compute paddock-local cloud/valid coverage via a cheap Statistics call on SCL/dataMask clipped to the paddock; enqueue units only for scenes passing coverage; store `skipped_cloud` with the measured value otherwise. Records `provider_scene_id`, `acquired_at`, and `acquisition_date` in the vineyard's timezone (scene-date provenance).
- `satellite-worker` (new): cron-auth; loop until ~60 s budget: `reserve_provider_slot` -> `claim_ingest_unit` -> render one layer/asset -> upload -> **verify** (HEAD storage object, size > 0, dimensions match, GeoTIFF header parse) -> upsert `satellite_raster_assets` / summaries -> `complete_ingest_unit`. On 429: read `Retry-After` as ms, call `record_provider_backoff`, release unit, stop.
- `_shared/satellite-cdse.ts`: fix `Retry-After` (ms), make retry budget caller-controlled, remove internal long sleeps from worker paths.
- `satellite-process-scene`: kept for manual admin use, but refactored to enqueue units and optionally drive the worker once; stop writing scene-level `spatial_resolution_m: 10` — write the minimum native resolution actually present, or null.
- Isolated secret: cron uses the managed cron bearer only; the VineTrack service key stays server-side; no human JWT is forwarded anywhere.

## 5. 10 m vs 20 m handling (exact rule)

- 10 m native (TRUE_COLOUR, NDVI, EVI, GNDVI, MSAVI, GCI): request at 10 m; `native_resolution_m = 10`.
- 20 m native (NDRE, RECI, RENDVI, NDMI, PSRI): analytical GeoTIFF and statistics requested at 20 m; `native_resolution_m = 20`. Display PNG may be resampled to the shared 10 m display grid for edge alignment, stored with `display_resolution_m = 10` and `native_resolution_m = 20`. UI/diagnostics label it "20 m data shown on 10 m grid", never "10 m". Statistics are always computed on the native 20 m grid, never on the upsampled display.
- Scene-level resolution field is not used for claims.

## 6. Completeness vs freshness

- Freshness = newest `acquisition_date` with at least the display layer for a paddock.
- Completeness = all required (layer, asset kind) units `done` and verified for that date.
- A date is `downloaded` only when complete; otherwise `partial` with the missing list. Manifest already has the counts; the worker refreshes it via existing triggers.

## 7. Monitoring and alerts

- Admin diagnostics read `satellite_ingest_runs` and queue counts (UI unchanged now; data only).
- Alert (email via existing transactional email) when: no successful worker run in 24 h while queue non-empty; any vineyard freshness older than 10 days with clear-sky scenes available; dead units > threshold; provider paused > 6 h.

## 8. Rollout (each step gated)

1. Code-only: Retry-After fix + tests; no behaviour switch.
2. Apply schema (tables/functions) with kill switch off; no cron.
3. Deploy discover/worker; invoke manually with cron auth against one test vineyard.
4. Field test one vineyard: enable settings row, create schedules, observe 7 days.
5. Expand to opt-in vineyards with quotas; replace BackfillPanel loop with a read-only queue status (copy correction).
6. Retire old backfill functions after 30 days parity.

## 9. Tests and acceptance

- Unit: Retry-After parse (ms, absent, HTTP-date, huge); claim race (two workers, one unit); expired lease reclaim; idempotent re-run produces no duplicate assets; dead after N attempts; quota stop; paused vineyard skipped.
- Resolution: 20 m layers store native 20 and display 10; statistics on native grid; no 10 m label for 20 m layers.
- Completeness: a missing NDMI keeps the date `partial`.
- Acceptance: 7 consecutive days unattended with freshness ≤ revisit + cloud gap; zero overlapping leases; 429 count bounded; no human token in logs.

## 10. Unknowns

- Exact `Retry-After` unit actually returned by CDSE Processing vs Statistics APIs (verify from a logged response before trusting either).
- CDSE quota (processing units/requests per minute) for this account.
- Whether managed HTTP schedule tools are available on this project (pre-support projects may lack `authenticateCronRequest`).
- Paddock geometry lives on the VineTrack backend; discover needs a stable read path and cache.
- Whether SCL-based paddock cloud statistics fit the per-call budget for large vineyards.
- Desired history depth and quota per vineyard (business decision).
