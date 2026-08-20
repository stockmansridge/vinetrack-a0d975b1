# Stage 1 — "How VineTrack Works" Platform Audit (read-only)

No production code was changed. This document is the code-verified inventory for the future
`/dashboard/how-vinetrack-works` page.

## 1. Sydney Admin (System Admin) gate

**Authoritative source:** `src/lib/systemAdmin.ts`

- `useIsSystemAdmin()` → `{ isAdmin, loading }`, backed by the shared iOS Supabase RPC
  `is_system_admin()` (SECURITY DEFINER, server-side truth). Errors degrade to `false`.
- `useFeatureFlag(key)` / `useFeatureFlags()` → RPC `get_system_feature_flags()`.
- `useDiagnosticPanel(key)` = `isSystemAdmin && flagEnabled` — the established pattern for
  internal-only content inside otherwise customer-facing pages.
- `useSetFeatureFlag()` → RPC `set_system_feature_flag`.

**Route-level wrappers already available:**

| Pattern | File | Behaviour |
| --- | --- | --- |
| `RequireSystemAdmin` (Outlet wrapper) | `src/components/RequireSystemAdmin.tsx` | `loading` → "Loading…", non-admin → `NotFound` (404, does not reveal existence) |
| `AdminGate` (children wrapper) | `src/pages/admin/_shared.tsx` | `loading` → "Checking access…", non-admin → `<Navigate to="/dashboard" replace />` |
| In-page gate | `src/pages/tools/SatelliteMappingPage.tsx:3061-3062` | same as AdminGate, inline |

**Note (finding):** the `/admin/*` routes in `src/App.tsx` are **not** wrapped by
`RequireSystemAdmin` at the route level; each admin page self-gates with `AdminGate`
(`src/pages/admin/*`). `RequireSystemAdmin` is imported in `App.tsx` but currently unused.

**Recommended reuse for the new page:**

1. Navigation entry: render only when `useIsSystemAdmin().isAdmin === true` (same as the
   `{isSystemAdmin && renderGroup("System Admin", …)}` line in `AppSidebar.tsx:326`).
2. Direct URL: wrap the route element in `AdminGate` (redirect to `/dashboard`) or
   `RequireSystemAdmin` (404). For an internal page, `RequireSystemAdmin` (404) is safest.
3. No privileged render before resolution: always branch on `loading` first and render a
   neutral placeholder — never render content and then hide it.
4. Do **not** create a new admin system. `is_system_admin()` is authoritative and shared with iOS.

## 2. Full platform inventory (from `src/App.tsx` + `src/components/AppSidebar.tsx`)

Role gating comes from `src/lib/rolePermissions.ts` (`canAccessRoute`, applied both by the
`RoleRoute` outlet in `App.tsx` and by the sidebar's `visible()` filter).
Roles: `owner`, `manager`, `supervisor`, `operator`. Unlisted routes are open to all roles.
Everything under `RequireAuth` → `RequireVineyard` → `AppLayout` → `RoleRoute` is
vineyard-scoped (`VineyardContext.selectedVineyardId`).

### Dashboard
| Feature | Route | Nav | Gate |
| --- | --- | --- | --- |
| Overview | `/dashboard` | Dashboard | all roles |
| Live Dashboard | `/dashboard/live` | Dashboard | all roles |
| Block detail | `/blocks/:blockId` | deep link | all roles |
| Blocks list (alt) | `/paddocks` | deep link | all roles |

### Work
| Feature | Route | Gate |
| --- | --- | --- |
| Pins / Repairs / Observations | `/pins` (`/manual-issues` redirect) | all roles |
| Field Trips | `/trips` | all roles |
| Spray Jobs & Templates | `/spray-jobs` (`/setup/spray-presets` redirect) | FIELD_ROLES (`/spray-jobs`) |
| Work Tasks | `/work-tasks` | all roles |
| Pruning Tracker | `/tools/pruning-tracker` | all roles (system-admin extras inside) |
| Maintenance Logs | `/maintenance` | all roles |
| Yields | `/yield` | FIELD_ROLES |
| Damage Records | `/damage-records` | all roles + `src/lib/damagePermissions.ts` |
| Spray Records | `/spray-records` | FIELD_ROLES |
| Irrigation Records | `/irrigation`, `/irrigation/history` | capability `can_view_irrigation_records` |
| Irrigation record entry | `/irrigation/record` | capability `can_record_irrigation` |
| Irrigation import | `/irrigation/import` | capability `can_import_irrigation` |
| Fuel Log / purchases / machine logs | `/fuel`, `/fuel-purchases`, `/tractor-fuel-logs` | all roles |

### Equipment
`/setup/tractors` (+ `/:id`), `/setup/spray-equipment` (+ `/:id`, ADMIN_ROLES),
`/setup/vineyard-machines`, `/setup/equipment-other` (ADMIN_ROLES), `/fuel`.

### Tools
| Tool | Route | Gate |
| --- | --- | --- |
| Irrigation Advisor | `/tools/irrigation` | all roles (system-admin diagnostics inside) |
| Resistance Planner | `/tools/resistance-planner` | all roles |
| Pruning Yield Calculator | `/tools/yield-estimation` | all roles |
| Crop Health Maps (Mapping) | `/tools/satellite-mapping` | **System Admin only** |
| Fertiliser Calculator | `/tools/fertiliser-calculator` | **System Admin only** (sidebar) |
| Pruning Tracker | `/tools/pruning-tracker` | all roles (listed under Work) |
| Spray / Tank Mix Calculator | `/tools/spray-tank-mix` | placeholder (`ToolPlaceholder`) |
| Degree Days / BEDD | `/tools/degree-days` | placeholder |
| Seeding Mix Calculator | `/tools/seeding-mix` | placeholder |
| Block / Row Calculator | `/tools/block-row` | placeholder |

### Reports
`/reports` (index), `/reports/costs` (ADMIN_ROLES), `/reports/trips`, `/reports/work-tasks`,
`/reports/pruning-activity` (FIELD_ROLES), `/reports/spray` (FIELD_ROLES), `/reports/rainfall`,
`/reports/growth-stage`, `/reports/yield` (Yield Analytics), `/reports/yield-comparison`,
`/reports/documents` (FIELD_ROLES), `/reports/data-coverage` (ADMIN_ROLES),
`/reports/irrigation` (capability `can_view_irrigation_reports`).

### Setup
`/setup/region-units` (ADMIN), `/setup/vineyard` (ADMIN), `/setup/vineyard-location`,
`/setup/paddocks` (+ `/new`, `/:id`), `/setup/operational-preferences` (Growing Season),
`/setup/grape-varieties`, `/setup/chemicals` (ADMIN), `/setup/saved-inputs` (ADMIN),
`/setup/weather` (ADMIN), `/irrigation/setup` (capability `can_manage_irrigation_setup`),
`/team` (ADMIN), `/setup/operator-categories` (FIELD_ROLES), `/billing` (owner only).

### Account / Platform
`/account/billing` (only shown when `useBillingVineyards()` returns rows),
`/settings/integrations` (**owner only**), `/settings/integrations/docs`,
`/settings/integrations/:clientId`, `/settings/data-coverage` (ADMIN).
Support: `SupportRequestSheet` in the sidebar footer (no route).

### Auth / shell
`/login`, `/signup`, `/auth/callback`, `/reset-password`, `/onboarding`, `/select-vineyard`,
`/no-access`, `/unsubscribe`, `/soon/*`.

### System Admin (all self-gated by `AdminGate`)
`/admin/dashboard`, `/admin/users` (+`/:id`), `/admin/vineyards` (+`/:id`, `/paddocks/:pid`),
`/admin/blocks`, `/admin/invitations`, `/admin/pins`, `/admin/spray-records`,
`/admin/work-tasks`, `/admin/system-admins`, `/admin/billing-grants`,
`/admin/access-entitlements`, `/admin/block-troubleshooter`, `/admin/support-requests`,
`/admin/user-activity`, `/admin/integrations` (+`/:clientId`), `/admin/master-catalogue`,
`/admin/notices`, `/admin/feature-flags`, `/admin/email-diagnostics`.

### Cross-platform note
There is no portal-side platform matrix. Shared-with-mobile evidence comes from the shared
iOS Supabase project (`src/integrations/ios-supabase/client.ts`) and docs: pins (closing is
mobile-only, per the Pins page notice), trips, spray records, growth stages, damage records,
work tasks, pruning, yield/picking, chemicals and feature flags are all shared schema. A
`platforms` field on the new catalogue would be curated content, not derived from code.

## 3. Operational Tools catalogue — actual state

There is **no single "Operational Tools" catalogue object** in the portal. The two de-facto
catalogues are the `tools` / `toolsGeneral` / `toolsSystemAdmin` arrays in
`src/components/AppSidebar.tsx` and the `ITEMS` array in `src/components/GlobalSearch.tsx`.
Against the expected list:

| Expected tool | Status in code |
| --- | --- |
| Work Tasks | Exists — `/work-tasks`, but under **Work**, not Tools |
| Equipment Maintenance | Exists as **Maintenance Logs** `/maintenance` (Work group) |
| Fuel Log | Exists — `/fuel` (Equipment group) + `/fuel-purchases`, `/tractor-fuel-logs` |
| Irrigation Advisor | Exists — `/tools/irrigation` |
| Disease Risk | **Not present as a page.** Only an API scope `disease_risk:read` (`src/lib/integrationsQuery.ts:213`) |
| Yield Records | Exists as **Yields** `/yield` (Work) + Yield Analytics `/reports/yield` |
| Growth Stages | Exists as **Growth Stage Records** `/reports/growth-stage` + growth-stage picker in pins/spray |
| Optimal Ripeness | **Not present** in the portal |
| Cost Reports | Exists — `/reports/costs` (owner/manager) |
| Fertiliser Calculator | Exists — `/tools/fertiliser-calculator`, **System Admin only** |
| Pruning Tracker | Exists — `/tools/pruning-tracker` (Work group) |
| Irrigation Records | Exists — `/irrigation`, capability-gated |

Additional tools found beyond the expected list: Resistance Planner, Pruning Yield Calculator,
Crop Health Maps, plus four unbuilt placeholders (Spray/Tank Mix, Degree Days, Seeding Mix,
Block/Row).

## 4. Gated / unfinished features

| Feature | Gate | Mechanism |
| --- | --- | --- |
| Crop Health Maps (Mapping) | System Admin only | `useIsSystemAdmin()` in `SatelliteMappingPage.tsx:580`; render gate at 3061-3062 (`Navigate → /dashboard`); sidebar only adds `toolsSystemAdmin` when `isSystemAdmin`, with a "System Admin" badge (`AppSidebar.tsx:255-259`). No route wrapper, no feature flag, no entitlement. |
| Fertiliser Calculator | System Admin only (nav) | same `toolsSystemAdmin` array; route itself is not admin-gated |
| Irrigation (all surfaces) | Capability RPC | `get_irrigation_capabilities` via `useIrrigationCapabilities` + `RequireIrrigationCapability` |
| Cost/pricing data | owner/manager | `src/lib/permissions.ts` `canSeeCosts` / `useCanSeeCosts` |
| Integrations & API | owner only | `rolePermissions.ts` `/settings/integrations` |
| Billing | owner only (`/billing`); `/account/billing` shown only when billing vineyards exist |
| Diagnostic panels | System Admin **and** feature flag | `useDiagnosticPanel(key)` — flags in use: `show_pin_diagnostics`, `show_map_pin_diagnostics`, `show_weather_diagnostics`, `show_raw_json_panels`, `show_pruning_season_diagnostics` |
| Placeholders | not built | `ToolPlaceholder`, `/soon/*` ComingSoon |
| Vineyard access/entitlement | per-vineyard | `VineyardAccessGate` + `useVineyardAccessMatrix`, `useVinetrackAccess` |

**Mapping rule for the new page:** re-use `useIsSystemAdmin()` exactly. Mapping content must be
rendered only when `isAdmin`, labelled "Internal / not released", and must never appear in the
customer-facing catalogue until the tool's own gate changes. Do not fork the gate.

## 5. Proposed "How VineTrack Works" hierarchy

**A. Core Setup** — Vineyard Settings, Region & Units, Vineyard Location, Blocks/Paddocks
(boundaries, rows, row spacing/direction), Grape Varieties (+clone/rootstock), Growing Season,
Weather Settings, Equipment (tractors, spray equipment, vineyard machines, other assets),
Chemicals, Saved Inputs, Worker Types, Team & Invitations, Irrigation Setup (conditional),
Billing/Subscription.

**B. Field Workflows** — Pins / Repairs / Observations, Field Trips (spray + maintenance),
Spray Jobs & Templates (wizard), Spray Records, Work Tasks, Pruning Tracker, Maintenance Logs,
Damage Records, Yields / Picking, Growth Stage recording, Irrigation Records.

**C. Operational Tools** — Irrigation Advisor, Resistance Planner, Pruning Yield Calculator,
Fertiliser Calculator (admin), Fuel Log, plus "coming soon" placeholders (Spray/Tank Mix,
Degree Days, Seeding Mix, Block/Row). Report absent: Disease Risk, Optimal Ripeness.

**D. Maps & Vineyard Intelligence** — Vineyard Overview Map (dashboard), Blocks map/boundaries,
Pins map, **Crop Health Maps / Satellite Mapping (gated, internal)**.

**E. Reporting & Management** — Reports index, Cost Reports, Trip Reports, Work Task Reports,
Pruning Activity, Spray Records report, Rainfall, Growth Stage Records, Yield Analytics,
Yield Comparison, Documents & Exports, Data Coverage, Team management.

**F. Platform & Advanced** — Web Portal, iOS app, Android app, Integrations & API,
Webhooks, Developer Docs/Postman, Support requests, App Notices, Account/Billing,
Multi-vineyard switching and roles.

## 6. Proposed setup-health checks (data availability, nothing implemented)

| Core Setup item | Check | Existing source |
| --- | --- | --- |
| Vineyard exists | membership row + vineyard record | `VineyardContext` memberships |
| Region/units/timezone | fields set | `/setup/region-units` page queries (vineyards row) |
| Location | lat/lng set | `VineyardLocationPage`, vineyards row |
| Blocks exist | count > 0 | `fetchCount` in `src/lib/queries.ts`, paddocks table |
| Boundaries | `polygon_points` non-empty | `src/lib/paddockGeometry.ts` `parsePolygonPoints` |
| Hectares | derived area or stored area_ha | `deriveMetrics` in `paddockGeometry.ts` |
| Rows / row geometry | `rows` payload present | `paddockGeometry.ts`, `paddockRowGeneration.ts`, `paddockRowVines.ts` |
| Row/vine spacing, direction | paddock fields (`vine_spacing`, row bearing) | `paddockGeometry.ts:281`, `blockDiagnostics.ts` |
| Planting / variety data | `variety_allocations` non-empty | `dataCoverageQuery.ts` Paddock interface, `yieldAllocations.ts` |
| Weather | station configured + recent observations | `WeatherStatusPage`, davis-proxy, rainfall queries |
| Rainfall | rows present for season | `RainfallReportsPage` queries |
| Equipment | tractors / spray_equipment / vineyard_machines counts | `equipmentItemsQuery.ts`, `vineyardMachinesQuery.ts` |
| Sprayer present *when spraying used* | spray_equipment count vs spray job/record count | `dataCoverageQuery.ts` (Equipment/Spray issue groups) |
| Team | owner membership + member count + roles | `vineyard_members`, `memberManagementQuery.ts`, `invitationsQuery.ts` |
| Chemicals | saved chemicals count | `SavedChemicalsPage` queries, `masterChemicals.ts` |
| Spray config | equipment + chemicals + presets/jobs | `sprayJobsQuery.ts`, `sprayApplicationDomain.ts` |
| Irrigation applicability | capability RPC + any irrigated block | `get_irrigation_capabilities`; `blockDiagnostics.ts:206` derives `isIrrigated` from `is_irrigated` / flow / emitter fields |

`src/lib/dataCoverageQuery.ts` already computes severity-classified issues across Work Tasks,
Trips, Spray, Maintenance, Fuel, Pins, Blocks, Equipment — it is the closest existing analogue
to a setup-health engine and should be reused/extended rather than duplicated.

**Conditional rule for irrigation:** treat as `conditional` — only counts toward completeness
when `can_view_irrigation_records`/`can_manage_irrigation_setup` is true **or** at least one
block is flagged irrigated. An unirrigated vineyard should resolve to "Not applicable".

## 7. Reusable components / data sources

- Gates: `useIsSystemAdmin`, `useDiagnosticPanel`, `AdminGate`, `RequireSystemAdmin`,
  `canAccessRoute` / `getAllowedRoles`, `useCanSeeCosts`, `useIrrigationCapabilities` +
  `RequireIrrigationCapability`, `VineyardAccessGate`.
- Catalogue precedent: `GlobalSearch.ITEMS` (title/url/group/keywords/adminOnly/systemAdminOnly)
  and the `NavItem` arrays in `AppSidebar`. A shared catalogue module could feed sidebar, search
  and the new page — but converting them is Stage 2+ work, not part of this audit.
- UI: `MetricCard`, `PageHeader`, `TONE_CLASSES` (`src/components/ui/metric-card`), `Card`,
  `Badge`, `Collapsible`, `StatusPill`.
- Data: `src/lib/queries.ts` (`fetchCount`, `fetchList`), `dataCoverageQuery.ts`,
  `blockDiagnostics.ts`, `paddockGeometry.ts`, `VineyardContext`.

## 8. Gaps / decisions required

1. **No canonical Operational Tools catalogue** exists; two nav arrays disagree
   (Pruning Tracker & Work Tasks live under Work, Fuel under Equipment). Decide whether the new
   page defines the canonical catalogue and the nav later consumes it.
2. **Disease Risk** and **Optimal Ripeness** are not implemented in the portal — decide whether
   to document them as mobile-only/roadmap or omit.
3. **Fertiliser Calculator** is admin-only in nav but its route is publicly reachable by URL —
   a real gap to flag (no change made in this stage).
4. **`/admin/*` routes rely on per-page `AdminGate`**; the unused `RequireSystemAdmin` import in
   `App.tsx` suggests an intended route-level gate that was never wired.
5. **Platform (iOS/Android) coverage is not derivable from code** — will need a curated field.
6. **Setup-health has no single RPC**; a portal-side aggregate would issue many client queries.
   A future `get_vineyard_setup_health` RPC is likely warranted (explicitly out of scope now).
7. **Mapping release criteria undefined** — currently a hardcoded `isSystemAdmin` check with no
   feature flag; if Mapping should be flag-released per vineyard, a flag/entitlement is needed
   before the guide can honour "same availability rule as the platform".
8. **Weather/rainfall "available" thresholds** (how recent counts as healthy) are undefined.

## Files inspected

`src/App.tsx`, `src/components/AppSidebar.tsx`, `src/components/GlobalSearch.tsx`,
`src/components/guards.tsx`, `src/components/PermissionGate.tsx`,
`src/components/RequireSystemAdmin.tsx`, `src/components/access/VineyardAccessGate.tsx`,
`src/pages/admin/_shared.tsx`, `src/pages/tools/SatelliteMappingPage.tsx`,
`src/pages/Dashboard.tsx`, `src/pages/NoAccess.tsx`, `src/lib/systemAdmin.ts`,
`src/lib/rolePermissions.ts`, `src/lib/permissions.ts`, `src/lib/dataCoverageQuery.ts`,
`src/lib/irrigationQuery.ts`, `src/lib/paddockGeometry.ts`, `src/lib/blockDiagnostics.ts`,
`src/lib/memberManagementQuery.ts`, `src/lib/integrationsQuery.ts`,
`src/lib/vinetrackAccessQuery.ts`, `src/hooks/useCropHealthViewModel.ts`,
`src/context/AuthContext.tsx`, `src/integrations/supabase/client.ts`, plus directory listings of
`src/lib`, `src/pages`, `src/pages/admin`, `src/pages/tools`, `src/pages/reports`, `src/pages/setup`.
