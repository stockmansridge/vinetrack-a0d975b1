# Crop Health disabled foundation release

## Delivered slice
- Applied `satellite_ingestion_disabled_foundation` (`drizzle/migrations/0000_satellite_ingestion_disabled_foundation.sql`): seven service-role-only RLS tables, nullable provenance additions on scenes/assets/summaries, immutable acquisitions, unique work identity, atomic fresh-first claims, fencing/expiry, provider-global conservative reservations and durable backoff.
- Applied `satellite_verification_fail_closed` (`drizzle/migrations/0001_satellite_verification_fail_closed.sql`): missing/NULL verification fields reject publication proofs, without changing historical rows. Isolated PostgreSQL acceptance passed after both migrations.
- Deployed only `satellite-ingestion-worker`, `satellite-ingestion-discover`, `satellite-ingestion-status`. Browser status requires the existing canonical System Admin check. Worker/discovery accept a generated machine secret, never a person's JWT.
- Controls are missing/disabled and budget ceilings default to zero. The released entrypoints deliberately write idle receipts only; no catalogue, pixels, geometry, claim, storage, publication or legacy job calls. A second compile-time lock prevents accidental execution even if controls change.
- Timeline legacy outcomes are paused/not-checked backlog, not active spinners; saved manifest dates win. Legacy backfill controls are disabled. Added bounded read-only admin diagnostics and separated signer HTTP status from byte delivery/cache state.
- Offline primitives: exact Earth Search item normalization, explicit scale/offset, strict source host, bounded native-window COG reader, native 10m NDVI/True Colour, categorical SCL mask alignment and paddock-local valid/cloud statistics. These are NOT an operational deployed raster processor.

## Evidence
- 66/66 focused frontend/native-pixel tests; 3/3 isolated PostgreSQL tests execute the actual migration with claim concurrency, stale token rejection, crash recovery, idempotency, immutability, fail-closed budgets and provider-global locking.
- Direct authenticated machine dispatch returned HTTP 200 / `disabled` / `no_op=true` / `provider_calls=0` for both entrypoints; replay returned the same receipt. Invalid credentials returned 401; another vineyard returned 403.
- Worker receipt `84489870-ba92-480a-a682-3bbcb18b61ac`; discovery receipt `3a8d28de-45bb-4a30-9517-607f05d537f1`. These are manual dispatch receipts, NOT cron evidence.
- After foundation application: 127 scenes, 2387 assets, zero summaries, empty new queue, zero enabled controls. Old jobs/backlog were not seeded or changed.
- Automatic preview compilation reported `build OK`; no manual production build or standalone TypeScript check was run (platform-managed compilation only).
- Full offline suite: 2846 passed, ten failures in the same five previously identified chemical UI suites; unrelated files were not changed. Isolated database suite is run separately with `vitest.satellite-db.config.ts`.

## Known unfinished work — no activation claim
1. **Scheduler:** existing project lacks generated `cron-auth.ts` and structured managed HTTP scheduling tools. Extensions alone do not establish dispatch/auth safety. Per platform rules, no hand-authored HTTP cron SQL was used. No schedule registered; no schedule IDs or cron receipts. Platform enablement/support is required for managed callback scheduling, then verify real daily and ten-minute inert receipts.
2. **Raster execution:** no provider called, actual COG/network decoding unbenchmarked, no runtime CPU/memory acceptance. Implement exact-item discovery, boundary projection/window selection, bounded runner, analytical/display encoding, checksummed object upload/readback and fenced publication. NDVI/True Colour pixel fixtures passing are not full provider/parity acceptance.
3. **Publication compatibility:** existing same-day unique scene index and v3-only manifest helper remain unchanged. No new v7 scene/assets are published. Implement a compatible read/publish contract without overwriting historical scenes or weakening uniqueness before enabling the runner.
4. **Copernicus:** day-window/leastCC is still not acceptable proof. No product-locking API is invented. The initial exact-band candidate is Earth Search; Copernicus exact-source delivery remains unimplemented.
5. **Budget:** owner hard monthly AUD pilot limit plus request/CPU/transfer/storage/process ceilings required. Budget alone does NOT unlock the currently inert runner.
6. **Authenticated UI acceptance:** owner System Admin session/Stockman's Ridge map and diagnostics acceptance remain to be checked; no other vineyard is touched.

## Rollback
Verified source checkpoint after foundation/hardening and tests: `10e6ee6cd356b7454e5a43e622d909e597f1ddde` (subsequent documentation/publication bookkeeping may have a later checkpoint).
No rollback DDL or historical deletion. Keep controls absent/OFF and provider execution lock false; disable or independently redeploy the three new functions. Revert only the frontend corrections to the pre-foundation source checkpoint. Keep additive tables/columns inert. The old manifest/signer functions were not explicitly deployed here. Exact previous deployed bundles cannot be exported by available Cloud tooling; repository checkpoints are not verified deployed bundle backups.

## Submitted function bundle checksums
- worker: `22c7d714d8e2f44080983da6c3000de6ae9e39af442ab676869d49b19f2b3379`
- discovery: `7d1bf037400a2829b2483deca29ce83253b795bc83301ae3a11003cce6be8afa`
- status: `e6ff48b142455c2c4209fca1089154f930d49afa946b68697862181970bbcd1e`

These are submitted source/settings hashes, not exports of prior deployed bundles. No unrelated functions, mobile changes or vineyard operational inputs are part of this slice.