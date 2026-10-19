# Revise Crop Health ingestion design (document only)

Scope: update `docs/crop-health-ingestion-design.md` only. No code, SQL, data, cron, function or provider changes. No live provider requests. Crop Health Maps layout and diagnostics unchanged.

## Document changes

1. **Provider-independent architecture** — new section defining three interfaces: `DiscoveryProvider` (find acquisitions for a paddock and date window), `SpectralAccessProvider` (fetch bands/masks for one exact acquisition) and `Processor` (indices, paddock clipping, cloud/valid-pixel stats, asset writing). Copernicus is the first adapter; Earth Search (AWS) and Digital Earth Australia slot in behind the same queue and the same Crop Health page. Required provenance per asset: provider, collection, original acquisition/product ID, processing baseline, band source, cloud-mask method, reflectance correction, native resolution, CRS, algorithm version.

2. **Provider comparison** — table for Copernicus, Earth Search and DEA covering Sentinel-2A/B/C availability, native band resolution, latency, quality masks (SCL, s2cloudless, fmask), processing needs, service limits, estimated cost and coverage outside Australia (DEA is Australia-only). Notes: DEA NBART and Copernicus L2A reflectance are not numerically interchangeable, so series never mix providers without a labelled break; Earth Search requires applying STAC `raster:bands` scale/offset (including the baseline 04.00 offset). Figures not verified this session are marked "to confirm in benchmark".

3. **Processing budget** — replace the 200-unit daily quota. Budget per provider in processing units, request rate, worker wall-clock seconds, transfer and storage. Worked example: one full acquisition across eight paddocks ≈ 248 units. Two lanes: a reserved fresh lane (newest acquisitions, True Colour + NDVI first, then other indices) and a backfill lane using only leftover budget, so backfill never delays fresh imagery.

4. **Resolution and provenance** — 10 m indices (True Colour, NDVI, GNDVI, EVI, MSAVI, NDMI-free set to confirm) computed from native 10 m bands; 20 m indices (NDRE, RECI, RENDVI, NDMI, PSRI) recorded as 20 m. EPSG:3857 display grid never changes recorded resolution. Every band in an asset must come from one acquisition; mosaics are either refused or recorded with every contributing product ID. Resolution moves to per-asset metadata; scene-level resolution becomes informational only.

5. **Completeness, freshness, quality** — four separate timestamps per vineyard/paddock: last successful provider check, newest discovered acquisition, newest usable imagery, newest fully processed date (all required layers). Cloud and valid-pixel percentages calculated inside the real paddock boundary. A date is "downloaded" only when every required asset is stored and verified.

6. **Scheduling and security** — pg_cron + pg_net call the worker with a secret held in Vault, never a person's sign-in token. Atomic work claims (`FOR UPDATE SKIP LOCKED`), lease expiry with heartbeat, idempotent retry by asset key, a global per-provider throttle table and a kill switch row checked before every claim.

7. **Retry-After fix (specified, not implemented)** — CDSE numeric Retry-After is milliseconds; the narrow change converts ms correctly, with HTTP-date fallback and a cap. Listed tests: numeric ms, HTTP date, missing header, absurd values.

8. **Benchmark and acceptance** — read-only 60–90-day comparison using Stockman's Ridge (plus other test vineyards if useful), catalogue/metadata only until approved. Thresholds for: scene discovery match, asset availability, cloud-free paddock coverage, native resolution correctness, failure and retry rates, ingestion latency, estimated cost per paddock per month.

## Schema/interface changes (proposed, not applied)
- `satellite_scenes`: add `provider_product_id`, `processing_baseline`, `collection`, `acquisition_group_id`.
- `satellite_raster_assets`: add `native_resolution_m`, `display_crs`, `source_crs`, `band_source`, `cloud_mask_method`, `reflectance_correction`, `scale_offset_applied`, `algorithm_version`, `contributing_product_ids[]`, `verified_at`.
- New: `satellite_provider_budget`, `satellite_work_items` (lane, priority, lease, attempts), `satellite_ingestion_control` (kill switch), `satellite_freshness` (four timestamps).
- TypeScript provider interfaces in a shared module, Copernicus adapter first.

## Ordered implementation plan with approval gates
1. Gate A — approve this revised design.
2. Retry-After fix + tests.
3. Gate B — schema migration (additive, historical imagery untouched).
4. Provider interfaces + Copernicus adapter refactor, no behaviour change.
5. Gate C — read-only benchmark run (metadata only).
6. Work queue, leases, budgets, kill switch (disabled).
7. Gate D — enable unattended schedule for Stockman's Ridge only, field test.
8. Gate E — optional Earth Search / DEA adapters.
9. Gate F — wider rollout.

Unknowns listed explicitly: provider quotas/costs, DEA licensing for non-Australian use, worker time limits, Vault access from the worker.
