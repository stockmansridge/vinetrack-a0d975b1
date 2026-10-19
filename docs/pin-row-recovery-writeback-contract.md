# Pin Row Recovery — future writeback contract (DESIGN ONLY, NOT APPLIED)

Status: proposal for review by the owner and Rork (shared contract owner). No migration,
RPC or grant exists. The Portal has no write button and never calls `pins.update` or
`confirm_saved_pin_location_v2` for this workflow (that RPC needs rich capture evidence
and strict-resolver approval, and rejects existing side/placement; it is not a backfill path).

## Proposed RPC
`public.apply_reviewed_pin_row_assignments(p_batch_id uuid, p_items jsonb) returns jsonb`

- `SECURITY DEFINER`, `search_path = public`, `EXECUTE` granted to `authenticated` only.
- Authorisation inside the function: caller is a System Admin (`is_system_admin()`) **and**
  owner/manager of the pin's vineyard (`vineyard_members` via `auth.uid()`). Initially
  restricted to vineyard `fe952afe-437f-4be7-8cbf-fdd8e630411c` by an explicit allow-list.
- One transaction for the batch; per-item results returned; any item failing CAS is skipped
  (or the whole batch rolled back — owner to choose).

### Item shape
```
{ pin_id, expected_sync_version, expected_updated_at, expected_latitude, expected_longitude,
  expected_geometry_identity, paddock_id, pin_row_number, driving_row_number?, pin_side?,
  decision_source: 'measured'|'reviewed_track'|'manual_field_check', reason, reviewer_note,
  draft_reviewer, draft_reviewed_at, owner_approval_ref }
```

### Guards (all must pass, else item = conflict)
1. Pin exists, `deleted_at is null`, vineyard on allow-list.
2. CAS: `sync_version = expected_sync_version` and `updated_at = expected_updated_at`;
   latitude/longitude unchanged.
3. `row_number`, `pin_row_number`, `driving_row_number` all null; no `pin_row_segments`;
   `location_scope <> 'row'`.
4. `paddock_id` belongs to the same vineyard; `pin_row_number` exists in that block's rows;
   if `driving_row_number` supplied, `|pin_row_number − driving_row_number| = 0.5`.
5. Block geometry identity (server `pin_geometry_identity(polygon_points, rows)`) equals
   `expected_geometry_identity`, otherwise conflict → re-review. (The Portal's
   `portal-fnv1a` fingerprint is a client check only and must be replaced by the server identity.)

### Effects
- Set `paddock_id` (only if null), `pin_row_number`, optional `driving_row_number`/`pin_side`.
- Never modify `latitude`, `longitude`, `snapped_*`, capture evidence or trips.
- Bump `sync_version` and `updated_at` so mobile clients pick up the change via normal sync CAS.
- Insert one immutable audit row per item into a new `pin_row_assignment_audit` table:
  before/after JSON, batch id, idempotency key (`batch_id`+`pin_id`), actor, owner approval
  reference, decision source, reason, timestamp. Re-running the same batch is a no-op.

## Rollout gates
1. Owner signs off the exported draft (pin list + rows).
2. Rork reviews the contract; migration written and reviewed separately.
3. Dry-run mode (`p_dry_run`) returns would-apply/conflict counts matching the Portal preflight.
4. Only then a guarded Portal button, System Admin only, Stockman's Ridge only.
