# Disabled exact-acquisition pilot implementation — 19 October 2026

## Delivered and deployed
The runnable discovery → durable queue → bounded native-grid NDVI/True Colour → private checksum readback → lease-fenced atomic publication path is implemented for Stockman's Ridge only (`fe952afe-437f-4be7-8cbf-fdd8e630411c`). Discovery resolves exactly eight active canonical paddocks, searches at most seven fresh days, selects one exact item per paddock/day, and never imports legacy backlog. No production acquisition was discovered or processed.

Earth Search validation requires L2A item/product identity, UTC datetime, explicit calibration and per-band projection/shape/transform, common exact product paths, native 10m grids, aligned categorical 20m SCL and a single closed footprint. COG source metadata must equal immutable STAC metadata after canonical JSON hashing (including PostgreSQL jsonb readback). All analytical statistics use native paddock cells; geographic display pixels are independently inverse-mapped. v7 hover sampling uses TIFF UTM coordinates, not display bounds; legacy hover behavior remains unchanged.

Private immutable content-addressed PNG/float32 GeoTIFF writes are downloaded and SHA-256 checked before publication. Partial writes remain unpublished; retries reuse verified objects. Publication locks the task and same-day scene, rejects stale lease tokens and conflicting historical scenes, inserts assets/statistics/task verification/manifest atomically. v7 requires NDVI display + analytical + summary and True Colour display; legacy packages retain their previous requirements.

## Applied migrations
- `0002_satellite_service_privilege_hardening.sql`: explicit browser/PUBLIC privilege revocation on service tables/RPCs; service-role access retained.
- `0003_satellite_pilot_day_selection.sql`: service-only RLS day selection table and idempotent two-layer enqueue.
- `0004_satellite_pilot_fenced_publish.sql`: lease-fenced atomic publication, same-day history preservation.
- `0005_satellite_v7_manifest_compatibility.sql`: conditional verified v7 manifest requirements; legacy behavior unchanged.
- `0006_satellite_reservation_null_rejection.sql`: all resource inputs mandatory, requests and conservative per-unit spend strictly positive; missing/null/zero values reject reservations.

No operational rows, historical imagery, old queue or permission roles were changed. No new browser role/admin storage mechanism was added.

Only these functions were deployed:
| Function | Final submitted source/settings SHA-256 |
| --- | --- |
| satellite-ingestion-worker | `11c5e362b2ab658ace225550a7de6a390a8aba278cf92a53ed6dc17ab79a0d99` |
| satellite-ingestion-discover | `b8575e8fa1fb56f595fa0592d8555c47727a3ebe6dd887be50cd13332440c18c` |
| satellite-get-manifest | `2d75007f7a21948c0c963a01febb19c38aa7c9846b354517ed5307e7c54c1760` |

Status/signer/other modules were not redeployed. An initial npm GeoTIFF deployment had a Node `vm` boot dependency; corrected by the licensed browser-targeted geotiff@3.0.5 bundle. Final deployed synthetic decoder and dormant callbacks returned 200. Earlier boot errors are historical, not final acceptance evidence.

## Acceptance evidence
- 7/7 Deno integration scenarios using actual PostgreSQL migrations/RPCs through PGlite and mocked provider/private storage: full eight-paddock NDVI/True Colour completion, v6 preservation, concurrent workers/global budget slot, zero quotas/off controls/browser denial, corrupted/partial storage, boundary staleness, 429 persisted backoff, malformed provenance/grid/calibration, cancellation, crash/expired-lease recovery, day selection conflict and wrong-token publication.
- 66/66 focused frontend/native/saved-imagery tests; 3/3 isolated baseline database tests.
- Deno entrypoint and external scheduler type checks passed; platform-managed frontend compilation reported `build OK`.
- Final deployed in-memory raster self-test: synthetic=true, provider_calls=0, native_resolution_m=10, NDVI mean=0.5, valid_pixels=16, verified_assets=2. This does not write production storage or publish scenes.
- Final manual machine dispatch receipts: worker `13f50afe-d840-4c5f-a26a-bda97da3e262`; discovery `d9b9aba0-3aef-4698-af3e-d9c1b7ec16ff`. Both HTTP 200, disabled, no_op=true, provider_calls=0. These are NOT cron receipts.
- Invalid machine tokens rejected 401; manifest invalid credentials rejected 401. Authenticated System Admin manifest/UI acceptance was unavailable (managed requests returned unauthorized), not claimed passed.
- Final read-only production counts: 127 scenes, 2387 assets, zero summaries/acquisitions/new work; zero enabled controls, zero hard monthly spend allowance and zero satellite cron jobs. No real catalogue/pixel request occurred.

## Scheduler and remaining pilot gates
External Cloudflare template: `scheduler/satellite-pilot/{worker.ts,wrangler.toml}` with encrypted machine binding, deterministic dispatch IDs, disabled flag and commented-only daily discovery/ten-minute worker triggers. Manual-only GitHub alternative: `.github/workflows/satellite-pilot-dispatch.yml`. Neither is configured/deployed; no active cron, schedule ID or actual scheduled receipt exists.

All controls remain OFF and quotas ZERO. Additional runtime attestation `SATELLITE_RUNTIME_ACCEPTED` must be explicitly true before execution. Conservative positive per-discovery/per-work AUD ceilings (`SATELLITE_DISCOVERY_UNIT_MAX_AUD`, `SATELLITE_WORK_UNIT_MAX_AUD`) and durable monthly request/process/CPU/transfer/storage/spend ceilings are mandatory. Reservations charge the full worst-case envelope before work and intentionally do not refund unused capacity; approval must cover this conservative accounting model. No quota values or runtime attestations were provisioned here.

Before activation: owner must approve a hard monthly AUD budget and all resource ceilings/unit cost envelopes; verify canonical geometry/member bindings, private bucket access, authenticated v7 UI/manifest acceptance, provider metadata against one authorized exact item and bounded runtime performance; provision scheduler credentials/rotation and verify real idle scheduled receipts while controls stay OFF. Real provider latency/CPU/memory acceptance is untested, so synthetic acceptance is not a paid-processing activation claim. Other vineyards and historical bulk backfill remain prohibited.

## Rollback
Source checkpoint after implementation: `9790c48bc403ad1acfe3f6011d2483dd93deb1d9` (documentation may advance checkpoint). Keep every control OFF, budgets ZERO and runtime attestation absent/false; disable external dispatch if subsequently provisioned. Retain additive schema/data; do not delete history or drop queue tables. Independently restore reviewed frontend/function source if required, with v7 reads guarded. Exact previous deployed bundles are not exportable through available Cloud tooling; source checkpoints/checksums are not verified prior deployed rollback bundles. No frontend publish action was requested in this continuation; hosted serving-version acceptance remains unverified.