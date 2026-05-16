## Pre-flight: shared Supabase verification

I probed the iOS Supabase project (`tbafuqwruefgkbyxrxyb`) before planning:

- `get_soil_class_defaults()` → returns 9 soil classes with full schema (awc, depletion, root depth, risks)
- `get_paddock_soil_profile(p_paddock_id)` → exists (returns `paddock_not_found` for bogus id)
- `list_vineyard_soil_profiles(p_vineyard_id)` → exists (returns `not_authorized` without auth — confirms RPC)
- `get_vineyard_default_soil_profile(p_vineyard_id)` → exists
- `/functions/v1/nsw-seed-soil-lookup` → live (`nsw-seed-soil-lookup-2026-05-16-v3`)
- `get_system_feature_flags()` → returns: `enable_beta_features`, `show_costing_diagnostics`, `show_map_pin_diagnostics`, `show_pin_diagnostics`, `show_raw_json_panels`, `show_sync_diagnostics`, `show_weather_diagnostics`, `show_willyweather_debug`

**Blockers found (need Rork to add to shared Supabase):**
1. `show_nsw_seed_diagnostics` feature flag — not present
2. `show_irrigation_diagnostics` feature flag — not present
3. Vineyard-level recent-rain lookback setting — column `vineyards.recent_rain_lookback_hours` does not exist, no RPC found

Per your instructions I will **not** create portal-only flags or settings for these. Lovable will fall back to existing flags (`show_raw_json_panels`, `show_weather_diagnostics`) and the recent-rain control will remain a session-only UI selector with a visible "vineyard-level sync pending shared RPC" note.

## Implementation plan

### 1. Shared soil profile lib — `src/lib/soilProfiles.ts` (new)
Typed React Query hooks against `iosSupabase`:
- `useSoilClassDefaults()` — read-only
- `usePaddockSoilProfile(paddockId)`
- `useVineyardSoilProfiles(vineyardId)`
- `useVineyardDefaultSoilProfile(vineyardId)`
- `useUpsertPaddockSoilProfile()`, `useDeletePaddockSoilProfile()`
- `useUpsertVineyardDefaultSoilProfile()`, `useDeleteVineyardDefaultSoilProfile()`
- `useNswSeedLookup()` — calls `iosSupabase.functions.invoke('nsw-seed-soil-lookup', { body: { latitude, longitude } })`. NSW SEED API key stays server-side.

Helpers: `computeRootZoneCapacity`, `computeReadilyAvailableWater`, conservative aggregator for whole-vineyard.

### 2. Block / Paddock detail — Soil section
- New component `src/components/soil/SoilProfileSection.tsx` rendered inside `PaddockDetailPanel` (sheet + page) and `PaddockDetailPage`.
- Read fields: irrigation soil class, soil landscape, SALIS code, Australian Soil Classification, Land & Soil Capability, AWC mm/m, effective root depth, allowed depletion %, derived root-zone capacity, readily available water, confidence, source/provider, manual override status, manual notes.
- Owner/manager edit dialog using soil-class dropdown (defaults from RPC) with override toggle + notes.
- "Fetch soil from NSW SEED" button: visible only when no profile exists; if profile exists shows a secondary "Re-fetch from NSW SEED" that warns and requires confirmation, with extra confirmation when `manual_override = true`. Persists full SEED payload via `upsert_paddock_soil_profile`. Shows the standard disclaimer.
- Raw SEED JSON panel gated behind `useDiagnosticPanel('show_raw_json_panels')`.

### 3. Irrigation Advisor v2 — `src/pages/tools/IrrigationCalculatorPage.tsx`
Restructure to the new screen order:
- **A. Wizard** (`AdvisorWizard.tsx`): hidden when all items complete; lists missing/warning items for weather source, recent rain, application rate, soil profile/soil buffer, crop coefficient/growth stage, rainfall+irrigation efficiency. Warnings (not blockers) for partial Whole Vineyard setup.
- **B. Scope selector** directly under wizard — first option `Whole Vineyard`, then blocks.
- **C. Recommendation** immediately after selector. Whole-vineyard adds the "Runtime is estimated per block…" note.
- **D. "Irrigation Advisor Config"** button opening a config drawer/page with sections in order: Weather Sources, Recent Rain, Forecast, Forecast Details, Daily Breakdown, Calculation Assumptions, Block Settings, Soil Profile, Diagnostics (gated).

Soil buffer now sourced from shared soil profile (paddock → vineyard default → conservative aggregate → missing).

Whole-vineyard application rate logic: vineyard default → area-weighted average → simple average → missing. Per-block emitter/soil gaps become wizard warnings, not hard blocks.

### 4. Recent rain lookback
- UI selector with `24h / 48h / 7d / 14d`. Persists to `localStorage` only.
- Inline note: "Lookback is session-only on the portal until the shared vineyard-level setting ships in Supabase."
- Reported as blocker (see top).

### 5. Diagnostics gating
- All raw JSON / SEED debug / advisor internals wrapped in `useDiagnosticPanel(key)` (admin + flag).
- Use existing `show_raw_json_panels` for raw JSON, `show_weather_diagnostics` for weather panels.
- NSW SEED diagnostics and irrigation diagnostics use `show_raw_json_panels` as fallback with a TODO comment; switching to dedicated flags is a one-line change once Rork adds them.

### 6. Grape variety awareness
- Wizard treats any paddock whose `variety_allocations` contains an entry that does not resolve against `grape_varieties` (via existing `resolvePaddockAllocations`) as **incomplete**, surfacing a "Select variety for {block}" wizard item rather than silently passing.

### 7. Sidebar / routes
- Soil section is in-page (no new route).
- Irrigation Advisor Config opens as a side sheet from the advisor page (no separate route needed).

## Files to add
- `src/lib/soilProfiles.ts`
- `src/components/soil/SoilProfileSection.tsx`
- `src/components/soil/NswSeedLookupButton.tsx`
- `src/components/soil/SoilProfileEditDialog.tsx`
- `src/components/irrigation/AdvisorWizard.tsx`
- `src/components/irrigation/AdvisorScopeSelector.tsx`
- `src/components/irrigation/AdvisorConfigSheet.tsx`
- `src/lib/irrigationWizard.ts` (wizard item derivation + whole-vineyard aggregation)

## Files to edit
- `src/components/PaddockDetailPanel.tsx` (add Soil section)
- `src/pages/setup/PaddockDetailPage.tsx` (already renders PaddockDetailContent — picks it up)
- `src/pages/tools/IrrigationCalculatorPage.tsx` (restructure)
- `src/lib/calculations/irrigationAdvisor.ts` (consume shared soil profile)
- `src/lib/calculations/irrigationForecast.ts` (consume shared soil profile)

## Verification
- `npx tsc --noEmit`
- Manual smoke: open a paddock detail, open Irrigation Calculator, toggle scope to Whole Vineyard, confirm wizard hide/show, confirm diagnostics hidden for non-admin.

## Final report will include
- Files changed
- Soil profile UI summary
- NSW SEED wiring summary
- Advisor flow changes
- Recent-rain status (blocker noted)
- Diagnostics gating summary
- TS result
- Outstanding blockers needing Rork action