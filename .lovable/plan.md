# VineTrack Web Admin Portal — MVP Plan (READ-ONLY)

A **strictly read-only** web portal for owners and managers to review VineTrack vineyard data. Reuses the existing production Supabase project (auth, tables, RLS, edge functions) used by the iOS app. **No writes of any kind in this iteration.**

## Hard guardrails for this iteration
- Anon key only. The Supabase service-role key is never imported, referenced, or stored in browser code.
- No SQL migrations, no RLS changes, no new tables, no edge function modifications.
- No `insert`, `update`, `delete`, `upsert`, or `rpc` write calls in any client code path.
- No "delete" buttons, no edit forms, no create flows. UI contains read views only.
- TypeScript types are **generated from the live schema** (read-only introspection) — no schema authoring on our side.

## Scope (this iteration)
1. Login (existing Supabase Auth, email/password)
2. Vineyard selector (from `vineyard_members` for `auth.uid()`)
3. Owners/managers-only portal access (operators blocked at login)
4. Read-only dashboard
5. Read-only paddock list + detail
6. Read-only tractor list + detail
7. Read-only spray equipment list + detail
8. Read-only team/users list
9. "Coming soon" placeholders in the sidebar for: sprays, saved chemicals, saved spray presets, operator categories, weather & forecasting, pins, trips, spray records, work tasks, maintenance logs, yield reports

## Access model
- All routes except `/login` require an authenticated session.
- After login, query `vineyard_members` for `auth.uid()` to determine accessible vineyards and the user's role per vineyard.
- If the user has **no** `owner` or `manager` membership on any vineyard, sign them out with: "This portal is for owners and managers. Use the iOS app to continue."
- Vineyard switcher only lists vineyards where the user is owner or manager.
- Selected vineyard id is stored in a React context + localStorage; every query filters explicitly by it (RLS remains the authority).

## UX / Layout (matching iOS app)
Once Supabase is connected I'll ask for a couple of iOS screenshots / brand colors (or pull them from the iOS asset catalog if available) and translate them into Tailwind tokens in `index.css`. Until then I'll use a vineyard-inspired dark-green primary on cream surfaces as a placeholder.

```text
┌─────────────────────────────────────────────┐
│ Topbar: VineTrack · [Vineyard ▼] · user ▾   │
├──────────┬──────────────────────────────────┤
│ Sidebar  │ Page content                     │
│  Dashbd  │ (cards, tables, detail panes)    │
│  Setup ▾ │                                  │
│   Paddck │                                  │
│   Tractr │                                  │
│   Spray… │                                  │
│  Team    │                                  │
│  Records │ (coming soon items here)         │
└──────────┴──────────────────────────────────┘
```
Collapsible shadcn sidebar; topbar vineyard switcher always visible.

## Pages (all read-only)

**/login** — email + password, "forgot password" link (uses existing Supabase reset flow), error toasts. Redirects to `/select-vineyard` on success.

**/select-vineyard** — card grid of accessible vineyards with role badge. Auto-redirects if exactly one. No "create vineyard" action.

**/dashboard** — counts of paddocks, tractors, spray equipment, team members for the selected vineyard; recent spray records / work tasks preview (last 5, read-only) if those tables are reachable under RLS.

**/setup/paddocks** — sortable, filterable table (name, area, varietal, rows, updated). Row click opens a **detail page** (no drawer with form fields — a labeled read-only view). No "New", no "Edit", no "Delete" buttons anywhere.

**/setup/tractors** — table (name, make/model, registration, status). Row click → read-only detail page.

**/setup/spray-equipment** — table (name, type, capacity, status). Row click → read-only detail page.

**/team** — read-only list of `vineyard_members` joined to user display info (profiles table if present, otherwise user_id), grouped by role. No invite, edit, or remove actions.

**Coming-soon routes** — render a simple "This module is coming in a future release" panel so navigation is complete but nothing half-built ships.

## Technical notes
- Connect via Lovable's Supabase integration — anon key only, exposed through `import.meta.env.VITE_SUPABASE_*`.
- Generate TypeScript types from the live schema after connection; queries use the typed client.
- Routing: `react-router-dom` with `<RequireAuth>` and `<RequireVineyard>` wrappers.
- Data: `@tanstack/react-query` with query keys scoped by `vineyardId`. All hooks are `useQuery` only — no `useMutation` is introduced in this iteration.
- A lint-style convention check: a single `src/lib/supabase.ts` re-export wraps the client; we won't expose `.insert/.update/.delete/.upsert/.rpc` helpers from app code in this phase, to make accidental writes obvious in review.
- All list queries `.eq('vineyard_id', selectedVineyardId)` so explicit filter + RLS both apply.
- Empty / loading / error states on every table and detail page.
- No destructive UI affordances anywhere (no trash icons, no "remove" links).

## Assumptions to confirm during build (read-only checks only)
- `vineyard_members` columns roughly `(vineyard_id, user_id, role)` with role values including `owner | manager | operator`.
- `paddocks`, `tractors`, `spray_equipment` carry `vineyard_id` and are gated by RLS on membership.
- A `profiles` (or similar) table exists for team display names; if not, team page falls back to email/user_id from whatever the anon-key role can read.

If any of these differ I'll surface it before wiring the affected screen — without touching the schema.

## Roadmap (future phases — NOT in this MVP)
- **Phase 2A:** Tractor create/edit only (no delete).
- **Phase 2B:** Spray equipment create/edit only (no delete).
- **Phase 2C:** Paddock editing — only after extra review, because paddock geometry/rows are more sensitive.
- Later: sprays, chemicals, presets, operator categories, weather, records modules, team management.

Each future phase will be planned and approved separately before any write code is added.
