# How VineTrack Works — Stage 5B: Customer Release Readiness

Status: **prepared, not released.** The parent route
`/dashboard/how-vinetrack-works` and every child route remain System
Admin-only (`RequireSystemAdmin` in `src/App.tsx`). The sidebar entry is
unchanged. No SQL, schema, RPC or RLS change was made in this stage.

Role-aware behaviour is implemented in `src/lib/guide/guideAccess.ts`
(pure, tested) and consumed through `useGuideViewer()`. It delegates to the
existing authorities — `canAccessRoute` (`src/lib/rolePermissions.ts`) and
`useIsSystemAdmin()` — and duplicates no permission logic.

## 1. Proposed role / visibility matrix

| Capability | System Admin | Owner | Manager | Supervisor | Operator |
| --- | --- | --- | --- | --- | --- |
| Guide routes (incl. deep links) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sidebar entry (Dashboard → How VineTrack Works) | ✓ | ✓ | ✓ | ✓ | ✓ |
| General learning content (Pins, Trips, Sprays, Work Tasks, Tools, Reports, Platforms) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Setup Health | manage | manage | manage | read-only | read-only |
| Internal/unclassified items (Mapping, Crop Health) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Setup health diagnostics | ✓ | ✗ | ✗ | ✗ | ✗ |
| Development labels ("Internal preview", availability badges, tool IDs) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Guide Images management | ✓ | ✗ | ✗ | ✗ | ✗ |

Navigation rule proposed: **System Admin ✓, Owner ✓, Manager ✓,
Supervisor ✓, Operator ✓** — the guide is education, and every role
benefits. A user with no vineyard role sees nothing (`canViewGuide` false).

## 2. Setup Health visibility recommendation

Setup Health stays visible to all roles, in two presentations:

- **manage** (Owner, Manager, System Admin) — status plus the "Open"
  action on every incomplete check.
- **read-only** (Supervisor, Operator) — identical status, but actions the
  role cannot complete are replaced with
  *"Ask an Owner or Manager to complete this setup."*

No health query was widened. Every source is already permission-scoped
(vineyard settings, blocks, team, equipment, chemicals, spray equipment,
irrigation, preferences); when a role cannot read a source the resolver
continues to report **Unable to check** rather than "missing setup", and
the check stays out of the readiness denominator (Stage 3.1 rules
untouched).

## 3. Setup action permission matrix

| Check | Destination | Roles allowed by `ROUTE_ALLOW` | Behaviour without permission |
| --- | --- | --- | --- |
| Vineyard profile | `/setup/vineyard` | owner, manager | link hidden + "Ask an Owner or Manager…" |
| Vineyard location | `/setup/vineyard-location` | all roles | link shown |
| Blocks / boundaries / rows | `/setup/paddocks` | all roles | link shown (page enforces its own write rules) |
| Planting & varieties, clone/rootstock | `/setup/grape-varieties` | all roles | link shown |
| Weather source | `/setup/weather` | owner, manager | hidden + hint |
| Equipment registered | `/setup/tractors` | owner, manager | hidden + hint |
| Vineyard owner / team invited | `/team` | owner, manager | hidden + hint |
| Saved chemicals | `/setup/chemicals` | owner, manager | hidden + hint |
| Spray equipment | `/setup/spray-equipment` | owner, manager | hidden + hint |
| Irrigation systems / valves / allocations | `/irrigation/setup` | all roles | link shown |
| Season & operational preferences | `/setup/operational-preferences` | all roles | link shown |

## 4. Protection confirmations

- **Diagnostics** — `SetupHealthDiagnostics` now returns `null` unless
  `showsSetupDiagnostics(viewer)` (i.e. `useIsSystemAdmin`). It is no longer
  protected only by the parent route.
- **Mapping / Crop Health** — `OperationalToolsCatalogue` builds its internal
  block only for System Admins, and `visibleGuideItems()` strips any item that
  is not `availability: "available"` or carries `visibilityGate: "system_admin"`
  from every area page. Release state unchanged; the Mapping route keeps its
  own gate.
- **Guide Images** — management lives at System Admin → Guide Images
  (`RequireSystemAdmin` route) and writes go through the System Admin-only
  feature-flag store plus the `guide-images` bucket. The guide only reads.
  `canManageGuideImages()` is admin-only and asserted by tests.

## 5. Image coverage (read live from the shared image store)

The `guide.visual_assets` configuration key does not exist yet — **no guide
imagery has been uploaded**.

| Set | Coverage |
| --- | --- |
| Primary (hero, setup, pins, trips, sprays, work-tasks, operational-tools, reports) | **0 / 8** |
| Supporting workflow screenshots | **0 / 14** |
| Operational Tool images | **0 / 13** |
| Reports supporting images | **0 / 3** |

Blank-image behaviour is safe: `GuideVisualSlot` renders a restrained
image-shaped surface (landing) or an icon + caption panel, and
`GuideScreenshot` degrades to a neutral labelled panel on missing *or*
failed images — never a broken rectangle. Even so, shipping all eight
primary slots empty would look unfinished, so primary imagery is a blocker.

## 6. Customer-facing development language

Prepared and role-aware: "Internal preview" (hero badge), availability
badges, `Tool ID:` lines, the internal Mapping block and diagnostics all
render only when `showsDevelopmentLabels` / `showsInternalContent` /
`showsSetupDiagnostics` are true. System Admin keeps every internal
indicator today — nothing was removed.

## 7. Performance and image loading

- Landing page issues one live query (setup health) plus one cached guide
  image map (`staleTime` 60s, shared query key). Tool guides, workflow
  screenshots and report visuals are only mounted on their own routes.
- All guide images are `loading="lazy"` + `decoding="async"`, inside fixed
  aspect-ratio containers (no layout shift), with an `onError` fallback.
  The hero is `eager` + `fetchPriority="high"` because it is above the fold.
- No obviously unnecessary initial payload found; drill-down content is
  route-split by React Router and rendered on demand.

## 8. Deep links

`/dashboard/how-vinetrack-works/pins` and
`/dashboard/how-vinetrack-works/operational-tools/pruning_tracker` are real
parameterised routes and resolve without visiting the sidebar. When the
customer gate is enabled, they will honour exactly the same gate as the
landing page (single wrapper in `src/App.tsx`).

## 9. Fertiliser Calculator

`/tools/fertiliser-calculator` is hidden from customer navigation but has no
route-level role restriction — a pre-existing hardening issue that is *not*
fixed here. Guide treatment: the tool guide and card still explain the tool,
but the "Open tool" action is suppressed for all customer roles
(`SYSTEM_ADMIN_ONLY_ROUTES`), so the guide never becomes the way in. Crop
Health Maps (`/tools/satellite-mapping`) is treated the same way.

## 10. Live setup-health sanity check (unchanged rules)

Re-confirmed via `setupHealth.test.ts` / `setupPresentation.test.ts`:
fully configured → green Complete; required missing → red Action required;
recommendation only → green Complete + amber recommendation; optional
unchecked → no readiness penalty; unreadable source → neutral Unable to
check; non-irrigated vineyard → irrigation excluded; no spray usage → spray
excluded.

## 11. Release blockers

**Blocker**
1. Primary imagery 0/8 — the eight landing/hero slots must be populated.
2. Authenticated role testing (Owner/Manager/Supervisor/Operator against a
   real vineyard) has not been run; only unit/component coverage exists.

**Should fix**
3. Operational Tool images 0/13 and workflow screenshots 0/14 — tool guides
   read fine without them, but several steps are clearer with a screenshot.
4. Fertiliser Calculator route-level permission hardening (separate task).
5. Reports supporting images 0/3.

**Later enhancement**
6. Consolidated irrigation applicability contract.
7. Per-role copy variants for Setup Health explanations.
8. Customer-facing "what changed" / release-notes surface inside the guide.

## 12. Tests

`src/test/guideAccess.test.tsx` (9 tests) covers: role matrix, Setup Health
mode per role, admin-only internal content/labels/diagnostics/Guide Images,
action decisions against `canAccessRoute`, System Admin-only tool routes,
read-only setup wording, and customer vs admin rendering of the hero badge
and diagnostics panel. Full suite: **948 passing**, typecheck clean.
