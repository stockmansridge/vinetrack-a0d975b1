# VineTrack Portal Contract Audit — Stage 1 (audit only)

Date: 2026-08-17. **Database changes: NONE. Behaviour changes: NONE.** This document is the only artefact.

Rork/mobile owns the backend contract; the portal consumes it. Nothing below proposes a Lovable-side migration.

---

## 0. Verification method

Supabase **access available: YES (read-only probe)**. The production project `tbafuqwruefgkbyxrxyb` was probed with the shipped anon key using PostgREST column selection (`?select=<col>&limit=1`): HTTP 200 = column exists, HTTP 400/42703 = column absent. RLS returned no rows, so no production data was read. Column names quoted below are **verified live** unless marked `needs source verification`.

---

## 1. Production database identity

| Item | Finding |
| --- | --- |
| Production Supabase project ref | `tbafuqwruefgkbyxrxyb` |
| Supabase access available | YES (read-only column probe; no rows read) |
| Portal pointing to correct project | **PASS** — `src/integrations/ios-supabase/client.ts:10-14`, hard-coded `https://tbafuqwruefgkbyxrxyb.supabase.co`, exported as `iosSupabase` and aliased `supabase` (line 29) |
| Multiple database clients found | **YES** — see below |
| Legacy Lovable Cloud paths active in vineyard-data paths | **NO** |

Two clients exist, deliberately:

1. `src/integrations/ios-supabase/client.ts` → `tbafuqwruefgkbyxrxyb` (production VineTrack). ~120 modules under `src/lib/*Query.ts` import from here — all vineyard/spray/chemical/pruning/pin/trip reads and writes.
2. `src/integrations/supabase/client.ts` → Lovable Cloud `qpgkkertfwdycjhcbnpf` (`supabase/config.toml:1`). Used **only** by portal-only concerns: `wundergroundProxy.ts`, `willyWeatherProxy.ts`, `weatherStatusQuery.ts`, `rainForecastQuery.ts`, `supportRequestSubmit.ts`, `AdminDashboardPage.tsx`, plus edge functions (satellite imagery, `chemical-ai-lookup`, `davis-proxy`, `suggest-tractor-fuel`, billing/email).

Risk note: `supabase/functions/chemical-ai-lookup` and its `chemical_lookup_cache` table live on **Lovable Cloud**, not production. That is a portal-only chemical data store adjacent to the SQL 194 contract (see §5/§6).

**vinetrack-api**: no portal runtime code calls it. It is referenced only by documentation surfaces (`src/pages/settings/IntegrationDocsPage.tsx`, `src/lib/developerDocs.ts`, `docs/postman/…`, `docs/openapi/vinetrack-v1.yaml`). Recommendation: portal keeps direct Supabase for its own reads; `vinetrack-api` stays the third-party surface. No local adapters wrap the contract today.

---

## 2. Backend contract inventory (verified against production)

### `spray_records`
Verified present: `targets text[]`, `spray_head_target`, `application_blocks jsonb`, `block_ids uuid[]`, `gross_area_ha`, `treated_area_ha`, `canonical_row_length_metres`, `row_spacing_metres`, `geometry_source`, `geometry_quality`, `band_width_total_metres`, `application_mode`, `carrier_volume_basis`, `carrier_litres_per_hectare`, `client_updated_at`.
Verified absent: `application_head_target`, `carrier_basis`, `application_method`, `row_count`, `server_revision` (SQL 198 does **not** cover `spray_records`).
`application_blocks` element identity key: `blockId` (uuid string) — SQL 195 §2a. `block_ids` is trigger-derived, never authored. Empty array is invalid; absence is `NULL` = "blocks not recorded" (never infer).

### `spray_jobs`
Verified present: `targets`, `spray_head_target`, `gross_area_ha`, `treated_area_ha`, `canonical_row_length_metres`, `row_spacing_metres`, `geometry_source`, `geometry_quality`.
Verified absent: `application_blocks`, `block_ids`, `client_updated_at`, `server_revision`. Planned-job blocks remain `spray_job_paddocks` (SQL 032).

### `saved_chemicals` (SQL 194)
Verified present: `active_ingredients jsonb`, `activity_groups text[]`, `activity_group_scheme`, `registration_country`, `registration_scheme`, `registration_number`, `registrant`, `registered_product_name`, `label_reference`, `label_version`, `verification_status` (`verified | partially_verified | unverified | needs_match | conflict`), `verification_sources`, `verification_conflicts`, `verification_unresolved_fields`, `verified_at`, `registered_uses jsonb`, `label_rate_bases text[]`, `intelligence_schema_version`; legacy projections `active_ingredient`, `chemical_group`, `mode_of_action` retained.
Views (from SQL 194): `public.saved_chemical_intelligence_audit`, `public.saved_chemical_intelligence_summary`.
Not present: `country_code`, `registration_identity_key`, `label_rates`, `withholding_period_days` as top-level columns — WHP/re-entry live inside `registered_uses` (`needs source verification` for exact JSON keys).

### `resistance_plans` (SQL 196)
Verified present: `id, vineyard_id, season_id, season_start_year, disease, jurisdiction, crop, block_ids uuid[], positions jsonb, notes, ruleset_id, ruleset_version, created_by, updated_by, created_at, updated_at, deleted_at, client_updated_at, sync_version, server_revision, base_revision`. RPCs: `soft_delete_resistance_plan(p_id)`, `restore_resistance_plan(p_id)`. `positions[].products[].group_codes[]` is the planned FRAC sequence. Table stores **facts, never verdicts**.

### Concurrency (SQL 198)
`server_revision bigint` + `base_revision bigint` (write-only, never persisted) exist on exactly three tables: `pruning_seasons`, `pruning_yield_settings`, `resistance_plans`. Conflict surface: `raise exception 'REVISION_CONFLICT' using errcode = 'PT409'` → HTTP 409, details carry `code`, `server_revision`, `base_revision`. Audit table `public.sync_discarded_writes`.

---

## 3. Chemical Intelligence

| Question | Result |
| --- | --- |
| Structured model consumed | **FAIL** — zero references to `active_ingredients`, `activity_groups`, `verification_status`, `registered_uses`, `registration_*` anywhere in `src` |
| Legacy scalar dependence | `active_ingredient` (string), `chemical_group` (string), `mode_of_action`, single `rate_per_ha` + `unit`, WHP/REI regex-encoded into a free-text `restrictions` column |
| Verification support | **Missing** (no state machine, no status field) |
| Re-verify support | **Missing** |

Surfaces and their model (all legacy scalar):

- Query layer `src/lib/savedChemicalsQuery.ts:1-42` (`SavedChemical`), input type L75-76.
- List/search `src/pages/setup/SavedChemicalsPage.tsx:163-189`; picker filter `src/components/spray/ChemicalPicker.tsx:50-61` — free-text `.includes()` over name/AI/group.
- Add: `SavedChemicalsPage.tsx` create form + `ChemicalPicker.tsx:259-291` `NewChemicalDialog`.
- Edit: `updateSavedChemical` (`savedChemicalsQuery.ts:198`) full-overwrites scalar strings.
- Archive/restore/hard-delete: `savedChemicalsQuery.ts:216-248` (soft delete via `deleted_at`) — unaffected by 194.
- Rates: `src/lib/rateBasis.ts` single value + composed unit.
- Groups: `src/lib/chemicalGroupNormalise.ts` normalises **one** free-text group string.

Anti-patterns confirmed:

- Direct free-text `chemical_group` edit: `ChemicalPicker.tsx:344-346`, plus the equivalent input in `SavedChemicalsPage.tsx:891`.
- `"3 + 11"` stored as one opaque string — no delimiter parsing, no per-active group.
- Single-active-ingredient assumption throughout (`active_ingredient?: string`).
- No registration identity at all (no APVMA/registration number field) — so nothing is falsely treated as verified evidence, but there is also no country-scoped product identity.
- No verification state persisted. AI-lookup `confidence` / `country_confirmed` exist only transiently (`ChemicalAILookup.tsx:42-67`, `chemical-ai-lookup/index.ts:104-130`) and are discarded on apply.
- No structured registered uses/rates; WHP/REI parsed out of text (`src/lib/chemicalCategories.ts:41-66`).

**Portal-only logic that mobile does not have** (must not become a competing verification model): the AI lookup pipeline (`ChemicalAILookup.tsx` + Lovable Cloud edge function) with LLM candidate ranking, `confidence`, `country_confirmed`, label/SDS URL liveness validation, and the `chemical_lookup_cache` table. Closest analogue to Search → Match, but it never writes a status, never re-verifies, and stores nothing on `saved_chemicals`.

---

## 4. Spray Job builder

**Current flow (not a wizard).** `src/pages/setup/SprayJobsPage.tsx` `SprayJobSheet` (L765-1420) is one scrollable sheet, in this order:
Name → "Reusable template" → Planned date + Status → Operation type (Foliar / Banded / Spreader, L76-80) → **Target (free text)** → Growth stage (E-L) → Tractor → Equipment → Operator → Notes → **Blocks multiselect** → VSP water-rate calculator (foliar only, L1150-1302) → Chemical lines → Tank-mix preview → Linked spray records → Save.

Against the authoritative sequence *Application → Blocks → Target → Growth Stage → Equipment → Carrier → Products → Resistance Check → Review*:

| Step | Current file/component | Current fields | Write target | Matches contract |
| --- | --- | --- | --- | --- |
| Application | `SprayJobsPage.tsx:1008-1021` | `operation_type` free label ("Foliar Spray"/"Banded Spray"/"Spreader") | `spray_jobs.operation_type` | **Partially** — no `application_mode`, no band width |
| Blocks | `SprayJobsPage.tsx:1107-1148` | paddock UUID checklist | `spray_job_paddocks` | **Compatible** for jobs |
| Target | `SprayJobsPage.tsx:1022-1032` | `target` single free text | `spray_jobs.target` | **Legacy** — `targets text[]` unused |
| Head target | — | none | — | **Missing** |
| Growth stage | `SprayJobsPage.tsx:1034-1051` | `growth_stage_code` | `spray_jobs` | Compatible |
| Equipment | `SprayJobsPage.tsx:1053-1078` | `tractor_id`, `equipment_id` | `spray_jobs` | Compatible |
| Carrier | `SprayJobsPage.tsx:1150-1302`, `src/lib/vspWaterRate.ts` | `spray_rate_per_ha`, `water_volume`, `concentration_factor`, `row_spacing_metres` | `spray_jobs` | **Partially** — L/ha only |
| Products | `SprayJobsPage.tsx:1305-1387`, `ChemicalPicker.tsx` | `chemical_lines[]` jsonb | `spray_jobs.chemical_lines` | **Partially** — scalar chemistry |
| Resistance check | — | none | — | **Missing** |
| Review | Tank-mix preview L1389-1405 | derived only | — | Partial |

**Blocks (§8).** Selection is by real `paddocks.id` UUID (`SprayJobsPage.tsx:1122-1130`), persisted through `spray_job_paddocks` via delete+insert (`src/lib/sprayJobsQuery.ts:188-195`). Names are used as identity **only** at Excel import time as a lookup key, hard-erroring when unresolved (`src/lib/sprayProgramImport.ts:253-271`). No code reconstructs blocks from row ranges. **Portal-created jobs do not lose block identity on mobile.** However `src/lib/sprayRecordsQuery.ts:5-6, 11-39` shows completed spray records carry **no** block link of any kind — `application_blocks`/`block_ids` are never read or written, and `SprayRecordsPage.tsx:159` still declares `schemaGaps: ["no paddock_id", ...]`, which is now stale relative to SQL 195.

**Targets (§9).** Free text only. None of `powdery_mildew | downy_mildew | botrytis | weeds | nutrition_biostimulant | other` exist as values; the vocabulary appears only as placeholder prose (`SprayJobsPage.tsx:1026`). No `full_canopy | bunch_line | leaf_zone`.

**Geometry (§10).** Single shared engine `src/lib/paddockGeometry.ts` `deriveMetrics()` (L217-315) returns `areaHa`, `rowCount`, `totalRowLengthM`, `rowLengthSource`; reused by import/damage/irrigation/pruning. The spray sheet consumes only `areaHa` (`SprayJobsPage.tsx:871-880`). Gross area: yes. Treated area, geometry source/quality, per-block geometry, total treated band width: **no**. Row spacing is **silently auto-filled** from the mean `paddocks.row_width` of the selected blocks unless overridden (`SprayJobsPage.tsx:863-869, 882-884, 911-931`) — this is a soft-default that conflicts with the SQL 192 precedence chain and should be replaced by `operator override → mapped rows → derived area × spacing → incomplete`. `foliar` / `banded` / `spreader` exist as labels only.

**Carrier (§11).** L/ha everywhere (`spray_rate_per_ha`). L/100m exists only as an internal VSP matrix intermediate immediately converted to L/ha (`src/lib/vspWaterRate.ts:22-36`) — it can never be the vineyard carrier basis, so NZ/SWNZ workflows are not representable. Carrier basis is **not** conflated with product label rate basis; they are separate code paths.

**Product rate basis (§12).** Per-line and independent — `rate_basis: per_hectare | per_100L | per_100_litres` per chemical line (`src/lib/sprayJobsQuery.ts:28-35`, UI `SprayJobsPage.tsx:1358-1375`). No global-basis bug. Missing: treated-area basis, rate ranges (single `rate: number | null`), and imported lines infer basis from the unit string rather than storing it (`sprayProgramImport.ts:397-406`, `rateBasis.ts:162-190`).

**Banded (§13).** No banded maths exists. `Banded Spray` only recolours a badge, disables the VSP calculator and pins `concentration_factor = 1.0` (`SprayJobsPage.tsx:899-903, 1299`). Neither the preferred `canonicalRowLength × totalTreatedBandWidth / 10000` nor the `grossHa × bandWidth / rowSpacing` fallback is implemented, and the canonical chain (row geometry → application geometry → carrier volume → product quantities → tank splits) is only implemented from carrier volume onwards.

**Product selection (§14).** Not name-only for the UI path: a picked line retains `chemical_id` / `savedChemicalId` plus a copied `name`, `active_ingredient`, `unit`, optional `costPerUnit` (`sprayJobsQuery.ts:7-44`). It does **not** retain activity groups, verification status, registration identity or registered uses (they do not exist client-side). The **import path is name-driven and can create unlinked lines** with `chemical_id: null` (`sprayProgramImport.ts:339-351`).

**Chemical snapshot (§15).** No `chemicalSnapshot` object is written anywhere (zero project-wide hits). Portal-created jobs/records serialise scalar-only chemistry, so **mobile opening a portal-created job would lack activity groups, verification status and registration identity for resistance evaluation**. Do not backfill — mobile freezes the snapshot at completion; the portal must start writing it at the same moment once Stage 3 lands.

**Templates (§16).** Same `spray_jobs` table, `is_template = true` (`sprayJobsQuery.ts:51, 88-90`). A template carries name, operation type, free-text target, chemical lines, water volume, `spray_rate_per_ha`, equipment/tractor, growth stage, VSP canopy fields, row spacing, concentration factor (`SprayJobsPage.tsx:951-970`) — but **no blocks** (`spray_job_paddocks` is per-job), no structured targets, no carrier basis, no geometry, no chemical intelligence. Portal template → mobile new spray therefore instantiates with the legacy model. **Mobile-compatible: PARTIAL.**

---

## 5. Resistance

| Question | Answer |
| --- | --- |
| SQL 196 `resistance_plans` consumed | **NO — not implemented** |
| Resistance history (FRAC sequence / per-block spray history) | **NO** |
| Independent resistance logic found | **NO** |

Full-repo grep found only cosmetic matches: `src/lib/chemicalGroupNormalise.ts:1-62` normalises a group *label* for sorting/search (`isResistanceGroupCode()` at L50 tests string shape only); "powdery/downy" appear as target placeholders (`SprayJobsPage.tsx:980,1026`) and as map-pin category labels (`src/lib/pinStyle.ts:6`, `src/lib/unifiedPin.ts:136,195`). Nothing counts groups, sequences sprays, or produces a verdict. This is the good outcome: there is no competing engine to unwind.

Reusable building blocks for a future planner: block multiselect (`SprayJobsPage.tsx:1107-1148`), season/vintage helper `src/lib/useVintage.ts`, sortable tables + column prefs (`src/lib/useSortableTable.ts`, `src/hooks/useColumnPrefs.tsx`), soft-delete/restore list patterns (`SavedChemicalsPage.tsx`). Missing: disease vocabulary, planned-FRAC-sequence editor, ruleset metadata display, plan list page.

---

## 6. Concurrency

| Question | Answer |
| --- | --- |
| SQL 198 revision contract used | **NO** — zero hits for `server_revision`, `base_revision`, `PT409`, `REVISION_CONFLICT` in `src` |

Portal writes that **need SQL 198 adoption**:

- `src/lib/pruningQuery.ts` — RPC writes with `p_client_updated_at` (L299, 455, 550, 571, 602) and raw `client_updated_at` upserts (L160, 526); bespoke `UpdateEntryConflict` shape (L402-418). **Needs SQL 198 adoption** (`pruning_seasons`).
- `src/lib/pruningYieldSettingsQuery.ts:123-133` — `.upsert(onConflict: vineyard_id,paddock_id)` with `client_updated_at`; a stale write is a **silent no-op** with no user feedback. **Needs SQL 198 adoption** (`pruning_yield_settings`) — highest data-loss risk today.
- Future resistance plan writes — must be revision-based from day one.
- `src/lib/pickingRecordsQuery.ts:176` — same silent-stale pattern, but its table is not in SQL 198's scope. `needs source verification` whether Rork intends to extend the contract there.
- `src/lib/sprayJobsQuery.ts` / `sprayRecordsQuery.ts` — plain insert/update, no guard at all; not in SQL 198 scope today.

Required future write cycle: read `server_revision` → submit `base_revision` → on HTTP 409 with message `REVISION_CONFLICT` keep the user's unsaved form state, refetch the row, present a merge/retry. Never timestamp last-write-wins.

---

## 7. Exports and API/webhooks

- `src/lib/sprayJobsExport.ts` — single-job PDF (~L77), yearly program PDF (~L286), CSV (~L398). Emits job name/date/status/operation type, **free-text target** (L111/335/436), growth stage, **block names** (not IDs) via `paddockNamesFor`/`fetchJobPaddockMap` (L52-71), equipment/tractor/operator, per-line chemical name+rate+unit+water rate+notes (L43-49), VSP canopy, row spacing, spray rate, concentration factor, linked actual records (L226-257).
  Gaps: no machine-readable block IDs, no structured targets, no head target, no carrier basis, no structured/registered rates, no chemical intelligence (actives, activity groups, registration), no verification state, no treated area/geometry quality.
- `src/lib/tripReport.ts` — trip-level only; no chemistry.
- Public API `docs/openapi/vinetrack-v1.yaml` exposes only a nested `spray_job` stub (`id, name, status, target, operation_type, planned_date`) — no chemical lines, blocks, carrier, geometry or verification. `docs/postman/VineTrack-v1.postman_collection.json:146-169` documents `GET /v1/spray-jobs` under `sprays:read`.
- Webhooks `docs/webhooks/vinetrack-events-v1.json` — `spray_job.updated` / `spray_job.completed` emitted; `spray_job.created` catalogued but `emitted_in_v1: false` (`docs/vinetrack-api-changelog.md:95-96`). Envelope carries ids/scope only, no field-level payload schema, so block attribution, targets and chemical intelligence are absent by construction. Resistance plans are not exposed at all.
  Note: the *deployed* `vinetrack-api` may already be ahead of these checked-in docs — `needs source verification` against the live deployment before Stage 9.

---

## 8. Contract matrix

| Portal area | Current model | Required Rork contract | Status | Action |
| --- | --- | --- | --- | --- |
| Chemical Store (list/search) | Free-text scan of `name/active_ingredient/chemical_group` | SQL 194 structured model + `verification_status` facets | Legacy | Stage 1 read compatibility |
| Chemical add/edit | Scalar `active_ingredient`, `chemical_group`, `mode_of_action`, single rate | `active_ingredients jsonb`, `activity_groups[]`, registration identity, `registered_uses`, `label_rate_bases` | Legacy | Stage 2 |
| Chemical verification | None; portal-only AI confidence + URL liveness | `verification_status`, `verification_sources/conflicts/unresolved_fields`, `verified_at` | Missing | Stage 2 |
| Chemical audit views | Unused | `saved_chemical_intelligence_audit` / `_summary` | Missing | Stage 1/2 |
| Spray Job builder | Single sheet, legacy field set | Application→Blocks→Target→Growth→Equipment→Carrier→Products→Resistance→Review | Partially compatible | Stages 3-4 |
| Blocks (jobs) | `spray_job_paddocks`, UUID identity | Unchanged (SQL 032) | Compatible | None |
| Blocks (completed sprays) | No block link; stale "no paddock_id" note | `application_blocks` + derived `block_ids` (SQL 195/197) | Missing | Stage 3 |
| Targets | Single free-text `target` | `targets text[]` (SQL 193) | Legacy | Stage 3 |
| Head target | Absent | `spray_head_target` (`full_canopy/bunch_line/leaf_zone`) | Missing | Stage 3 |
| Growth stage | `growth_stage_code` E-L | Same | Compatible | None |
| Equipment | `tractor_id` / `equipment_id` | Same | Compatible | None |
| Application geometry | Gross area only; silent row-spacing default | `gross_area_ha`, `treated_area_ha`, `canonical_row_length_metres`, `row_spacing_metres`, `geometry_source`, `geometry_quality` (191/192) | Partially compatible | Stage 3 |
| Carrier L/ha | `spray_rate_per_ha` | `carrier_litres_per_hectare`, `carrier_volume_basis` | Partially compatible | Stage 3 |
| Carrier L/100m | Internal VSP intermediate only | Selectable vineyard carrier basis | Missing | Stage 3 |
| Banded spray | Label only, no maths | `band_width_total_metres` + treated-area chain | Missing | Stage 3 |
| Product rate basis | Per-line `per_hectare`/`per_100L` | + treated-area basis, rate ranges, `label_rate_bases` | Partially compatible | Stage 3 |
| Templates | `spray_jobs.is_template`, no blocks, legacy fields | Same table, current field model | Partially compatible | Stage 5 |
| Completed spray persistence | Portal does not create completed records; records read scalar only | SQL 191/193/195 columns | Legacy | Stage 3 |
| Chemical snapshots | None written | `chemicalSnapshot` per tank line (SQL 194) | Missing | Stage 3 |
| Resistance Plans | None | `resistance_plans` (SQL 196) + soft delete/restore RPCs | Missing | Stage 6 |
| Resistance history | None | Engine semantics over `spray_records.targets` + `block_ids` | Missing | Stage 7 |
| Concurrency | `client_updated_at`, silent stale no-ops | `server_revision`/`base_revision`, PT409 `REVISION_CONFLICT` | Missing | Stage 2 (parallel) |
| API / webhooks | Coarse job metadata only | Blocks, targets, chemistry, resistance | Partially compatible | Stage 9 |
| Exports (PDF/CSV) | Names + free-text target + scalar chemistry | + block IDs, structured targets, head target, carrier basis, chemical intelligence, verification | Partially compatible | Stage 9 |

---

## 9. Backend gaps (Rork action)

Only two, both minor and neither blocking:

1. **BACKEND GAP — RORK ACTION REQUIRED (clarification):** `spray_records` has no `server_revision`/`base_revision`, so the portal cannot use SQL 198 semantics for spray writes. Confirm whether spray records are intentionally out of scope (append-mostly) or scheduled for a later revision rollout.
2. **BACKEND GAP — RORK ACTION REQUIRED (documentation):** the exact JSON key schema for `saved_chemicals.active_ingredients`, `registered_uses` (including where WHP / re-entry live), `label_rate_bases` values, and `resistance_plans.positions[]` is not derivable from the portal. Publishing the TypeScript/JSON shapes would prevent the portal from guessing. Marked `needs source verification`.

Everything else the portal needs already exists in production.

---

## 10. Recommended implementation order

1. **Chemical Intelligence read compatibility** — extend `SavedChemical` types, read `active_ingredients`, `activity_groups`, `verification_status`, registration identity; show status badges; keep scalars as display-only projections.
2. **SQL 198 adoption for existing versioned writes** — `pruning_seasons`, `pruning_yield_settings`; build one shared `revisionWrite()` helper + PT409 conflict UX (preserve unsaved edits, refetch, re-apply). Do this before any new write surface.
3. **Chemical Store create/edit parity** — multi-active editor, per-active activity groups, registered uses/rates, country registration identity, verification/re-verify flow; retire or subordinate the AI lookup to a Match step that writes `needs_match`.
4. **Spray Job domain/contract update (data layer)** — `targets[]`, `spray_head_target`, geometry fields with SQL 192 precedence (remove the silent row-spacing default), carrier basis incl. L/100m, treated-area and banded maths, per-line rate basis extensions, chemical snapshot writer.
5. **Spray Job UI rebuild** — the nine-step flow over the layer from stage 4.
6. **Templates** — carry the current model (and decide with Rork whether templates should carry blocks).
7. **Completed spray attribution** — write `application_blocks` wherever the portal records/edits a completed application; correct the stale "no paddock_id" messaging; never infer historical blocks.
8. **Resistance Plans** — read/write `resistance_plans` with revision concurrency and the soft-delete/restore RPCs.
9. **Resistance history + live Resistance Check** — consume engine semantics only; no independent counting.
10. **Exports and API/webhook parity**, then **mobile ↔ portal interoperability tests**.

---

## 11. Files inspected (key)

`src/integrations/ios-supabase/client.ts`, `src/integrations/supabase/client.ts`, `supabase/config.toml`,
`src/lib/savedChemicalsQuery.ts`, `src/pages/setup/SavedChemicalsPage.tsx`, `src/components/spray/ChemicalPicker.tsx`, `src/components/spray/ChemicalAILookup.tsx`, `src/lib/chemicalGroupNormalise.ts`, `src/lib/chemicalCategories.ts`, `src/lib/rateBasis.ts`, `supabase/functions/chemical-ai-lookup/index.ts`,
`src/pages/setup/SprayJobsPage.tsx`, `src/lib/sprayJobsQuery.ts`, `src/lib/sprayRecordsQuery.ts`, `src/pages/setup/SprayRecordsPage.tsx`, `src/lib/sprayProgramImport.ts`, `src/lib/sprayProgramTemplate.ts`, `src/lib/vspWaterRate.ts`, `src/lib/paddockGeometry.ts`, `src/lib/sprayJobsExport.ts`, `src/lib/tripReport.ts`,
`src/lib/pruningQuery.ts`, `src/lib/pruningYieldSettingsQuery.ts`, `src/lib/pickingRecordsQuery.ts`,
`docs/openapi/vinetrack-v1.yaml`, `docs/postman/VineTrack-v1.postman_collection.json`, `docs/webhooks/vinetrack-events-v1.json`, `docs/vinetrack-api-changelog.md`,
uploaded contracts `193`–`198`.

## 12. Files changed

This document only. **Database changes: NONE.** Stage 2 not started.
