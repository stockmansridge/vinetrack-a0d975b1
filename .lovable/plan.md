# Apple Maps token failure: findings (inspection only, nothing changed)

## Evidence
- **Deployed and live.** Just now a POST with no sign-in returned `401 {"error":"Unauthorized"}`. That reply comes from the function's own code, so it booted and ran.
- **The browser pre-check (OPTIONS) failed intermittently.** My first OPTIONS probe returned **503**. A second probe seconds later returned **200 "ok"** with the expected CORS headers from `supabase-edge-runtime`. OPTIONS to `website-analytics` returned 200.
- **Logs.** The function's own logs show only boot/shutdown events. There are no application errors and nothing containing "error". The edge-log queries returned no rows for `get-mapkit-token` or for any 5xx, so the 2026-09-27T04:00:14Z entries could not be retrieved there.
- **Secrets.** The names `APPLE_MAPKIT_PRIVATE_KEY`, `APPLE_TEAM_ID` and `APPLE_MAPKIT_KEY_ID` are all configured. Values were not read.
- **Code vs deployed.** `index.ts` returns `200 "ok"` for OPTIONS before any sign-in or secret check. The only 503 it can produce is `mapkit_not_configured`, and only on POST with missing secrets. The deployed behaviour (OPTIONS 200, POST 401) matches this source. `config.toml` has no `get-mapkit-token` block, so it uses the platform default (`verify_jwt = false`), which fits the in-code sign-in check.

## Conclusion
- The code cannot return 503 to OPTIONS, the secrets are present, and the function answers normally when warm. So the 503s were **not an application-level 503** and **not caused by missing Apple secrets**.
- The most likely cause is a **temporary platform failure** while the function was starting from idle. A 503 appeared again on a first probe today, and the next probe returned 200.
- It could not be proven whether that was a BOOT_ERROR or a gateway/runtime failure, because no log entry exists for those requests.

## Minimum corrective action
- **No code, config, secret or deploy change is needed.**
- If the map sometimes fails to load, the smallest safeguard is on the Portal side: retry the token request once after a short delay, then fall back to the street map as it does today.
- If the 503s keep happening, raise them with Lovable support as a platform issue, quoting the request IDs.
