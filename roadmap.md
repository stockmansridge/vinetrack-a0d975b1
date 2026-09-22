# Roadmap

- [x] Complete paused trips — add "Complete Trip" action (owner/manager/supervisor) on Trips page
- [x] Make Pins / Repairs / Observations and Field Trips detail sheets 50% width like Work Tasks
- [x] Verify build passes
- [x] Weather display units follow Region & Units metric/imperial selector (rainfall, temperature, wind) across dashboard, weather settings, rain calendar, rainfall report
- [x] Confirm System Admin menu/routes are visible to system admins only
- [x] Invite User: audit worker-type payload (role-independent, optional) + regression tests
- [x] Seasonal yield estimates: Portal consumes `get_season_yield_base_overview` (SQL 221), calls `refresh_pruning_yield_estimates` after calculator saves, applies the existing vintage-filtered damage engine behind the Apply Damage toggle. See mem://features/seasonal-yield-estimate-contract.md
- [x] Guide Content steps: support up to 3 screenshots per step (admin editor + public guide rendering)
- [x] How VineTrack Works: clicking any guide image opens it in a centred lightbox

- [x] Fix work_task_types sort_order NOT NULL on create
- [x] New Task Log drawer widened to 50% (removed max-width cap)
- [x] Pins / Repairs / Observations page: default Vintage filter to "All vintages"
- [x] Field Trips page: allow editing the Trip name
- [x] Field Trips: update the detail header name immediately while editing Title / details
- [x] Field Trips: fix repeated Trip name edits reporting saved without persisting the new value
- [x] System Admin: add gated Maintenance Mode settings and login message
- [x] Complete vineyard-wide Pin Colour identity, precedence, renderer and refresh parity
- [x] Block Setup map: Apple-only provider, stable vineyard framing, compact block summary with full-details action


- [x] Email List: edit a subscriber's name and email address
- [x] Website Analytics: canonical page-view table (sql/243 awaiting Rork), public website-analytics endpoint, admin-website-analytics server-side report, /admin/website-analytics Portal page

## Newsletter Builder (System Admin)
- [x] Newsletter tables on the Portal backend (campaigns / frozen versions / recipients), service-role only
- [x] admin-newsletters + admin-newsletter-send Edge Functions (system-admin verified server-side)
- [x] Audience union of Current Users + Newsletter Subscribers, deduped, suppression applied
- [x] Block editor, Product Update + Blank templates, desktop/mobile preview, test sends
- [x] Send now with confirmation, scheduling, idempotent batched delivery
- [ ] Per-newsletter open/click reporting from the email service logs (later phase)

## Live Dashboard Weather Forecast
- [x] Replace the 7-day strip with a provider-neutral, five-day aligned forecast and genuine 4-hour temperature/wind trends
- [x] Add vineyard-scoped client-side Rain/Wind/Humidity presentation highlights with regional-unit editing
- [x] Preserve live observations, provider selection, operational alert thresholds, and mobile/backend contracts
- [x] Add focused forecast-model, bucketing, persistence, unit, threshold, and timezone tests
