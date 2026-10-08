# User Activity: why Portal users never show (findings, nothing changed)

## What was traced
- Page: `src/pages/admin/AdminUserActivityPage.tsx`. `fetchUserActivity()` calls one function on the shared VineTrack (mobile) database: `admin_list_user_login_activity`. There is no filtering by platform in the Portal; filters are only vineyard, role, status, last login and search.
- Fields shown: Last login = `last_sign_in_at`; Last seen = `last_client_seen_at`; App type/version/build, OS, Device = `last_app_type`, `last_app_version`, `last_app_build`, `last_os_name/version`, `last_device_model`. Blank values render as "Not recorded". The older `app_platform/app_version/device_model` fields (support-request data) are received but not shown.
- The function's SQL is not in this repo (it lives in Rork's mobile database). A read-only probe confirmed it exists and requires System Admin, so its body and join could not be read.
- The same database has a function `record_my_client_activity` (found via a read-only name probe). This is what iOS/Android call to write app type, version, device, OS and last seen. Its parameters could not be read without signing in.
- The Portal never calls `record_my_client_activity` or any other device/session write. A search of `src/`, `sql/`, `docs/` and `supabase/` found no telemetry write. The only "portal-web" marker is `app_version: "portal-web"` in `src/lib/supportRequestSubmit.ts`, and that is support-request data only.
- Sign-in (`src/pages/Login.tsx`, `AuthCallback.tsx`, `AuthContext.tsx`) uses the mobile database's sign-in, so Portal sign-ins already update the shared `last_sign_in_at`.

## Root cause (confirmed on the Portal side)
The Portal never records client activity. So:
- Portal users are not missing. Every account is listed (192 = all accounts returned by the function).
- A Portal-only user shows a real Last login, but Last seen, App type, version, device and OS read "Not recorded".
- A user who uses both mobile and Portal keeps their last mobile values. A Portal visit can update Last login, while Last seen and App type still show iOS/Android.
- App type only ever shows ios/android because nothing writes "portal".

Not confirmed: whether the function stores only one latest row per user (which `last_*` naming suggests) and whether `record_my_client_activity` accepts an app type of "portal". Confirming this needs Rork or the SQL source.

## Options
1. **Portal-only, no SQL:** call the existing `record_my_client_activity` after sign-in and periodically while signed in, with app type "portal" and browser/OS details. This only works if the function accepts "portal". Because it stores only the latest client, this would overwrite the iOS/Android values with Portal. That loses the per-platform distinction, so it is **not recommended**.
2. **Recommended minimal safe fix (needs SQL, Rork-owned):**
   - Rork adds a per-platform activity table keyed by (user_id, app_type), plus an own-user upsert function that only uses `auth.uid()`. It accepts app_type in ios/android/portal and is server-timestamped, with no client-supplied times. Alternatively, Rork extends `record_my_client_activity` to write per-platform rows while keeping the current columns for released apps.
   - `admin_list_user_login_activity` gains per-platform columns (last seen on iOS, Android and Portal, plus Portal browser/OS). Overall "Last seen" becomes the latest across platforms. The existing columns stay so older builds keep working.
   - Portal: one small hook in the signed-in layout calls the upsert once per session start and at most every ~15 min while the tab is active. App type is "portal", the version is the build, and OS/browser come from the user agent. Last login stays the real sign-in time, never invented. The page then adds Portal columns/filters.
3. **Historical limits:** past Portal usage cannot be rebuilt. Sign-in timestamps don't say which platform, and only the latest is kept. Portal activity will only appear from deployment onward. Earlier history should show "Not recorded", not a guess.

## Is SQL / Rork required?
Yes, for a correct fix with separate per-platform sessions (option 2). The function and its source table live in Rork's mobile database. Only the small Portal call and page columns are Portal work, and they should wait until Rork's contract lands.

## Next step if approved
Write a short contract for Rork (table, upsert function, new list columns). After that, implement the Portal hook and columns. No code was changed in this investigation.
