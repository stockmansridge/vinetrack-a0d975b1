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

## sql/268 — server three-input reconstruction (algorithm `pbf-recon-v1`, prepared, NOT applied)
- `pin_row_reconstruction_report(vineyard)` (read-only, same auth as 267): one entry per missing pin with GPS,
  travel and Left/Right components (availability, quality, provenance), block source, current geometry,
  bounding rows, aisle, derived vine row and snap (labelled `derived`, `authoritative=false`), plus counts
  by combination, tier and combination×tier. Tiers: technically_supported, needs_review, missing_side,
  missing_direction, missing_block, preserved, field_confirmed. Device heading is logged, never used.
- Dry-run gate: `reviewed_track`/`measured` items are blocked unless the server tier is
  technically_supported and row/aisle/side match it; `manual_field_check` requires a recorded
  `field_confirmation {observed_by, observed_at, method, note}`. Approvals freeze the reconstruction hash;
  apply is blocked if it changed. Audit `projection.reconstruction` stores the evidence.
- Local tests: `sql/tests/run_268.sh` (throwaway Postgres; 53 checks).
- Unverified against live: exact names/types of `pins.heading`, `pins.side`, `pins.trip_id`,
  `pins.created_at`, `paddocks.updated_at`, `trips.path_points` format, observation JSON keys
  (`observedAt`, `courseDegrees`, `speedMps`, `horizontalAccuracyM`), one-vs-many evidence rows per pin,
  and absence of a historical block-geometry table (historical geometry reported `unavailable`).
