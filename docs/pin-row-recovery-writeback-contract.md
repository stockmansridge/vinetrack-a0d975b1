# Pin Row Recovery — Stage 1 writeback (Stockman's Ridge only)

Status: **prepared, NOT applied.** SQL: `sql/267_pin_row_backfill_stockmans_ridge.sql` for the shared
VineTrack database. Local Postgres harness: `sql/tests/267_*`. Portal workflow: `/admin/pin-row-recovery` →
"Owner-approved row backfill".

## Server contract (sql/267)
- `pin_row_backfill_dry_run(vineyard, items)` — per-item result, no writes.
- `pin_row_backfill_create_approval(vineyard, items)` — refuses if any item blocked; freezes items plus server
  geometry identity; stores server sha256 hash; returns `APPLY <n> PIN ROWS` phrase.
- `pin_row_backfill_apply(approval_id, items_hash, phrase)` — re-runs every check, all-or-nothing; idempotent.
- Auth: hard-coded vineyard allow-list AND `is_system_admin()` AND owner/manager membership. anon, non-members,
  workers and other vineyards are denied. Fixed `search_path`; no table write grants to `authenticated`.
- Item checks: CAS on sync_version, updated_at and raw lat/lon; no row/aisle/segments/row-scope (the 4
  preserved pins are blocked); block = saved block (or saved block is null); raw GPS inside current polygon;
  row exists; side never contradicts `pin_side` and is supplied only by `manual_field_check`; aisle adjacent
  and verified by projection; geometry identity unchanged since approval.
- Projection: raw GPS projected orthogonally onto the chosen row segment; must be inside 5–95% of the
  segment, chosen row among the two nearest, neighbour row on the pin's side, distance ≤ 0.75 × spacing.
  Non-field sources must pass projection.
- Effects: `pin_row_number`, `paddock_id` (only if null), `driving_row_number` (if verified), `pin_side`
  (only if null), `sync_version + 1`, `updated_at = now()`. `snapped_latitude/longitude` and
  `snapped_to_row = true` **only** when projection verified and no snap existed (`assigned_snapped`); otherwise
  `assigned_unsnapped`. Raw lat/lon, existing snaps, capture evidence and trips are never changed.
- Immutable `pin_row_backfill_audit` (before/after/projection per pin).

## Rork must confirm before apply
iOS and Android must read `pin_row_number`, `driving_row_number`, `pin_side`, `snapped_latitude`,
`snapped_longitude` and `snapped_to_row`, accept server `sync_version` bumps, and resolve offline edits
against the bumped version safely (no overwrite of the server row with a stale local copy). Confirm whether a
pins trigger already bumps `sync_version` (sql/267 sets it explicitly) and whether `pin_placements` derives
row/side from these columns.

## sql/268 — server three-input reconstruction (algorithm `pbf-recon-v2`, prepared, NOT applied)
- `pin_row_reconstruction_report(vineyard)` (read-only, same auth as 267): one entry per missing pin with GPS,
  travel and Left/Right components (availability, quality, provenance), block source, capture-time geometry,
  bounding rows, aisle, derived vine row and snap (labelled `derived`, `authoritative=false`), plus counts
  by combination, tier and combination×tier. Tiers: technically_supported, needs_review, missing_side,
  missing_direction, missing_block, preserved, field_confirmed. Device heading is logged, never used.
- Dry-run gate: `reviewed_track`/`measured` items are blocked unless the server tier is
  technically_supported and row/aisle/side match it; `manual_field_check` requires a recorded
  `field_confirmation {observed_by, observed_at, method, note}`. Approvals freeze the reconstruction hash;
  apply is blocked if it changed. Audit `projection.reconstruction` stores the evidence.
- Capture geometry comes exclusively from `public.pin_location_geometry_history`, scoped to the pin's
  vineyard and exact saved block, with `valid_from <= captured_at < valid_to` (null end is open).
  No interval, overlapping intervals, missing evidence hash, multiple capture-evidence rows or a hash
  different from `public.pin_geometry_identity(polygon_points, rows)` cause a hold. The history's legacy
  `geometry_hash` is reported separately, never rewritten or treated as a canonical hash.
- Known-row diagnostics compute local segment aisle, travel+side row and raw/saved-snap distance without
  changing saved data. Both `{number,startPoint,endPoint}` and `{rowNumber,start,end}` are supported for
  calculations; canonical hashes always use the original JSON. Fractional physical rows are rejected,
  never rounded despite the live `numeric` column. Nonadjacent bounding row numbers are held, not offset.
- Deterministic immutable-ID order assigns alternating known-row records to comparison and held-out
  partitions. At least ten records in each partition, no unavailable capture evidence and zero row/aisle
  mismatches are required. These thresholds are conservative engineering gates, not owner business rules.
  Any failure removes automatic proposals from the report and blocks non-field dry-run/approval/apply.
  This is a safety gate, not evidence that the algorithm is empirically accepted on real data.
- 267 retains its current-map projection gate. Non-field capture/current canonical identity differences
  are therefore blocked rather than attaching a historical snap to today's changed physical rows.
  Manual field confirmation is a separate explicit evidence path; this work does not approve any such batch.
- All target pins are locked before apply checks; existing metadata, CAS, hash, typed phrase and audit
  checks remain. Per-pin reconstruction independently authorises the vineyard, and linked trips and
  history are same-vineyard only. No extra client data grants are added.
- Local tests: `sql/tests/run_268.sh`: **83 passing checks** on a throwaway database;
  recovery/draft/batch Vitest regressions: **70 passing tests**. Fixtures include the supplied numeric
  column/history shape, observation keys and timestamp-free trip point fields. The canonical identity
  implementation in the harness is explicitly a test stub, **not a production function export**.

## 19 October 2026 result and concrete acceptance blocker

**No live proposal was produced.** The available read-only database connection returned no `pins`,
`pin_location_geometry_history` or canonical identity function: it is the Portal project backend,
not the shared VineTrack database. No live SQL, DDL, approval creation, application or release occurred.
There are **zero authorised proposal IDs in this delivery**; live supported-batch size is **unknown**,
not asserted to be zero. No IDs or rows have been fabricated.

Owner-supplied counts (not re-verified here): 119 missing physical rows, 71 nominal GPS + device-heading
+ side records, four partially assigned records to preserve and 261 already row-assigned records.
The nominal 71 are not qualified movement+side candidates. The May comparison had 12/31 row matches,
19/31 disagreements (61.29%); current-map inference fails acceptance. Since retained history starts
12 September, May capture-time geometry must remain unavailable unless genuine older snapshots are supplied.
Synthetic tests demonstrate both missing-history blocking and 12-match/19-mismatch blocking; they do not
reproduce or validate the real 31 pins.

**Single handoff to Rork:** supply an authorised, read-only, Stockman's Ridge-scoped snapshot of the actual
119 pins, known-row comparison pins, linked trips, capture evidence, segments, current blocks, retained
capture-time history and the actual canonical identity function definition/types/grants/trigger definitions.
Do not run 267/268 on live data to obtain this snapshot. Use it offline to verify schema and canonical
hash parity, preserve the fixed known-row partition, and produce the exact per-ID proposal report.
Until this is supplied and the held-out comparison passes, no automatic batch is acceptable.

The prepared report returns exact immutable ID, proposed block, bounding rows, aisle, vine row, projected
and saved snaps, quality/holds, source provenance, revisions, nominal-input count and validation cohort.
`approved_batch` is always null; `supported_batch` is filtered by validation. Only a subsequent explicit
owner authorisation of a concrete exported batch can permit preparation of a live approval.
Rork must separately verify the production canonical function signature/hash semantics, existing sync
triggers and iOS/Android offline conflict behavior before any separately approved writeback/release.
