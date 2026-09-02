# Roadmap

- [x] Complete paused trips — add "Complete Trip" action (owner/manager/supervisor) on Trips page
- [x] Make Pins / Repairs / Observations and Field Trips detail sheets 50% width like Work Tasks
- [x] Verify build passes
- [x] Weather display units follow Region & Units metric/imperial selector (rainfall, temperature, wind) across dashboard, weather settings, rain calendar, rainfall report
- [x] Confirm System Admin menu/routes are visible to system admins only
- [x] Invite User: audit worker-type payload (role-independent, optional) + regression tests
- [ ] BLOCKED — Seasonal yield estimates: consume DB base estimate (`get_season_yield_base_overview`) + Portal-side vintage-filtered damage engine. Waiting on Rork migration (damage_records.vintage, yield_estimation_sessions.vintage, season_yield_estimates, refresh_pruning_yield_estimates, get_season_yield_base_overview). See mem://features/seasonal-yield-estimate-contract.md
