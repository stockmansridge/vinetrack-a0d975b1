# Stage 1B — Cross-platform VineTrack feature reconciliation (read-only)

Comparison sources inspected:

- Portal: this repository (`stockmansridge/vinetrack-a0d975b1`) — `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/pages/**`, `src/lib/dataCoverageQuery.ts`, `src/lib/systemAdmin.ts`.
- Mobile: `stockmansridge/rork-vinetrack-june26` @ `main` (downloaded tarball, read-only) —
  - iOS: `ios/VineTrack/**` (611 Swift files), notably `App/NewMainTabView.swift`, `App/OperationalToolCatalog.swift`, `App/OperationsHubView.swift`, `LegacyImported/Views/**`.
  - Android: `android-vinetrack/app/src/main/java/com/rork/vinetrack/**`, notably `ui/main/Navigation.kt`, `ui/main/MainScaffold.kt`, `ui/main/OperationalToolCatalog.kt`, `ui/screens/**`.

No application code, SQL, schema, permission or navigation changes were made in this stage.

---

## 0. Headline corrections to the Stage 1 portal audit

Stage 1 concluded that **Disease Risk** and **Optimal Ripeness** were "missing". That was a portal-only statement. Both are shipped, production mobile features. Corrected platform statuses:

| Feature | Stage 1 said | Stage 1B truth |
| --- | --- | --- |
| Disease Risk | missing | iOS · Android (portal: not implemented) |
| Optimal Ripeness | missing | iOS · Android (portal: not implemented) |
| Fertiliser Calculator | portal, admin-intent, reachable | iOS · Android · Web (mobile: all roles; web: hidden-but-reachable — see §7) |
| Irrigation Advisor | portal calculator | iOS · Android · Web |
| Irrigation Records | portal, capability-gated | iOS · Android · Web (all capability-gated) |
| Growth Stages | portal reports only | iOS · Android · Web |
| Yield Records | portal | iOS · Android · Web |
| Fuel Log | portal | iOS · Android · Web |
| Equipment Maintenance | portal | iOS · Android · Web |
| Pruning Tracker | portal | iOS · Android · Web |
| Work Tasks | portal | iOS · Android · Web |

### Mobile Operational Tools grid — authoritative shared catalogue

Both mobile platforms already share a stable, ID-keyed catalogue (`OperationalToolCatalog`, order matched to `sql/159 display_order`, user-customisable per device/profile). The 13 IDs are identical on iOS and Android:

`work_tasks`, `equipment_maintenance`, `fuel_log`, `irrigation_advisor`, `disease_risk`, `yield_records`, `growth_stages`, `optimal_ripeness`, `cost_reports` (requires costing entitlement), `fertiliser_calculator`, `pruning_tracker`, `irrigation_records`, `resistance_planner`.

**Recommendation:** the guide catalogue should reuse these exact IDs as `mobileFeatureKey` so the guide, mobile grid and `sql/159` preferences stay aligned.

---

## 1. Complete cross-platform feature matrix

Legend — Availability: `prod` = production-ready, `beta` = shipped but incomplete, `gated` = internal/System Admin only, `n/a` = not implemented on that platform.
Setup importance: `required` / `recommended` / `optional` / `conditional`. `Health` = contributes to setup-health score.

### Section: Core Setup

| Guide ID | Feature | iOS | Android | Web | Web route | Gate | Ready | Importance | Health | 
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `core.vineyard` | Vineyard profile & details | ✓ | ✓ | ✓ | `/setup/vineyard` | owner/manager | prod | required | ✓ |
| `core.location` | Location, GDD mode & calculation | ✓ | ✓ | ✓ | `/setup/vineyard-location` | owner/manager | prod | required | ✓ |
| `core.region_units` | Region, country, currency & units | ✓ | ✓ | ✓ | `/setup/region-units` | owner/manager | prod | required | ✓ (drives chemical jurisdiction) |
| `core.blocks` | Blocks / paddocks | ✓ | ✓ | ✓ | `/setup/paddocks`, `/paddocks` | member read, manager write | prod | required | ✓ |
| `core.boundaries` | Block boundaries (map editor) | ✓ | ✓ | ✓ | `/setup/paddocks/:id` | manager | prod | required | ✓ |
| `core.rows` | Row configuration & vine counts | ✓ | ✓ | ✓ | `/setup/paddocks/:id` | manager | prod | required | ✓ |
| `core.planting` | Varieties, clones & rootstocks | ✓ | ✓ | ✓ | `/setup/grape-varieties` | manager | prod | required | ✓ |
| `core.soil` | Soil profiles (+ NSW SEED lookup) | ✓ | ✓ | ✓ | block detail panel | manager | prod | optional | ✗ |
| `core.weather` | Weather source, station & sensors | ✓ | ✓ | ✓ | `/setup/weather` | manager | prod | required | ✓ |
| `core.equipment_tractors` | Tractors | ✓ | ✓ | ✓ | `/setup/tractors` | manager | prod | recommended | ✓ |
| `core.equipment_machines` | Vineyard machines / implements | ✓ | ✓ | ✓ | `/setup/vineyard-machines` | manager | prod | recommended | ✓ |
| `core.equipment_other` | Other equipment items | ✓ | ✓ | ✓ | `/setup/equipment-other` | manager | prod | optional | ✗ |
| `core.spray_equipment` | Spray equipment / sprayers | ✓ | ✓ | ✓ | `/setup/spray-equipment` | manager | prod | conditional (spraying) | ✓ |
| `core.chemicals` | Saved chemicals + Chemical Intelligence | ✓ | ✓ | ✓ | `/setup/chemicals` | manager | prod | conditional (spraying) | ✓ |
| `core.saved_inputs` | Saved inputs (fuel, fertiliser, misc) | ✓ | ✓ | ✓ | `/setup/saved-inputs` | manager | prod | optional | ✗ |
| `core.team` | Team, invitations & roles | ✓ | ✓ | ✓ | `/team` | owner/manager | prod | required | ✓ |
| `core.operator_categories` | Worker types / operator categories | ✓ | ✓ | ✓ | `/setup/operator-categories` | manager | prod | recommended (costing) | ✓ |
| `core.trip_functions` | Custom trip / maintenance functions | ✓ | ✓ | ✓ | via trips setup | manager | prod | optional | ✗ |
| `core.operational_prefs` | Operational preferences (season E-L, tank, yield) | ✓ | ✓ | ✓ | `/setup/operational-preferences` | manager | prod | recommended | ✗ |
| `core.irrigation_setup` | Irrigation setup (valves, zones, rates) | ✓ | ✓ | ✓ | `/irrigation/setup` | `get_irrigation_capabilities` + `is_irrigated` | prod | conditional (irrigated) | ✓ conditional |
| `core.growth_stage_config` | E-L stages enabled for recording | ✓ | ✓ | ✗ | — | manager | prod | recommended | ✗ |
| `core.growth_stage_images` | E-L reference photo library | ✓ | ✓ | ✗ | — | manager | prod | optional | ✗ |
| `core.setup_wizard` | Guided setup wizard / onboarding | ✓ | ✓ | ✓ (`/onboarding`) | `/onboarding` | authed | prod | recommended | ✗ |
| `core.quick_actions` | Button config, templates & quick actions | ✓ | ✓ | partial (pin composer types only) | `/pins` | manager | prod | optional | ✗ |

### Section: Field Workflows

| Guide ID | Feature | iOS | Android | Web | Web route | Gate | Ready | Importance | Health |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `field.pins` | Pins (drop, photo, duplicate check, directions) | ✓ | ✓ | ✓ (view/create; **close is mobile-only**) | `/pins` | member | prod | recommended | ✗ |
| `field.repairs` | Repairs | ✓ | ✓ | ✓ | `/pins` | member | prod | optional | ✗ |
| `field.observations` | Observations / growth observations | ✓ | ✓ | ✓ | `/pins` | member | prod | optional | ✗ |
| `field.manual_issues` | Manual issues (composer, detail) | ✓ | ✓ | ✓ (merged into Pins) | `/pins` | member | prod | optional | ✗ |
| `field.unified_pin` | Unified Pin / Repair / Observation composer | ✓ | ✓ | ✓ | `/pins` | member | prod | optional | ✗ |
| `field.trips` | Trips — live GPS tracking, row sequencing | ✓ | ✓ | ✗ live tracking; ✓ records | `/trips` | member | prod | recommended | ✗ |
| `field.spray_trips` | Spray trips / spray trip setup | ✓ | ✓ | ✓ records | `/spray-records` | member | prod | conditional | ✗ |
| `field.spray_jobs` | Spray jobs & guided spray wizard | ✓ | ✓ | ✓ | `/spray-jobs` | member/manager | prod | conditional | ✗ |
| `field.spray_templates` | Spray job templates & presets | ✓ | ✓ | ✓ | `/spray-jobs` | manager | prod | optional | ✗ |
| `field.work_tasks` | Work Tasks (labour, machine, piece-rate) | ✓ | ✓ | ✓ | `/work-tasks` | member | prod | recommended | ✗ |
| `field.pruning_activity` | Pruning activities & work-task linkage | ✓ | ✓ | ✓ | `/tools/pruning-tracker` | member | prod | optional | ✗ |
| `field.maintenance` | Equipment maintenance logs (+ photos) | ✓ | ✓ | ✓ | `/maintenance` | member | prod | optional | ✗ |
| `field.fuel_log` | Fuel log & fuel purchases | ✓ | ✓ | ✓ | `/fuel`, `/fuel-purchases`, `/tractor-fuel-logs` | member | prod | optional | ✗ |
| `field.irrigation_records` | Irrigation records (water applied, valves) | ✓ | ✓ | ✓ | `/irrigation` | irrigation capabilities | prod | conditional | ✗ |
| `field.growth_records` | Growth stage records (E-L observations) | ✓ | ✓ | ✓ read/report | `/reports/growth-stage` | member | prod | optional | ✗ |
| `field.damage_records` | Damage records | ✓ | ✓ | ✓ | `/damage-records` | member | prod | optional | ✗ |
| `field.yield_sampling` | Yield sampling sessions & bunch counts | ✓ | ✓ | ✓ | `/yield`, `/tools/yield-estimation` | member; financials owner/manager | prod | optional | ✗ |
| `field.picking_log` | Picking log / actual yield records | ✓ | partial (repository present, surfaced within Yield) | ✓ | `/yield` | member; price owner/manager | prod | optional | ✗ |
| `field.resistance_planner_positions` | Plan → Proposed → Actual spray linkage | ✓ | ✓ | ✓ | `/tools/resistance-planner` | manager | prod | optional | ✗ |

### Section: Operational Tools (union across all platforms)

Mobile tool ID → guide ID mapping. All 13 mobile tools are production-ready on both iOS and Android.

| Guide ID | `mobileFeatureKey` | Tool | iOS | Android | Web | Web route | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tools.work_tasks` | `work_tasks` | Work Tasks | ✓ | ✓ | ✓ | `/work-tasks` | member |
| `tools.maintenance` | `equipment_maintenance` | Maintenance Log | ✓ | ✓ | ✓ | `/maintenance` | member |
| `tools.fuel_log` | `fuel_log` | Fuel Log | ✓ | ✓ | ✓ | `/fuel` | member |
| `tools.irrigation_advisor` | `irrigation_advisor` | Irrigation Advisor | ✓ | ✓ | ✓ | `/tools/irrigation` | member |
| `tools.disease_risk` | `disease_risk` | Disease Risk (Downy/Powdery/Botrytis) | ✓ | ✓ | **n/a** | — | member (mobile) |
| `tools.yields` | `yield_records` | Yields — forecasting, sampling, recording | ✓ | ✓ | ✓ | `/yield` | member |
| `tools.growth_stages` | `growth_stages` | Growth Stage Records | ✓ | ✓ | ✓ (read/report) | `/reports/growth-stage` | member |
| `tools.optimal_ripeness` | `optimal_ripeness` | Optimal Ripeness (GDD & harvest window) | ✓ | ✓ | **n/a** | — | member (mobile) |
| `tools.cost_reports` | `cost_reports` | Cost Reports | ✓ | ✓ | ✓ | `/reports/costs` | costing entitlement / owner-manager |
| `tools.fertiliser_calculator` | `fertiliser_calculator` | Fertiliser Calculator | ✓ | ✓ | ✓ (hidden from nav — see §7) | `/tools/fertiliser-calculator` | mobile: all roles; web: intended admin-only |
| `tools.pruning_tracker` | `pruning_tracker` | Pruning Tracker | ✓ | ✓ | ✓ | `/tools/pruning-tracker` | member |
| `tools.irrigation_records` | `irrigation_records` | Irrigation Records | ✓ | ✓ | ✓ | `/irrigation` | irrigation capabilities |
| `tools.resistance_planner` | `resistance_planner` | Resistance Planner (FRAC rotation) | ✓ | ✓ | ✓ | `/tools/resistance-planner` | manager |
| `tools.customise_tools` | — | Customise Operational Tools | ✓ | ✓ | n/a | — | member (device/profile pref) |
| `tools.rain_forecast` | — | Rain & Forecast / Rainfall Calendar | ✓ | ✓ | ✓ (report only) | `/reports/rainfall` | member |
| `tools.seeding_mix` | — | Seeding Mix Calculator (+ NSW SEED soil lookup) | ✓ | partial (`SeedingDetails` model only, no calculator screen) | placeholder | `/tools/seeding-mix` | member |
| `tools.yield_determination` | — | Yield Determination Calculator | ✓ | ✓ (`YieldDeterminationPrefsStore`) | ✓ | `/tools/yield-estimation` | member |
| `tools.work_task_calculator` | — | Work Task Calculator | ✓ | within Work Tasks | ✓ within work tasks | `/work-tasks` | member |
| `tools.canopy_water_rates` | — | Canopy Water Rates | n/a | ✓ | n/a | — | manager |
| `tools.spray_tank_mix` | — | Spray / Tank Mix Calculator | ✓ (Spray Calculator) | ✓ (`SprayCalculatorScreen`) | placeholder only | `/tools/spray-tank-mix` | member |
| `tools.degree_days` | — | Degree Days / BEDD | ✓ (`DegreeDayService`, variety GDD detail) | ✓ | placeholder only | `/tools/degree-days` | member |
| `tools.block_row_calculator` | — | Block / Row calculator | ✓ (`RowInfrastructureCalculator`) | ✓ (`RowGeometry`) | placeholder only | `/tools/block-row` | member |

### Section: Maps & Vineyard Intelligence

| Guide ID | Feature | iOS | Android | Web | Web route | Gate | Ready |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `maps.vineyard_map` | Vineyard map (satellite base, blocks, pins, live location) | ✓ | ✓ | ✓ dashboard map | `/dashboard` | member | prod |
| `maps.offline_maps` | Offline map tiles / offline readiness | ✓ | ✓ | n/a | — | member | prod |
| `maps.boundary_editor` | Boundary & row geometry editor | ✓ | ✓ | ✓ | `/setup/paddocks/:id` | manager | prod |
| `maps.row_guidance` | Row guidance, trail display, compass heading | ✓ | ✓ | n/a | — | member | prod |
| `maps.crop_health` | Crop Health (NDVI / imagery intelligence) | n/a | n/a | n/a | — | — | **not implemented anywhere** — no NDVI/crop-health code found in either repo |
| `maps.satellite_mapping` | Mapping (satellite mapping workspace) | n/a | n/a | ✓ | `/tools/satellite-mapping` | **System Admin only** (`useIsSystemAdmin`) | **gated / unfinished** |

### Section: Reports & Management

| Guide ID | Feature | iOS | Android | Web | Web route | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| `reports.index` | Reports centre | partial | partial | ✓ | `/reports` | member |
| `reports.trips` | Trip reports & CSV/PDF export | ✓ | ✓ | ✓ | `/reports/trips` | member |
| `reports.work_tasks` | Work task reports | ✓ | ✓ | ✓ | `/reports/work-tasks` | member |
| `reports.pruning_activity` | Pruning activity report & charts | ✓ | ✓ | ✓ | `/reports/pruning-activity` | member |
| `reports.costs` | Cost reports (block/variety/season) | ✓ | ✓ | ✓ | `/reports/costs` | costing entitlement |
| `reports.spray` | Spray reporting & compliance export | ✓ | ✓ | ✓ | `/reports/spray` | member |
| `reports.growth_stage` | Growth stage report / PDF | ✓ | ✓ | ✓ | `/reports/growth-stage` | member |
| `reports.yield_analytics` | Yield analytics & vintage report | ✓ | ✓ | ✓ | `/reports/yield`, `/reports/yield-comparison` | member; financials owner/manager |
| `reports.irrigation` | Irrigation reports centre | ✓ | ✓ | ✓ | `/reports/irrigation` | irrigation capabilities |
| `reports.rainfall` | Rainfall history & calendar | ✓ | ✓ | ✓ | `/reports/rainfall` | member |
| `reports.documents` | Documents / stored exports | partial | partial | ✓ | `/reports/documents` | member |
| `reports.data_coverage` | Data coverage / setup completeness | n/a | n/a | ✓ | `/reports/data-coverage`, `/settings/data-coverage` | member |
| `reports.exports` | CSV / PDF exporters (pins, trips, spray, pruning, growth) | ✓ | ✓ | ✓ | various | member |

### Section: Platform & Advanced

| Guide ID | Feature | iOS | Android | Web | Route/Screen | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| `platform.ios` | VineTrack for iOS | ✓ | — | — | App Store | — |
| `platform.android` | VineTrack for Android | — | ✓ | — | Play Store | — |
| `platform.web` | VineTrack Web Portal | prompt sheet links to portal | link | ✓ | portal | — |
| `platform.offline_sync` | Offline-first sync, pending writes, sync status | ✓ | ✓ | n/a (online only) | Sync screens | member |
| `platform.offline_readiness` | Offline readiness check | ✓ | ✓ | n/a | — | member |
| `platform.biometric` | Biometric unlock (Face ID / fingerprint) | ✓ | ✓ | n/a | — | member |
| `platform.alerts` | Alerts centre, alert settings & notifications | ✓ | ✓ | n/a | — | member |
| `platform.app_notices` | In-app notices (admin-published) | ✓ | ✓ | ✓ admin authoring | `/admin/notices` | System Admin authors |
| `platform.subscription` | Subscription / entitlements / paywall | ✓ (StoreKit + `PaywallView`) | ✓ (RevenueCat, no paywall screen) | ✓ billing views | `/billing`, `/account/billing` | owner |
| `platform.support` | Contact support / support requests | ✓ | ✓ | ✓ admin triage | `/admin/support-requests` | member submit; admin triage |
| `platform.api` | External REST API (Stage 4/8 write API) | n/a | n/a | ✓ | `/settings/integrations` | owner/manager |
| `platform.webhooks` | Webhook endpoints & secrets | n/a | n/a | ✓ | `/settings/integrations` | owner/manager |
| `platform.integration_docs` | Developer docs & Postman collection | n/a | n/a | ✓ | `/settings/integrations/docs` | owner/manager |
| `platform.roles` | Roles & permissions reference | ✓ | ✓ | partial | `/team` | member |
| `platform.account_deletion` | Delete account (self-service) | n/a | ✓ | n/a | — | self |
| `platform.disclaimer` | Disclaimer acceptance | ✓ | n/a | n/a | — | all users |
| `platform.trip_audit` | Trip audit (wrong-vineyard repair) | ✓ | ✓ | n/a | — | admin/owner |
| `platform.system_admin` | Sydney Admin console (users, vineyards, flags, activity, integrations, master catalogue) | ✓ partial | ✓ partial | ✓ full | `/admin/*` | System Admin (`is_system_admin()`) |

---

## 2. Mobile-only features absent from the Stage 1 portal audit

1. Disease Risk Advisor (Downy / Powdery / Botrytis) — iOS · Android.
2. Optimal Ripeness hub (GDD progress, harvest window, per-variety GDD detail) — iOS · Android.
3. Live trip GPS tracking, row sequence planner, trail display, row guidance & compass — iOS · Android.
4. Offline-first sync engine: pending writes, sync queue diagnostics, sync status centre, offline readiness check — iOS · Android.
5. Offline map tiles / offline vineyard map — iOS · Android.
6. Biometric unlock & device sign-in settings — iOS · Android.
7. Alerts centre, alert settings and push notifications — iOS · Android.
8. Customise Operational Tools (reorder/hide tiles, persisted via `sql/159`) — iOS · Android.
9. Quick action buttons & button templates (configurable pin/action buttons) — iOS · Android.
10. E-L growth stage configuration and E-L reference image library — iOS · Android.
11. Guided in-app setup wizard (`SetupWizardView` / `SetupWizardScreen`) with costing setup section.
12. Rain & Forecast screen and rainfall calendar (portal only has the rainfall report).
13. Seeding Mix Calculator + NSW SEED soil lookup — iOS (Android has the data model only).
14. Trip audit tool (fix trips recorded against the wrong vineyard).
15. Store subscription/paywall (StoreKit on iOS, RevenueCat on Android).
16. Disclaimer acceptance flow — iOS only.
17. Self-service account deletion — Android only.
18. Canopy Water Rates — Android only.
19. Spray Calculator / tank-mix calculator as a first-class screen (portal has a placeholder only).
20. Damage records capture in the field (portal has a records page, mobile has capture).

---

## 3. iOS vs Android discrepancies

| Item | iOS | Android | Note |
| --- | --- | --- | --- |
| Operational Tools catalogue (13 IDs & order) | ✓ | ✓ | Identical — safe to treat as shared contract |
| Paywall UI | `PaywallView` (StoreKit) | none (RevenueCat manager only) | Billing UX differs |
| Account deletion | none | `AccountDeletionScreen` | Android-only |
| Disclaimer acceptance | `DisclaimerAcceptanceView` | none | iOS-only |
| Canopy water rates | none | `CanopyWaterRatesScreen` | Android-only |
| Seeding mix calculator | full calculator + NSW SEED lookup | model only | iOS ahead |
| Picking log | dedicated `PickingLogListView` | repository + sync only, surfaced inside Yield | Presentation differs |
| Navigation shell | 5 tabs + Operations/Preferences hubs | 5 tabs + More hub with `ToolGroup` (Vineyard/Operations/Records/Account) | Same destinations, different grouping |
| Growth stage images | settings view | dedicated screen + bundled images | Parity in capability |

Both platforms share identical bottom tabs: **Home · Pins · Trip · Program · Settings**.

---

## 4. Items that cannot yet be confidently classified

- `maps.crop_health` — "Crop Health" appears in the requested section list but no NDVI/crop-health implementation exists in either repository. Classify as **concept / not built**; needs a product decision before it can be a guide card.
- `tools.spray_tank_mix`, `tools.degree_days`, `tools.block_row_calculator`, `tools.seeding_mix` in the portal are `ToolPlaceholder` routes; mobile has real implementations. Guide should show `Available on: iOS · Android` and omit the placeholder web route until built.
- `field.picking_log` on Android — repository/sync exist, screen surface not independently confirmed.
- `reports.documents` on mobile — export services exist per domain, but there is no unified documents centre.
- Costing entitlement (`Requirement.costing` on mobile, `cost_reports`) vs the portal's owner/manager gate — the two gates are not proven equivalent; needs confirmation before the guide states a single permission rule.

---

## 5. Gated / internal features

| Feature | Gate | Guide treatment |
| --- | --- | --- |
| Mapping / `/tools/satellite-mapping` | `useIsSystemAdmin()` → `is_system_admin()` RPC | **Unchanged.** Card exists in the catalogue with `visibilityGate: "system_admin"` and `availability: "internal"`. Sydney Admin sees and reviews it; customers must not see it presented as an available capability. No gate changes in this stage. |
| System Admin console (`/admin/*`) | `AdminGate` / `is_system_admin()` | Guide card visible to System Admins only |
| Master Chemical Catalogue | System Admin | Internal |
| Irrigation (records, setup, reports, import) | `get_irrigation_capabilities` + `is_irrigated` | Conditional — shown only where applicable |
| Cost Reports | costing entitlement (mobile) / owner-manager (web) | Conditional |
| Financial fields (price per tonne, labour rates) | owner/manager | Note in guide, not a separate card |
| Fertiliser Calculator (web) | intended admin-only, currently only hidden from nav | Internal until §7 is resolved |

---

## 6. Final "How VineTrack Works" hierarchy

```text
How VineTrack Works
├── Core Setup
│   ├── Vineyard · Location · Region & Units
│   ├── Blocks / Paddocks · Boundaries · Rows
│   ├── Planting & Variety information (varieties, clones, rootstocks) · Soil
│   ├── Weather
│   ├── Equipment (tractors, machines, other, spray equipment)
│   ├── Team, roles & operator categories
│   ├── Spray setup (chemicals, equipment, presets)
│   └── Irrigation setup (conditional — is_irrigated)
├── Field Workflows
│   ├── Pins · Repairs · Observations · Manual issues
│   ├── Trips · Spray trips
│   ├── Spray jobs & guided wizard · Spray templates
│   ├── Work Tasks · Pruning activities
│   ├── Maintenance · Fuel log · Damage records
│   ├── Irrigation records · Growth stage records
│   └── Spray Planner (Resistance Planner: plan → proposed → actual)
├── Operational Tools  (13 shared mobile tool IDs + portal/extra calculators)
├── Maps & Vineyard Intelligence
│   ├── Vineyard map · Boundary & row editor · Row guidance · Offline maps
│   ├── Mapping (System Admin only — internal)
│   └── Crop Health (not built — excluded until decided)
├── Reports & Management
│   ├── Trips · Work tasks · Pruning activity · Costs · Spray · Growth stage
│   ├── Yield analytics · Irrigation · Rainfall · Documents · Data coverage
│   └── Exports (CSV / PDF)
└── Platform & Advanced
    ├── iOS · Android · Web Portal
    ├── Offline sync & readiness · Biometric sign-in · Alerts & notices
    ├── API · Webhooks · Integrations & developer docs
    ├── Subscription & billing · Support
    └── Sydney Admin console (internal)
```

Nothing meaningful is uncategorised.

---

## 7. Separate permission-hardening item (NOT fixed in this stage)

`/tools/fertiliser-calculator` is hidden from portal navigation but is directly reachable by any authenticated vineyard member, despite being intended as admin-only in the portal. Note that on iOS/Android the same tool is intentionally available to all roles, so the hardening decision is portal-specific.

**Action required before broader release of `/dashboard/how-vinetrack-works`:** decide the intended portal audience for the Fertiliser Calculator and enforce it at the route level (or align the portal with mobile and un-hide it). Tracked separately — deliberately excluded from guide work.

---

## 8. Recommended guide catalogue structure

A **guide-only, descriptive** catalogue. It never grants access; `AppSidebar`, route guards, `is_system_admin()`, `get_irrigation_capabilities` and RLS remain the sole authorities.

```ts
// src/lib/guide/guideCatalogue.ts  (proposed, not implemented)
export type GuideSection =
  | "core_setup"
  | "field_workflows"
  | "operational_tools"
  | "maps_intelligence"
  | "reports_management"
  | "platform_advanced";

export type GuidePlatform = "ios" | "android" | "web";

export interface GuideFeature {
  id: string;                    // stable, e.g. "tools.disease_risk"
  section: GuideSection;
  title: string;
  shortDescription: string;
  platforms: GuidePlatform[];    // drives "Available on: iOS · Android"
  webRoute?: string;             // omitted for mobile-only features
  mobileFeatureKey?: string;     // matches OperationalToolCatalog id / sql 159
  importance: "required" | "recommended" | "optional" | "conditional";
  availability: "production" | "beta" | "internal" | "planned";
  visibilityGate?: "system_admin" | "owner_manager" | "irrigation" | "costing";
  setupHealthKey?: string;       // only for genuine prerequisites
  visualKey?: string;            // illustration/icon asset key
  displayOrder: number;
}
```

Rules:

- No refactor of existing navigation in this stage; the catalogue is additive and read-only.
- `platforms` is descriptive; a missing `webRoute` renders an informational card, not a link.
- `visibilityGate: "system_admin"` hides the card from customers entirely (Mapping).
- `availability: "internal"` marks unfinished features for Sydney Admin review.

## 9. Setup-health engine (unchanged from Stage 1)

- Starting point remains `src/lib/dataCoverageQuery.ts`.
- Irrigation applicability remains `get_irrigation_capabilities` + `is_irrigated`.
- Only items with `setupHealthKey` contribute; these are limited to genuine prerequisites (vineyard, location, region/units, blocks, boundaries, rows, planting, weather, team, equipment/tractors, spray setup when spraying, irrigation setup when irrigated).
- Mobile-only operational tools (Disease Risk, Optimal Ripeness, etc.) carry **no** `setupHealthKey`: usage or availability must never inflate setup completeness.

---

## Files / repositories inspected

**Mobile (`stockmansridge/rork-vinetrack-june26`, branch `main`)**
- `ios/VineTrack/App/NewMainTabView.swift`, `OperationalToolCatalog.swift`, `OperationsHubView.swift`
- `ios/VineTrack/LegacyImported/Views/**` (Pins, Trips, Spray, SprayManagement, Pruning, Yield, Irrigation, Fertiliser, GrowthStage, Equipment, Maintenance, Management, Paddocks, Phenology, Settings, Tasks, Varieties, Vineyard, CostReports)
- `ios/VineTrack/Backend/**` (Auth, Models, Repositories, Storage, Subscription, Supabase, Sync)
- `android-vinetrack/app/src/main/java/com/rork/vinetrack/ui/main/Navigation.kt`, `MainScaffold.kt`, `OperationalToolCatalog.kt`, `HomeDashboard.kt`, `MoreScreen.kt`
- `android-vinetrack/app/src/main/java/com/rork/vinetrack/ui/screens/**`, `data/**`

**Portal (this repository)**
- `src/App.tsx`, `src/components/AppSidebar.tsx`
- `src/pages/**` (dashboard, setup, tools, reports, admin, irrigation, integrations)
- `src/lib/dataCoverageQuery.ts`, `src/lib/systemAdmin.ts`, `src/lib/vineyardAccessQuery.ts`
- `docs/how-vinetrack-works-stage1-audit.md`
