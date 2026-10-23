# Roadmap

## Portal costing/report correction
- [x] Correct headline Cost / ha to unique physical scope area; preserve cumulative treated area and totals. 58 focused regressions passed and preview build OK; authenticated live report remains blocked by unavailable shared-vineyard session. No publication.
- [x] Exclude retained allocations of soft-deleted parent trips from shared reporting reads; verify active-trip preservation and focused regressions without data writes or publication.
- [x] Include normal Work Tasks with component-level pruning/trip deduplication.
- [x] Share evidence-based area/block allocation resolution across both reports; no conversion of row equivalents to invented hectares.
- [x] Count distinct trips and run focused reconciliation regressions; no production writes or publication.
- [ ] Verify Stockman's Ridge live report reconciliation — blocked: managed preview has no auth users and no available shared-vineyard session; owner-supplied figures are covered by an offline fixture only.

## Tractor photo automation
- [x] Add Edit Tractor upload preview only; search controls and external Google Images link removed at owner request; 4 focused tests passed, unpublished.
- [ ] Connect shared photo saving and background removal — blocked on ChatGPT's separate photo cache/storage contract and enforced A$20 spending guard; no equipment-record changes or publication.
- [ ] Approve the owner-supplied Google/New Holland image leads for use — original official T4 N photos found and downloaded for inspection; front-view candidate visibly tractor-only. Still held on exact 2021 generation and reuse permission: New Holland Terms of Use prohibit reproduction/derivative works without authorisation. No assets added, processing, equipment writes or publication.
- [ ] Gather and verify attachment-free exact-match images for Stockman's Ridge only — owner screenshot supplies Kubota 7580 (1996) and New Holland T4.N (2021). Public-source checks found no compliant licensed match: T4.N is a series requiring its exact numbered N badge; Kubota 7580 cannot yet be verified as M7580 or tied to the 1996 generation. Waiting on exact model badges/confirmation and licensed attachment-free sources. No paid searches or processing until the shared spending guard is enforced.
- [x] Leave unmatched photo cells blank and reject unverified/attached photos; removed ineligible Fendt from live catalogue; 15 tests and preview build passed; unpublished.
- [ ] Extend to Tamburlaine after successful Stockman's Ridge acceptance, then all equipment after successful Tamburlaine acceptance — waiting on pilot results.
- [ ] Find verified photos automatically for newly added tractors and retrofit existing tractors — Parallel connected, owner-approved A$20 combined monthly ceiling; blocked on a durable shared photo cache/atomic spending guard (ChatGPT owns all SQL); no paid searches or activation, no shared tractor record changes.
- [x] Remove the existing verified reference photo background; transparent PNG confirmed, 12 focused tests passed, preview build OK; unpublished.

## Stage 1 capture-time reconstruction hardening
- [x] Correct prepared 267/268 capture-history, numeric-row and isolation safeguards; no live SQL.
- [x] Run offline known-row holdout and historical/real-format regressions (83 SQL checks, 70 Portal tests).
- [ ] Produce live read-only proposal — blocked: shared VineTrack read access or an authorised scoped export is unavailable.
- [x] Document exact acceptance blockers and handoff; no approvals, writes or release.

## Replacement Crop Health ingestion
- [ ] Complete disabled exact-item discovery, one-layer native processing, verified publication, privilege hardening and synthetic end-to-end tests; deploy only dormant ingestion/manifest functions.
- [ ] Supply an opt-in external scheduler artifact without registering or enabling a schedule.
- [x] Correct backlog/activity truth and bound saved-delivery diagnostics.
- [x] Apply isolated additive service-only queue/control/budget/provenance foundation.
- [x] Implement and deploy inert machine worker/discovery and admin diagnostics; verify disabled receipts without provider calls.
- [x] Implement exact-item native-grid primitives and offline rejection/golden tests; disclose operational runner/publication blockers.
- [ ] Register schedules — blocked: existing project has no managed cron-auth helper/structured HTTP scheduling capability.
- [ ] Activate a production-capable exact raster runner — blocked: hard budget, runtime benchmark and compatible publication contract acceptance.
- [x] Request publication of corrected frontend after tests; rollback and remaining capped-pilot requirements recorded in docs/crop-health-ingestion-foundation-release.md. Hosted publication completion remains unverified.

## Irrigation valve import
- [x] Add valve-only file preview and import using existing valve creation permissions and RPC; no sessions, systems or connections imported.
- [x] Verify validation, selected-vineyard scope and partial-import safety with focused offline tests; no production imports performed.

## Admin activity drill-down
- [x] Make activity Vineyard/User counts open named, period-matched read-only lists using existing access; disclose creator attribution and restricted results.
- [x] Verify aggregation, access/error states and dashboard click flow with offline tests (9 passed); authenticated shared-data access remains unverified.

## Crop Health blank saved imagery
- [x] Decode real 1 Aug 2026 Stockman's Ridge bytes (read-only): display PNGs 100% transparent, NDVI TIFFs 100% -9999; v3/v6 rows share overwritten storage keys.
- [x] Usable-imagery gate: decoded pixel/cell verdicts drive date coverage, per-paddock status and Admin diagnostics ("saved but blank" vs "no capture" vs "loading").
- [x] v7 publication fails closed on blank output (worker + DB trigger); cross-version storage-key reuse refused; legacy processor source fixed (blank render, version-scoped keys, null coverage).
- [ ] Deploy legacy satellite-process-scene fix — needs owner approval (calls paid provider; prior bundle not exportable).
- [ ] Coloured imagery — needs a real recent provider acquisition and processing run under an approved hard budget and SATELLITE_RUNTIME_ACCEPTED.

## Crop Health emergency recovery release
- [x] Prioritise bounded saved-display loading, cancellation, validation and honest failures.
- [x] Preserve same-version pairing and incomplete-summary reporting; stop mount-triggered backfill.
- [x] Run focused offline regressions; report authenticated acceptance and deployment/commit boundaries.
- [x] Deploy only satellite-get-manifest after authorised release; 51/51 offline tests passed and hosted preview build succeeded at source 5369d3df23aa38920eec694d3437f77fa734d656. Frontend publication requested; completion not yet verified.
- [ ] Live Stockman's Ridge acceptance — needs an authenticated shared-vineyard System Admin session; eight NDVI overlays, v6 pairing, 1 Aug acquisition, partial packages and no job activation remain unverified.
- [ ] Automatic daily imagery ingestion — requires separately approved implementation and defined usage budgets; no schedules or processing activated.

- [x] Remove Target Nutrient's System Admin selector gate; retain non-saving preview and unsupported-record safeguards.
- [x] Remove Analysis Details; contextual label/liquid questions, preserve inputs and validate nitrogen/live results (99 tests passed).
- [x] Simplify Target Nutrient preview; validate immediate calculations, known-basis safety and existing modes (92 tests passed).
- [ ] Signed-in Target Nutrient phone visual check — blocked by unavailable vineyard-account session; browser reaches Sign In.

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

## Navigation presentation
- [x] Style Yield & Harvest cross-links as buttons matching Records, Analytics and Comparison
- [x] Style the Spray Equipment cross-link as a matching button
- [x] Reorganise all 28 System Admin destinations into concise collapsible groups without changing routes or permissions

## Row map workspace
- [x] Row setup maps: apply contour 1×/2×/4× overzoom to New Block Step 3 Rows and existing block Rows tab (Apple first; Esri fallback with tile overzoom).
- [x] Map-dominant layout on New Rows, existing Rows and contour editor: full-width/height map, floating hide/show settings panel, Full screen + Escape, dialogs stay on top, narrow-screen panel.
- [x] User Activity: Portal telemetry (portal-web/web) + client filter

## Contour/row setup usability
- [x] Draft-vs-active explainer, numbered steps, prominent Start trace
- [x] Delete row (confirmed, by stable ids) and numbering-only Update row numbers
- [x] First/last row number labels at row start (normal previews already; contour groups added)
- [x] Tabbed floating settings: contour Groups/Setup/Row edit/Review; normal Rows Layout/Vine counts/Summary
- [ ] Signed-in visual check as System Admin (not done)
- [x] Scout Reports & Vintage Notes Portal frontend (2026-10-19): /observations/scout-reports (+:visitId) and /observations/vintage-notes under Pins & Observations; read-only scouts, add-only notes; honest RLS-restricted states; SQL proposal docs/vineyard-insights-rls-proposal.md AWAITING Jonathan's approval — not executed.
- [x] Vineyard Costings: Estimated Yield tab — cost/t by block & variety, SQL 221 estimate defaults, in-memory scenario overrides with reset
