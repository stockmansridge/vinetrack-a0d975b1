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
