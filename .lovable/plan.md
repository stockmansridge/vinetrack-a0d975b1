# Investigation findings and recommended fix: User Activity inactivity and expired-trial read-only mode

No code was changed. These are findings from the Portal source. The shared database functions are not in this checkout, so anything about them is marked unconfirmed.

## 1. User Activity "Inactive 30d/90d"

### Where each value comes from (src/pages/admin/AdminUserActivityPage.tsx)
- Last login: `admin_list_user_login_activity().last_sign_in_at` (lines 342-357). This is the time the user last signed in, not the time they last used the app. A phone that stays signed in for months never moves it.
- Last seen / latest client / device / OS / version: the same RPC's `last_client_seen_at`, `last_app_type`, `last_device_model`, `last_os_*`, `last_app_version` (166-190, 374-400).
- Platforms used: `admin_user_activity_platforms()` returns one row per user and app type with `last_seen_at` (134-155). This is grouped in src/lib/userActivityQuery.ts, which does not recalculate anything.
- Status badge: shows the RPC's `status` field as-is (109-115, 403-414). Adding the platform data afterwards does not change it (435-442).
- Summary cards ("Inactive 90d+" and others) are calculated in the Portal from `last_sign_in_at` only (488-497).
- The Inactive 30d / Inactive 90d filters are also calculated from `last_sign_in_at` only (540-545).

### The defect
- Confirmed: the inactive cards and filters ignore `last_client_seen_at` and every platform `last_seen_at`. A user who used the mobile app yesterday but last signed in 4 months ago counts as "Inactive 90d+".
- Likely but unconfirmed: the server-side `status` uses the same login-only rule. Its SQL is not in the repo. The owner or ChatGPT needs to read the deployed definition to confirm.

### Canonical timestamp to use
`last_activity_at = max(last_sign_in_at, last_client_seen_at, max(platforms[].last_seen_at))`, ignoring nulls.
- Mobile and Portal heartbeats both write through `record_my_client_activity`, so client-seen times cover meaningful use on both.
- Login time stays as a fallback for users with no telemetry yet, for example older app builds.
- "Never active" applies only when all three are null.

### Proposed fix
- Portal: add `lastActivityAt(row)` in src/lib/userActivityQuery.ts. Use it for the summary cards, the Inactive filters and a Portal-calculated status badge, instead of trusting `status` for inactivity. Keep showing the "Last login" column unchanged so admins can still see it.
- Rename the cards and filters to "No activity 30d+ / 90d+".
- Tests: a recent mobile `last_seen_at` with an old login shows as active. All timestamps null shows as never active. The 30-day and 90-day boundaries are tested.
- Optional SQL (owner/ChatGPT): align `admin_list_user_login_activity.status` to the same max() rule so iOS/Android admin views match.

## 2. Expired trial: read-only instead of a hard block

### What happens today
- There is no 90-day clock in the Portal. `useVinetrackAccess()` (src/lib/vinetrackAccessQuery.ts) only reads `get_my_vinetrack_access` for the Billing page.
- The hard block is `VineyardAccessGate` (src/components/AppLayout.tsx:233-240, src/components/access/VineyardAccessGate.tsx:73-83). If `get_my_vineyard_access_matrix().can_enter_vineyard` is false, it replaces the whole page with `RestrictedVineyard` (reason `expired`: "This vineyard's plan has expired"). The Account, Billing and Admin pages stay open.
- Roles are owner, manager, supervisor and operator. There is no viewer role or read-only mode. Write rules are scattered across pages (for example Team.tsx:90, the calculators).
- Writes are spread out: about 40 inserts, 73 updates, 55 deletes, 9 upserts, 164 RPC calls and 221 save actions. There is no central place every save goes through, and `revisionWrite.ts` only handles conflict checks. The Portal's data cache is set up with no global save hook (App.tsx:147).
- The checked-in SQL has no database rule that blocks saves based on subscription status. Example rules check membership only (sql/220). The comment in sql/041 says access is enforced in the app, not the database. What is actually deployed is unconfirmed.

### Recommended approach (layered)

**Server (required for real enforcement; owned by ChatGPT/Rork, SQL needs owner approval)**
1. Add `can_write` and `read_only_reason` ('trial_expired', and others) to `get_my_vineyard_access_matrix`. Keep `can_enter_vineyard = true` for expired trials. This is an additive field, so older clients that don't know it keep today's behaviour.
2. Add `public.vineyard_write_allowed(vineyard_id)`, a security-definer function that checks the subscription state.
3. Add it to the INSERT/UPDATE/DELETE database rules (not SELECT) on vineyard-scoped operational tables, and as a first-line check in every writing RPC. The error code should be fixed and recognisable, for example `VT_READ_ONLY` with code P0001 and hint 'trial_expired'.
4. Exempt anything needed to pay or leave: billing/checkout functions, profile/display name, accepting or declining invites, activity telemetry (`record_my_client_activity`), and support requests.

**Portal (central guard, once the server fields exist)**
1. VineyardAccessGate: when `can_enter_vineyard` is true and `can_write` is false, render the pages and show a slim "Read-only — trial ended" banner with a Choose plan link.
2. A new `useWriteAccess()` hook plus a `ReadOnlyProvider` context, fed from the access matrix.
3. A global save hook (QueryClient `MutationCache` `onMutate`) blocks every save before it runs while read-only and opens a `TrialEndedDialog` with your wording: "Your VineTrack trial has ended. Your data is still available in read-only mode. Purchase a subscription to make changes." The dialog has "Choose plan" (goes to /billing) and "Close" buttons. This covers all 221 save actions without editing each one.
4. A safety net: the shared error helper (friendlySaveError, plus a new `isReadOnlyError`) recognises `VT_READ_ONLY` from the server and opens the same dialog. This catches direct calls that don't go through the cache's save actions.
5. Optional polish later: disable the most-used Save/Create buttons through `useWriteAccess()`. The guard above already blocks them, so this is not required.

**Why both layers:** the Portal guard gives the friendly prompt. The database rules stop the mobile apps, old Portal builds and direct API calls, because each of the 221 save actions could otherwise slip past a check done only in the Portal.

### Compatibility risks
- Older mobile builds: once the database rules exist, their saves fail with an error message instead of the purchase prompt. Rork needs to handle `VT_READ_ONLY`. Offline sync queues on mobile could keep retrying edits that will always fail. They need a "stop retrying" rule for this error.
- Legacy and manual-grant users (`access_source` 'legacy' or 'manual'): `vineyard_write_allowed` must treat these as allowed, or long-time users get locked out. Trialing, active and (optionally) past_due should be allowed, matching sql/041.
- Team members: write access must follow the vineyard's subscription, not each member's own trial. Otherwise an operator on a paid vineyard gets blocked.
- System Admin support sessions keep the existing bypass.
- `can_enter_vineyard` defaults to true when the field is missing (vineyardAccessQuery.ts:106-114). `can_write` should default to true when missing too, so Portal and server changes can ship in any order.
- Some saves are background telemetry or preferences (user_table_preferences, the activity tracker). The global save hook needs an allow-list so they are not blocked.

## Suggested order
1. Owner/ChatGPT: share the deployed SQL for `admin_list_user_login_activity`, `get_my_vineyard_access_matrix` and the trial calculation, to confirm the open points above.
2. Portal: fix the User Activity inactivity calculation. This is Portal-only and can ship independently.
3. SQL (owner-approved): add the `can_write` field, `vineyard_write_allowed`, the write rules on database tables and RPCs, and the exemptions.
4. Portal: read-only banner, global save guard, dialog, server-error safety net, tests.
5. Rork: mobile handling of `VT_READ_ONLY`.
