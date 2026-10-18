# Target Nutrient Application — Shared Contract v0.2 (DB foundation applied)

Status: database foundation APPLIED and verified by ChatGPT (migration `target_nutrient_additive_contract_foundation`); Portal and mobile implementation NOT started; feature gated off everywhere. Owners: ChatGPT (database), Rork (iOS/Android), Lovable (Portal). §3/§4 below now describe the LIVE schema, audited read-only by Lovable on 18 Oct 2026.

## 1. Purpose

Extend the Fertiliser Calculator with a `nutrientTarget` calculation mode that works with ANY nutrient or element declared in a product's analysis — not just nitrogen. The grower picks a nutrient, enters a target quantity of that nutrient (g/vine or kg/ha), and the calculator derives the required product quantity from the product's declared concentration.

## 2. Non-negotiable rule (requirement zero)

**No platform may silently reinterpret a `nutrientTarget` record as `perHectare` or `perVine`, and no platform may discard a record's saved nutrient analysis.**

- The live database enum already permits `fertiliser_records.calculation_mode ∈ {perHectare, perVine, nutrientTarget, fertigation}` (SQL 110/111). Records in these modes can exist today.
- Any platform that does not understand a stored `calculation_mode` MUST display the record read-only with a clear "mode not supported by this version" notice, showing the stored values verbatim. It MUST NOT reopen the record in an editable calculator under a different mode, MUST NOT overwrite `calculation_mode` on save, and MUST NOT drop fields it does not understand.
- Portal guard: IMPLEMENTED (standalone bug fix, shipped ahead of this feature). Unsupported-mode records stay listed with their real mode label, show stored rate/total/units verbatim, open only in a separate read-only dialog that never mounts the calculator pipeline, and cannot be edited, duplicated, deleted or saved from the Portal. See `isSupportedCalculationMode` / `calculationModeLabel` / `UNSUPPORTED_MODE_NOTICE` in `src/lib/fertiliserCalc.ts`, the guards in `FertiliserCalculatorPage.tsx`, and `UnsupportedFertiliserRecordDialog` in `FertiliserCalculatorDialog.tsx`. Regression tests: `src/test/fertiliserUnsupportedMode.test.tsx`.

## 3. Product analysis model (full analysis list)

Today's saved product stores only `nitrogen_percent`, `phosphorus_percent`, `potassium_percent`, plus `analysis_basis` and density. That cannot express Ca, Mg, S, micronutrients, or custom nutrients.

Live schema (audited 18 Oct 2026): a NEW TABLE `public.product_nutrient_analysis` exists. Its column list could not be enumerated read-only — the migration did not GRANT SELECT to `anon`/`authenticated`, so every probe returns `42501` (permission denied) before column resolution. The columns below are the agreed contract shape; ChatGPT to confirm the actual column names/types and the intended GRANT/RLS posture before Portal implementation:

```
product_nutrient_analysis (new table — EXISTS, not yet readable by app roles)
  product_id        uuid  -> saved_chemicals.id
  nutrient_key      text  -- canonical key, e.g. "N","P","K","Ca","Mg","S","Fe","Mn","Zn","Cu","B","Mo","Cl","Si","Co", or "other:<slug>"
  display_name      text  -- e.g. "Zinc", or the grower's custom name for other:*
  percent           numeric NOT NULL CHECK (percent > 0 AND percent <= 100)
  analysis_basis    text  -- "elemental" | "oxide" (e.g. K as K2O, P as P2O5)
  concentration_basis text -- "w/w" (weight/weight) | "w/v" (weight/volume; no density needed — already mass per product volume)
  is_primary        boolean
```

Rules:
- Elemental vs oxide basis is stored per nutrient and shown next to every percentage. Conversion between oxide and elemental forms is NOT performed automatically in v1; the percentage is used as declared, and the basis label travels with it everywhere it is displayed.
- `w/v` concentrations do NOT require density: the percentage already expresses nutrient mass per product volume (e.g. 16% w/v = 16 g nutrient per 100 mL product, so a 2 g nutrient target needs 12.5 mL product). Density (kg/L) IS required when converting a `% w/w` concentration on a liquid product into a volume-based application quantity; if that density is missing, the calculator blocks the calculation and says why.
- `other:<slug>` supports grower-defined nutrients; `display_name` is mandatory for those.

## 4. Record payload (what a saved nutrientTarget record must carry)

Existing `fertiliser_records` columns are reused where possible. New columns CONFIRMED PRESENT on the live table (probed column-by-column via the API, 18 Oct 2026):

```
calculation_mode        = "nutrientTarget"
nutrient_key            text        -- selected nutrient            [CONFIRMED]
nutrient_display_name   text        --                              [CONFIRMED]
target_rate             numeric     -- grower's target              [CONFIRMED]
target_rate_unit        text        -- "g/vine" | "kg/ha"           [CONFIRMED]
nutrient_percent        numeric     -- percentage actually used     [CONFIRMED]
nutrient_percent_source text        -- "product_analysis" | "manual" [CONFIRMED]
analysis_basis          text        -- elemental | oxide            [CONFIRMED]
concentration_basis     text        -- w/w | w/v                    [CONFIRMED]
product_density_kg_per_l numeric    -- density snapshot when used   [CONFIRMED]
product_analysis_snapshot jsonb     -- full declared analysis at save [CONFIRMED]
nutrient_contract_version text      -- contract version the record was written against [CONFIRMED]
nutrient_declared_as    text        -- how the nutrient was declared (e.g. elemental/oxide form label) [CONFIRMED]
```

Differences from the v0.1 proposal: `nutrient_contract_version` and `nutrient_declared_as` were ADDED; there are NO separate `density_source` / `density_reference` columns (probed — absent). If density provenance is required, it must live inside `product_analysis_snapshot` or be added later. Column nullability/defaults/check constraints could not be verified read-only (need a GRANT or ChatGPT's migration source); snapshot jsonb internal format likewise unverified — ChatGPT to publish the exact snapshot shape before Portal writes any record.

- The snapshot is authoritative for historical display: if the product's analysis is later edited, saved records still show what was used.
- `application_rate` / `application_rate_unit` keep their existing meaning (derived product rate) so existing cost/pack/inventory math is unchanged.
- `vine_count_basis` (SQL 265) semantics unchanged.

## 5. Calculation

```
product_required = target_nutrient_quantity / (nutrient_percent / 100)
```

- per-vine target: total nutrient = target_rate (g/vine) × vines ÷ 1000 → kg nutrient; product kg = nutrient kg ÷ (percent/100). Liquids declared w/v convert directly to volume (percent = g per 100 mL); liquids declared w/w convert via density (kg/L).
- per-hectare target: total nutrient = target_rate (kg/ha) × area_ha; same conversion.
- Multi-nutrient display: for every OTHER nutrient in the product's declared analysis, show the amount that would also be applied (product_required × that nutrient's percent/100, honouring each nutrient's own basis). Informational only; never saved as separate records.
- Pack count, cost (SQL 264 season prices only), inventory comparison, work-task linking, and allocation reconciliation reuse the existing per-hectare/per-vine machinery unchanged.

## 6. Backward and forward compatibility

- Existing `perHectare`/`perVine` records: untouched. Migration is additive only.
- Older app versions seeing a `nutrientTarget` record: per §2, read-only + "not supported" notice. Rork to confirm current iOS/Android behaviour against this rule and ship any needed guard BEFORE the feature is released.
- Feature gating: the mode is hidden behind a per-platform feature gate until cross-platform testing passes. The database accepts the mode (it already does); the gate is client-side only.
- Full Block Backup: `product_analysis_snapshot` and the new columns are copied as ordinary record data; ids regenerate per the existing backup contract.

## 7. Roles and permissions

Unchanged from the existing fertiliser matrix, verified against Portal source (`fertiliserPermissions` in `FertiliserCalculatorPage.tsx`) and the live database rules noted in `fertiliserRecordsQuery.ts` (SQL 110/111): owner/manager/supervisor/**operator** may create and update records; soft delete is owner/manager/supervisor only; costs are visible to owner/manager only; product (saved chemical) management is owner/manager only. The `nutrientTarget` mode inherits this matrix exactly — no permission changes are part of this feature.

## 8. Portal compatibility review (Lovable, this turn — no code changed)

Verified against current source:

1. **Mode misread (critical, §2):** `FertiliserCalculatorPage.tsx:312,323` and `FertiliserCalculatorDialog.tsx:246,249` collapse every non-`perVine` mode to `perHectare`. Must become: unknown/unsupported mode → read-only display, never editable re-open, never rewritten on save.
2. **Type union:** `FertiliserCalculationMode` in `src/lib/fertiliserCalc.ts:15` is only `"perHectare" | "perVine"`; the query layer (`fertiliserRecordsQuery.ts:26`) already types it as `string`, so no DB read breaks — the narrowing happens only in UI.
3. **Product model gap:** Portal's saved-product form stores N/P/K + `analysis_basis` + density only; no place for the full analysis list. Portal UI work waits for the approved schema.
4. **Costs/inventory:** Portal already resolves product cost via SQL 264 season prices and inventory via the Chemical Inventory summary RPC — both are mode-agnostic and reusable as-is.
5. **Safeguards Portal will need when implementing:** (a) unsupported-mode read-only guard (the §2 fix); (b) density-required blocker for w/w liquids converted to volume (w/v needs no density); (c) basis labels (elemental/oxide, w/w vs w/v) shown wherever a percentage appears; (d) snapshot written at save and preferred over live product data on display; (e) gate flag defaulting off.

## 9. Open questions for reviewers

Resolved by the applied migration: new TABLE (not jsonb) chosen; `fertiliser_records` column names confirmed as in §4.

Still open:
- ChatGPT: publish the exact `product_nutrient_analysis` column list, nullability, checks and GRANT/RLS posture (currently unreadable by app roles — Portal cannot implement the product analysis editor until SELECT/INSERT/UPDATE grants + RLS exist); publish the exact `product_analysis_snapshot` jsonb shape and the `nutrient_contract_version` value to write (proposal: `"1"`); confirm whether density provenance lives in the snapshot; whether oxide↔elemental conversion factors belong in the DB later.
- Rork: confirm current iOS/Android behaviour when reading an unknown `calculation_mode`; confirm offline persistence can store the snapshot jsonb; confirm the mode gate mechanism.
- All: agreed canonical nutrient key list and display names (proposal in §3).

## 10. Sequence

1. Rork + Lovable review this draft; changes returned.
2. Contract v1.0 agreed.
3. ChatGPT implements and verifies the migration (additive only).
4. Lovable ships the §2 unsupported-mode guard on Portal (can ship earlier — it is a bug fix).
5. Rork + Lovable implement behind gates; cross-platform testing; gates lifted together.

## 11. Lovable read-only integration audit (18 Oct 2026)

Method: column-by-column probes against the live VineTrack database API (read-only; no writes, no SQL executed by Lovable). Results:

- `fertiliser_records`: all twelve v0.1/proposed nutrient columns present (§4), plus `nutrient_contract_version` and `nutrient_declared_as`. No `density_source`/`density_reference` columns exist.
- `product_nutrient_analysis`: table EXISTS but is not readable by `anon`/`authenticated` (42501). Column shape unverified — blocker for the Portal product analysis editor until ChatGPT confirms grants/RLS and publishes the column list.
- `saved_chemicals`: no nutrient-list/jsonb column added there (probed — absent); the analysis list lives only in the new table.
- Portal guard regression tests re-run after the migration: 16/16 passed (`fertiliserUnsupportedMode.test.tsx`, `fertiliserPersistence.test.ts`). Per-hectare/per-vine paths and the unsupported-mode read-only guard are unaffected by the additive columns (Portal selects columns explicitly, never `select=*`, so new columns are ignored until used).
