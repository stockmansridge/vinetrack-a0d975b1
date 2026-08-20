# Stage 3.1 — Live Setup Health validation & hardening

Read-only validation of `src/lib/guide/setupHealth.ts` (resolver) and
`src/lib/guide/setupHealthQuery.ts` (facts). No SQL, schema or RPC changes.
Page remains System Admin-only.

## 1. Implemented rule table

| Check ID | Label | Importance | Source | Complete | Action required | Not applicable | Unknown | In denominator | Route |
|---|---|---|---|---|---|---|---|---|---|
| `vineyard.profile` | Vineyard profile | Required | `vineyards.name` (id = selected) | non-blank name | blank name | never | row unreadable/missing | yes when readable | `/setup/vineyard` |
| `vineyard.location` | Vineyard location | Required | `vineyards.latitude/longitude` | both numeric | either missing | never | row unreadable | yes when readable | `/setup/vineyard-location` |
| `vineyard.blocks` | Blocks created | Required | `paddocks` where `vineyard_id` = selected AND `deleted_at is null` | ≥ 1 block | 0 blocks | never | query failed | yes when readable | `/setup/paddocks` |
| `vineyard.boundaries` | Mapped boundaries | Required | `paddocks.polygon_points` | every active block has ≥ 3 points | any block without | never | blocks unreadable | yes when readable | `/setup/paddocks` |
| `vineyard.rows` | Row setup | Required | `paddocks.rows` | every active block has ≥ 1 row entry | any block with none | never | blocks unreadable | yes when readable | `/setup/paddocks` |
| `vineyard.planting` | Planting & varieties | Required | `paddocks.variety_allocations` | every active block has ≥ 1 allocation | any block with none | never | blocks unreadable | yes when readable | `/setup/grape-varieties` |
| `vineyard.planting_detail` | Clone & rootstock detail | **Recommended** (new) | allocation `clone` / `rootstock` fields | every planted block names clone or rootstock | n/a (amber only) | no planted blocks | blocks unreadable | **no** | `/setup/grape-varieties` |
| `weather.source` | Weather source connected | Required | `get_vineyard_weather_integration(vineyard, provider)` ×2 | ≥ 1 provider row stored | neither provider configured | never | **both** provider reads errored | yes when readable | `/setup/weather` |
| `equipment.registered` | Equipment registered | Recommended | counts of `tractors`, `vineyard_machines`, `spray_equipment`, `equipment_items` (vineyard-scoped) | ≥ 1 item | n/a | never | all counts failed | **no** | `/setup/tractors` |
| `team.owner` | Vineyard owner | Required | `vineyard_members.role = 'owner'` | ≥ 1 owner | none | never | query failed | yes when readable | `/team` |
| `team.members` | Team members invited | Recommended | `vineyard_members` count | > 1 member | n/a | never | query failed | **no** | `/team` |
| `spray.chemicals` | Saved chemicals | Required *conditional* | `saved_chemicals` (vineyard-scoped) | ≥ 1 chemical | 0 while spray applies | no spray jobs/records | counts failed | yes when applicable+readable | `/setup/chemicals` |
| `spray.equipment` | Spray equipment | Required *conditional* | `spray_equipment` (vineyard-scoped) | ≥ 1 sprayer | 0 while spray applies | no spray jobs/records | counts failed | yes when applicable+readable | `/setup/spray-equipment` |
| `irrigation.systems` | Irrigation systems | Required *conditional* | `get_irrigation_setup_status → required.systems_ok` | true | false | irrigation does not apply | RPC error (incl. access denial) | yes when applicable+readable | `/irrigation/setup` |
| `irrigation.valves` | Valves & zones | Required *conditional* | `…required.valves_ok` | true | false | irrigation does not apply | RPC error | yes when applicable+readable | `/irrigation/setup` |
| `irrigation.allocations` | Valve → block allocations | Required *conditional* | `…required.allocations_ok` | true | false | irrigation does not apply | RPC error | yes when applicable+readable | `/irrigation/setup` |
| `preferences.season` | Season & operational preferences | Optional | not read by the portal | configured | n/a | never | always (no read contract) | **no** | `/setup/operational-preferences` |

Assumptions: `deleted_at is null` is the canonical active-block filter (same one
`get_irrigation_setup_status` uses); `vineyard_members` rows represent accepted
members (pending invitations live in the invitations contract and are not read);
clone/rootstock may be stored as name or id on an allocation.

## 2. Readiness denominator

`readinessPct = completedRequired / totalRequired`, where a check enters the
denominator only when `applicable && importance === "required" && value !== null`.
Recommended, optional, not-applicable and unreadable checks are excluded from
both numerator and denominator. Pins, Trips, Work Tasks, Reports, Mapping,
Operational Tools and mobile usage are not inputs to the resolver at all.

Maximum denominator (fully applicable vineyard) = 13:
6 vineyard + 1 weather + 1 team owner + 2 spray + 3 irrigation.
Dryland, non-spraying vineyard = 8.

## 3. Spray applicability — RULE CHANGED

Previously `usageEvidence > 0 || chemicals > 0 || sprayEquipment > 0`. Chemicals
and sprayers are configuration, not proof that the vineyard uses the VineTrack
spray workflow, so they falsely made Spray required. New rule:

> Spray setup applies only when `spray_jobs + spray_records > 0` for the
> selected vineyard (both counts are `vineyard_id`-scoped).

Chemicals/sprayers are still *evaluated* once spray applies, but never trigger
applicability.

## 4. Irrigation contract findings

- `get_irrigation_setup_status(p_vineyard_id)` (SQL 125) is vineyard-scoped, calls
  `_irrigation_require_access` first, and returns `required.{systems_ok, valves_ok,
  allocations_ok, active_system_count, active_valve_count, blocks_ok}` plus
  recommended block-completeness counters.
- It is the established **configuration** aggregate; it never reads `is_irrigated`
  and therefore does **not** define applicability.
- Access failure raises an error → our fact becomes `null` → checks are `not_checked`
  and excluded, so permission is never confused with physical applicability.
- Applicability stays on the Stage 1 contract: any active block irrigated
  (`is_irrigated` or emitter flow/spacing present — same derivation as
  `blockDiagnostics.ts`) or any active system/valve configured.
- No contradiction with `get_irrigation_capabilities`: capabilities gate *access*,
  the block flags gate *applicability*, the aggregate gates *configuration*.
  Open item for backend: there is no single server-side "does irrigation apply"
  flag; the portal derives it. Recommend one canonical field in a later contract.

## 5. Block filtering

All block-level checks use one fetch: `paddocks` filtered by the selected
`vineyard_id` and `deleted_at is null`, no caching beyond the 60s react-query
staleTime, no duplicate rows (one row per block). Coverage counts are
`covered / blocks.length` from that same set.

## 6. Row completeness

Complete = the block has at least one entry in `paddocks.rows`. Row direction,
row spacing and persisted geometry are **not** required and are never counted
separately — one missing configuration produces exactly one penalty.

## 7. Planting completeness

Required = at least one entry in `paddocks.variety_allocations`. Clone and
rootstock are enrichment: they surface as a separate **recommended** check that
cannot reduce readiness, so a vineyard with varieties but no clone/rootstock can
still reach 100 % required setup.

## 8. Weather

Complete = a stored integration row exists for Davis or Wunderground via
`get_vineyard_weather_integration`. Provider health (`davis-proxy` tests,
`last_test_status`, current observations, forecasts) is never read. If both
provider reads error, the check becomes unknown — never action required.

## 9. Equipment

Recommended only, never in the denominator: complete with ≥ 1 item of any kind,
otherwise amber. A missing sprayer is penalised once, under `spray.equipment`,
and only when spraying actually applies.

## 10. Team

Required = at least one owner on `vineyard_members`. Extra members are
recommended; pending invitations are not read and cannot reduce readiness. A
solo vineyard reaches 100 %.

## 11. Real vineyard scenarios

Live production/test vineyard data lives in the shared VineTrack (iOS) Supabase
project, which is external to this workspace and RLS-locked; no session can be
minted for it from the build sandbox (`external_unmanaged`). Scenarios A–F were
therefore validated as deterministic resolver tests over fact fixtures rather
than against live vineyards. Live figures (percentage, numerator/denominator,
per-check states, block counts) are now readable in the app by a System Admin
through the new diagnostics panel on the Setup drill-down.

## 12. Diagnostics

`src/components/guide/SetupHealthDiagnostics.tsx` — collapsed by default, inside
the System Admin-gated guide. Shows check id, status, importance/conditionality,
denominator inclusion, source, readability, coverage detail and applicability
reason. No tokens, payloads, secrets, signed URLs, personal data or row dumps.

## 13/14. Double counting & language

One requirement = one check. User-facing strings stay in vineyard language
("2 of 3 blocks have row setup", "blocks have planting information"); table and
field names appear only in the internal diagnostics panel.
