# Portal Trip management: bounded, unpublished correction

## Audit outcome
Normal TripDetailSheet previously ended active/paused trips via an unconditional direct update in `completeTrip`, relying on a cached row. That path is now disabled. The canonical drawer adds exact selected-vineyard server status and actual signed-in membership/access reads; admin-support's UI manager fallback is not membership authority.

Repository SQL 250 defines `admin_force_stop_trip(uuid,text,timestamptz)`: System Admin-only, row lock, audit-on-change, but resets active tank/filling pointers and closes one linked open spray record. It does not prove absence of unsynced device work or pending spray occurrences. SQL 252 reconcile refuses genuinely open tanks and is not an end action. Neither contract is suitable for the requested owner/manager stale ending. No occurrence preflight contract was found. No RPC was invoked to mutate a Trip.

The connected Cloud read-only catalog has no Trip RPCs. This is NOT evidence that the shared vineyard backend lacks them. Its deployed definitions, current signed-in owner's permissions, the reported JH Testing Trip and pending device work could not be inspected live without shared-vineyard authentication. No customer rows were changed.

## Required shared-backend contract (not implemented or deployed)
- Existing authorised owner/manager endpoint with server-side membership and vineyard write-access checks; do not widen the System Admin recovery API.
- Read-only preflight that identifies exact Trip/vineyard, server sync version/status and all pending occurrence/tank/spray dependencies. Explicit mobile pending-sync acknowledgement/coordination is necessary: an online Portal cannot infer a device has no unsynced work.
- Atomic end operation locks/rechecks status and dependency state, compares the approved preflight/version, rejects conflicts and already-completed/removed/inconsistent Trips; same-transaction audit records actor, reason and before/after state.
- Preserve GPS geometry, row progress, tank-session actuals and spray records; never reopen or silently reset operational state. Define how genuinely open dependent work is resolved before ending, rather than force-closing it.
- Verify live permissions, grants and audit rollback/conflict behavior before enabling any Portal end action.

## Retained delete flow
Existing recoverable soft delete remains only for confirmed completed Trips with actual member role owner/manager/supervisor (existing delete roles), write access, known sync version and explicitly no tank filling. Confirmation fetches status/permissions again; the existing soft-delete update is now scoped to vineyard and compares version/inactive/end/fill state, returning exactly one affected id or a visible conflict. No end-time/geometry/tank/spray fields are changed. Server RLS remains authority; no new grants/policies. No server delete/pending-sync safety beyond the existing flow is claimed.

Loading/refetch/error/offline never renders cached status as current or enables delete. Poll/focus/reopen refreshes exact server reads; removed/inconsistent states fail closed. Linked Spray Records keep lifecycle actions suppressed. Unpublished; fixture tests are not live acceptance.