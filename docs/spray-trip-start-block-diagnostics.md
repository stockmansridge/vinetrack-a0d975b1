# Spray Trip start-block: read-only diagnostics specification (DRAFT, not implemented)

Status: specification only. No code, SQL, RPC call, data change or publication.

## Findings (repository evidence)
- Portal Force Stop = `admin_force_stop_trip(uuid,text,timestamptz)` (sql/250, called from `src/lib/adminTrips.ts`). Repo body: updates one `trips` row (end/active/paused/tank pointers, `sync_version+1`), closes newest open linked `spray_records` row, writes one `audit_events` row. It never touches tank actuals, spray jobs, occurrences, occurrence setup scope, or any device-local queue/idempotency state. Live body unverified.
- Force Stop is not server acknowledgement of any device operation and may cause a version conflict for pending device trip updates.
- No Portal path can replace `create_trip_with_occurrences_v1`: Portal uses PostgREST RPC and service-role edge functions only (no DDL), holds no shared-project DB URL or `vinetrack_occurrence_writer` credential. A fix requires an existing owner-member session or the native deployment pipeline running PR #31 SQL unchanged (no owner/ACL change). Existence of such a credential is unverified.

## Proposed System Admin read-only panel (requires backend-owner-approved SELECT-only RPCs)
Scope: one vineyard + one trip/date. No write buttons.
1. Trip row: is_active, end_time, tank pointers, sync_version, client_updated_at; audit_events incl. admin_force_stop_trip.
2. Linked spray_records: open/closed, sync_version.
3. Tank actuals per trip/tank with server versions.
4. Occurrence setup/occurrences for vineyard/date; provided_blocks compared with lower() normalisation to show the case mismatch fixed by PR #31.
5. Acknowledgement proof: per client operation/idempotency key -> server row id + version, or "no server row". Device-local acknowledgement can only be confirmed on the device.
6. OCCURRENCE_SETUP_SCOPE_CONFLICT rejections (e.g. 2026-11-01 04:50:28Z) — needs a new log/read source.

## Gaps
Live function bodies, occurrence/tank-actual schemas and operation-key column names, shared-project log access, and on-device queue inspection.
