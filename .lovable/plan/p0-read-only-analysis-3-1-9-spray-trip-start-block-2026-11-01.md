# P0 read-only analysis: 3.1.9 Spray Trip start block

No code, SQL, function calls or publishing were done. Evidence comes from repository files only. I did not read the live shared-project definitions.

## 1. What Portal "Force Stop Trip" (Hard Stop) does

How it's called: `src/lib/adminTrips.ts` `useForceStopTrip` calls `admin_force_stop_trip(p_trip_id, p_reason, p_end_time)` on the shared VineTrack client (`iosSupabase`). The repository definition is in `sql/250_admin_trip_support_recovery.sql` (lines 238-349). The live body is unverified.

Per the repository definition:
- Gates: `is_system_admin()` must pass and a reason is required. It locks the `trips` row (`deleted_at IS NULL`, `FOR UPDATE`).
- Idempotent: if the trip is already ended and inactive with no tank pointers, it returns `already_completed` and writes nothing.
- `trips` UPDATE sets `end_time` (the existing value wins, otherwise the requested time with past/start checks), `is_active=false`, `is_paused=false`, `active_tank_number=NULL`, `is_filling_tank=false`, `filling_tank_number=NULL`, `sync_version+1`, `client_updated_at=now()`, `updated_at=now()`.
- `spray_records`: only the newest open linked row (`trip_id`, `end_time IS NULL`) gets `end_time` and `sync_version+1`.
- `audit_events`: one row with the previous and resulting trip state.
- It does not touch:
  - tank actual rows
  - spray job / occurrence rows
  - occurrence setup scope or provided blocks
  - pins, paths, fills
  - any device outbox

It cannot touch device-local state:
- iOS: the unacknowledged Cab Franc 1 Nov original-occurrence create, and the pending trip and tank-actual sync queue entries.
- Android: the legacy Save-for-Later paired create.
- On either platform: local "active trip" flags, idempotency keys, retry state.

A server `trips` change gives no acknowledgement of a client operation id. Raising `sync_version` can even create a version conflict for a pending device update. So Hard Stop must not be treated as clearing either phone's blocker.

## 2. Is there an already-authorised path to replace only `create_trip_with_occurrences_v1` as its current owner?

No such path exists in this repository.
- The Portal reaches the shared project only through PostgREST/RPC (`iosSupabase` client) and edge functions that use `VINETRACK_SERVICE_ROLE_KEY`. Neither can run `CREATE OR REPLACE FUNCTION`.
- No migration runner, DB URL, or `vinetrack_occurrence_writer` credential for the shared project exists in the Portal repo.
- `SUPABASE_DB_URL` belongs to this Lovable Cloud project, not the shared project.
- No Portal file references `create_trip_with_occurrences_v1` or `vinetrack_occurrence_writer`.
- The "must be owner of function" rejection is consistent with the connected postgres role being neither the owner nor a member of it.

Every remaining route needs something outside the Portal. In each case the owner stays the same and no ACL changes:
- Someone who already holds `vinetrack_occurrence_writer` membership, or a superuser-equivalent owner session on the shared project, runs the reviewed PR #31 SQL exactly.
- Or the native repo's own deployment pipeline does it, if it already authenticates as that owner.

I could not verify whether either credential exists. That is a gap for the native/back-end owner.

## 3. Safest read-only diagnostics the Portal could show

These would be System Admin-only, read-only, and scoped to one vineyard and one trip. They would use only existing read RPCs or new SECURITY INVOKER / admin-gated SELECT-only functions, approved by the backend owner.
- Trip: the `trips` row (`is_active`, `end_time`, tank pointers, `sync_version`, `client_updated_at`) plus `audit_events` for `admin_force_stop_trip` (`admin_get_trip` already returns audit).
- Spray: linked `spray_records` (open/closed, `sync_version`).
- Tank actuals: rows per trip and tank, with server versions.
- Occurrences: setup and occurrence rows for the vineyard/date. Show the stored `provided_blocks` UUIDs normalised with `lower()` against the block ids, to show the PR #31 case mismatch.
- Server acknowledgement proof: the stored client operation / idempotency key and the server row id plus version for each device operation. The Portal can only show "server has the row" or "server has no row". It cannot prove device-local acknowledgement, which needs the device to read back that key.
- Rejection log: the `OCCURRENCE_SETUP_SCOPE_CONFLICT` entries (for example 2026-11-01 04:50:28Z) with operation key and vineyard. I have not verified this, because no Portal-accessible log read exists for them today.

## Gaps
- Live bodies of `admin_force_stop_trip` and `create_trip_with_occurrences_v1` (MD5 `b0e166d78be75c8ba770b`) were not read.
- Occurrence and tank-actual table schemas and the operation-key column names are not in this repo.
- There is no read access to the shared project's logs.
- iOS and Android local queues can only be inspected on the devices.

If approved, the next step would only be to draft a specification document for the read-only diagnostics panel. It would not touch code, SQL, or data.
