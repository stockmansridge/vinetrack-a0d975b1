# Roadmap

## Meta trial conversion tracking
- [x] Audit complete: no Meta install found in Portal source or inspected published marketing/Portal assets; no Portal ad consent or campaign retention found. Signup, profile and vineyard creation are separate; trial-creation implementation is owned by shared backend and unavailable here.
- [ ] Confirm regional advertising consent route and shared marketing-site Pixel ID — awaiting owner choices/ID.
- [ ] Implement only verified browser tracking boundaries with durable conversion idempotency; focused tests — blocked on authoritative new-trial success evidence, consent choice and shared Pixel ID. UI success and active_trial access are not new-registration proof.
- [x] Assess server reporting: feasible only after shared backend verifies/persists eligible new-trial confirmation and stable opaque event identity; CAPI deferred, no available Meta connection, no server credentials requested yet. No runtime code changed, publication or production trials.

## Soil Analysis released workspace width
- [x] Make the landing shell, all six tabs and sample review fluid; preserve internal control/dialog constraints and local wide-table scrolling.
- [x] 339 Soil Analysis tests across 21 files passed (17 new layout checks); automatic preview compilation build OK. All six tabs and review verified with isolated fixtures at 1024/1440/1920, no page overflow or runtime errors; live signed-in data verification unavailable (session mint reports no auth users).
- [ ] Deployment requested for tested revision 691850f19161b82035d51306f361caad0d79b071; published Portal returns HTTP 200, but served app asset still lacks the new layout markers, so release completion remains unconfirmed.

## Admin dashboard soil activity (Portal only)
- [x] Move Soil Analysis into "What people are doing": soil sample and lab document rows join the SQL 257 activity table, added/edited/deleted/vineyards/users follow the same period control.
- [x] Remove the three soil dashboard tiles; soil counts stay totals only (no participant drilldown), untracked document edits/deletions show a dash, and a refused read says so instead of showing a zero.
- [x] 15 tests across 3 files passed (9 new soil activity tests); automatic preview compilation build OK. No SQL/backend/mobile changes or publication.
- [x] Soil Vineyards/Users counts now open their participant lists: read from the soil records themselves (SQL 257's participant RPC allow-lists its own tables only), busiest first, following the same period; 23 tests across 3 files passed.
- [ ] Authenticated live dashboard acceptance — blocked: portal sign-in runs against the shared iOS backend, which the preview session mint cannot authenticate, so real soil figures are unverified.


## Traffic Lights AI v4 cache refresh

- [x] Move the AI query key to v4 so whole-sample v4 responses replace cached v1/v2/v3 readings; scopes, labels, validation and UI unchanged.
- [x] 87 focused Traffic Lights tests passed and automatic typecheck clean; preview build OK.

## Traffic Lights AI v3 sample context
- [x] Accept scope result, sample_nitrogen_context or sample_context and version the AI query key to v3 so cached v1/v2 unable responses are never reused.
- [x] Label companion-measurement readings "AI sample context" with a tap-to-open explanation, keep nitrogen/result wording, confidence, reason and original Lab status; missing or malformed scope still fails safely to laboratory-only display.
- [x] 146 focused Soil Analysis tests passed (34 AI screening, 28 Traffic Lights interactions); automatic typecheck and preview build clean. Full suite: 3655 passing, 10 pre-existing chemical/spray failures in files this change never touches.
- [ ] Publish the tested v3 Portal refinement and report revision.

## Traffic Lights AI v2 provenance
- [x] Require valid response scope, label same-sample nitrogen context, and version the AI query key to exclude v1 cache.
- [x] 345 tests across 22 files passed, including 16 added v2 safeguards; automatic typecheck/build clean. Isolated desktop/mobile nitrogen-context label, Lab wording and cached toggle restoration verified without overflow/runtime errors. Live endpoint remains unverified without an external vineyard session.
- [ ] Deploy the tested v2 Portal refinement and report revision; no backend changes.

## Released Traffic Lights refinement
- [x] Add explicit latest/as-of controls, direct status filtering, clickable counts and collapsed analyte detail.
- [x] Add optional cached AI screening through the deployed endpoint only, preserving source statuses and safe errors; sorted unique ids, max 150 per call, one-hour session cache, no automatic retries.
- [x] Final regressions: 329 tests across 22 files passed. Desktop/mobile isolated fixture flow verified High-only view, raw links, labelled AI/source statuses, on/off restoration/cache and time controls; no overflow/runtime errors. Automatic preview compilation clean.
- [ ] Live endpoint/vineyard acceptance — blocked: no managed preview auth users; external vineyard session unavailable, so endpoint envelope and real classifications remain unverified.
- [ ] Publish the tested Portal refinement and report revision.

## Soil Analysis pre-release improvements
- [x] Verify existing multi-block Trends against requested block-isolation and selection safeguards (17 existing tests); implementation already complete and preserved.
- [x] Add confirmed, mapping-aware Traffic Lights latest snapshots, source-status groups, filters and eighth help topic (32 new tests).
- [x] Verify desktop/mobile Traffic Lights counts, Exceptions and sample links using isolated fixtures; no horizontal overflow/runtime errors. No backend/mobile changes or publication.
- [x] Final regressions: 296 tests across 21 files passed (32 new Traffic Lights tests, 17 retained multi-block tests); automatic preview compilation clean. Final revision reported in handoff.
- [ ] Authenticated live-vineyard acceptance — blocked: preview session mint reports no auth users; fixtures are not live verification.

## Soil Analysis multi-block Trends (Portal only)
- [x] Add analyte-filtered multi-block reads and shared block selection; preserve existing lifecycle semantics.
- [x] Render compatible series with separate per-block raw points, date averages, summaries and Block-first table; update only Trends help copy.
- [x] 261 tests across 18 files passed (17 new multi-block tests); automatic preview compilation clean. Isolated real-chart desktop/mobile verification: seven data lines, 21 raw points, eight selected blocks including No data, labelled source/derived tooltips, no horizontal overflow or runtime errors. No publication/backend/mobile changes.
- [ ] Live vineyard acceptance — blocked: preview session mint reports no auth users; authenticated Stockman's Ridge data not verified.

## Estimate source badge colours (Portal only)
- [x] Swap the two estimate-source badges so Yield Estimate Trips carries the brighter green and Pruning Estimate the deep green tint.
- [x] 43/43 tests across 3 focused Yields files (two new badge-colour safeguards); preview build OK. No SQL/mobile/unrelated changes or publication.



## Yield Estimate Trips sampled-area correction (Portal only)
- [x] Add sampledAreaHa for recorded blocks only and switch trip-table density to it; preserve totalAreaHa, route evidence, tonnes, damage and Overview rules.
- [x] 217/217 tests passed across 22 focused Yields files, including 10 trip-table tests; automatic typecheck/preview build OK. No SQL/mobile/unrelated changes or publication.

## Yield Estimate Trips table follow-up (Portal only)
- [x] Show sampled block names with full-name access and add a row-end shortcut to the existing trip drawer, without toggling inline expansion.
- [x] Seven new safeguards plus the existing drawer-flow test passed: 190/190 tests across 21 focused Yields files; automatic typecheck/preview build OK. No calculation/backend/mobile changes or publication. Inspection found an existing edge case: summary.totalAreaHa also includes selected-but-unsampled blocks, potentially diluting Per ha; left unchanged to preserve the requested calculation path and avoid altering shared summaries.

## Yields bunch weights (Portal only)
- [x] Bunch Weights tab (after Yield Estimate Trips) with variety master + block overrides via live RPCs
- [x] Remove 0.15 kg fallback from current trip calcs; resolve master weights; historical payload weight labelled
- [x] Overview: completed trip wins, weight-required state, bunch weight + coloured source labels
- [x] Trip drawer ~40vw + sample map
- [x] Grape Allocation Block column
- [x] Focused tests (204/204 across 21 yield files)


## Dashboard automatic weather refresh race
- [x] Wait for successful local observation provider resolution before automatic refresh/throttle; preserve manual path and resolver/fallback contracts.
- [x] Six new provider-neutral cases prove delayed WU/Davis/MAIT resolution without cache reread/throttle consumption, immediate refresh after resolution, five-minute throttle boundary, cross-provider isolation and unchanged manual refresh; existing resolved-none coverage retained. 187/187 tests passed across 10 files, including 17 dashboard provider tests; automatic preview compilation build OK. No backend/mobile changes or publication.

## MAIT close-out and separate WU freshness audit
- [x] Prove sensor mappings prefill from shared weather_mappings by module_id and view-only supplementary reads never call configuration; empty modules remain hidden. MAIT product behavior frozen for real-vineyard acceptance.
- [x] Audit WU refresh/read/selection/timestamp/error paths independently. Current Weather manual Refresh resolves the server selection afresh, fetches the selected provider, then rereads cached weather; mount/poll only reread. Corrected only the stale banner's unsupported one-hour/offline claim. No refresh, selection, fallback or MAIT behavior changes.
- [x] Run focused MAIT/weather/access regressions: 207/207 passed across 13 files (122 MAIT, 85 other); 7 new WU transport/freshness tests, 2 added sensor tests plus strengthened view-only test. Existing MAIT setup assertion now waits for its selection-restoring effect. Preview build OK; separate manual typecheck prohibited by harness workflow and not run. No backend/mobile changes or publication.
- [ ] Live signed-in WU diagnosis — requires the affected vineyard/station and authenticated shared-backend access; confirm selected provider, upstream response, returned observed_at/is_stale and subsequent cache read. No customer station/account cause established. Dashboard automatic stale top-up has a provider-loading/throttle timing risk; no shared behavior changed in this separate audit.

## Weather provider setup help
- [x] Restore visible Davis setup-help access in both configured states, opening the unchanged existing setup content and flow.
- [x] Add MAIT card help with seven customer setup steps and irrigation guidance; 141 weather/MAIT tests passed across 8 files (5 new help tests). Preview build OK; separate typecheck not run (automatic compilation owns that check). Isolated desktop/mobile dialog verified; no backend/mobile changes or publication.

## Weather Settings visual refinement
- [x] Match requested contained modules, compact five-column provider comparison, centred actions and source-card geometry.
- [x] 160 focused weather/provider/MAIT tests passed across 9 files; final compact card adjustment passed 7 provider tests again; preview build OK. Isolated five/two/one-column geometry and existing dialog checked without writes. Separate typecheck not run (automatic harness owns compilation). Signed-in visual comparison blocked: preview has no auth users; approved mock-up unavailable locally.
- [x] Separate source, current-weather and connection sections; retain source/fallback semantics.
- [x] Compact current readings into five desktop tiles with timestamp/Refresh header and inline rain rate.
- [x] Uniform provider summary cards with text brand treatments and explicit dialogs retaining existing forms/hooks.
- [x] 176 tests passed across 12 files; preview compilation OK; isolated provider-card desktop/dialog/mobile checks completed.
- [ ] Verify full signed-in Weather page against the approved mock-up — blocked: preview has no auth users and no mock-up image was available in inspected project/uploads.

## MAIT iNTELLiWeb Portal support
- [x] Final contract hardening: accept partial HTTP 206, raw view-only integration status, exclude DateTime sensors, dedicated selected-controller sync-state display; 78 MAIT + 78 existing regressions passed (156 total, 9 files); preview build/typecheck OK. No backend/mobile changes or publication.
- [x] Correct supplied live MAIT contracts: metric ids, nested configuration, inspect columns/latest, sync existing and module refresh; 65 MAIT tests and 78 existing regressions passed (143 total, 9 files); preview build/typecheck OK.
- [x] Add shared RPC/proxy helpers, access presentation and credential/module/channel confirmation in Weather setup.
- [x] Extend explicit local observation selection and refresh without changing legacy fallback or forecasts.
- [x] Add controller/module/valve mappings and manual three-day overlap sync in Irrigation setup; canonical source labels.
- [x] Focused safety/action tests: 90 passed across 7 files; no backend/mobile edits or deployment/publication.
- [ ] Verify signed-in MAIT connection against live responses — blocked: shared backend session/MAIT account unavailable. Supplied live configuration/metric/inspect/sync contracts are covered by exact-envelope fixtures and component save/refetch flows; no upstream MAIT requests or live imports executed.

## Deleted demo vineyards in selection
- [x] Refresh active membership reads, reject archived/missing parents, and clear stale selection after successful empty reads.
- [x] Refresh membership caches after account deletion and show incomplete-deletion errors instead of claiming vineyards were removed.
- [x] Six focused tests passed; preview build OK; no database changes or publication.
- [ ] Confirm/repair surviving demo vineyards — blocked: shared vineyard session unavailable; database cleanup requires separate owner approval.

## User Activity + expired-trial read-only
- [x] Canonical last-activity status, cards, filters, sorting; 7 tests.
- [x] Read-only vineyard mode: banner, central mutation guard, TrialEndedDialog, VT_READ_ONLY catch, allow-list; 9 tests.
- [ ] Server: can_write/read_only_reason in get_my_vineyard_access_matrix and vineyard_write_allowed enforcement — blocked: shared SQL not in repo; spec in docs/vineyard-read-only-trial-contract.md.
- [ ] Signed-in live check of expired-trial vineyard — blocked: no preview session.

## Labour Lines live-data hardening
- [x] Classify audit parents and exclude invalid children from normal aggregate reads; backend unchanged.
- [x] Add solid surfaces, review summary/status filter and historical parent details.
- [x] Run focused eligibility/report/UI regressions: 85 tests passed across 11 files; preview build OK.
- [ ] Verify Stockman's register visually with a signed-in session — blocked: no preview auth session could be minted; browser redirected to /login. Supplied 39/5/53/$1,795 figures verified by fixture, not live reads.

## Work Task labour-line register
- [x] Add vineyard-wide active Labour Lines view, filters, parent-task links and cost visibility.
- [x] Share confirmed canonical soft deletion across register and task drawer; refresh dependent totals and local drawer rows.
- [x] Run focused tests and preview checks; 44 focused tests passed and preview build OK; no SQL or publication. Broader navigation suite has an unrelated existing System Admin destination-count mismatch (30 expected, 31 actual).
- [ ] Verify signed-in register, parent drawer and removal on real data — blocked: no preview auth account/session can be minted; preview redirects to Sign In. No live records removed.

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

## Soil Analysis Stage 1 pilot (System Admin preview, Portal only)
- [x] Nav + routes gated by System Admin AND soil_analysis_admin_preview flag; hidden/blocked otherwise.
- [x] Landing tabs Overview | Soil Samples | Trends | Compare (+ disabled Reports); upload to private bucket; Review Results preserving source_* provenance.
- [x] Trend/compare comparability guards (method+unit, Colwell vs Mehlich, DTPA); lab-range-only status language.
- [x] Focused tests + build; no SQL/schema/mobile changes, no publication.
- [x] Reconciled to owner's introspected live schema (sampled_at, sample_scope, extraction_status lifecycle, size_bytes, source_value_*, key/desired_direction catalogue); upload invokes deployed soil-analysis-extract parser with sample_id+document_id, parser failure preserves records as failed; explicit Confirm writes confirmed+verified_by+verified_at; 15 MB limit.
- [x] Minimal upload dialog (file + vineyard only; parser fills metadata); retrySoilExtraction reuses existing sample/document ids, resets pending, clears extraction_error, never re-uploads or duplicates; describeFunctionError surfaces FunctionsHttpError JSON detail safely; Retry on detail page and samples list; 80 focused/nav tests + typecheck pass.
- [x] Extraction-failure presentation polish: concise main message (EXTRACTION_FAILED_MESSAGE), cleaned one-line human detail via cleanExtractionDetail (tolerant JSON parsing for pretty-printed nested errors), raw text only behind a collapsed "Technical details" disclosure (ExtractionErrorNotice) on the samples list, upload dialog, detail-page documents and retry failures; retry and evidence-preservation behaviour unchanged.
- [x] Multi-analyte Trends: searchable SoilAnalyteMultiSelect (tick list, Select all visible, Clear analytes, selections survive search); one listBlocksTrendResults query per block selection; one stacked graph section per selected analyte in catalogue order; per-analyte series/method-unit separation, no-data state and raw table preserved; help copy updated.
