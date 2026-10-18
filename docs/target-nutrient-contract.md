# Target Nutrient Application — Shared Contract v0.1 (DRAFT for review)

Status: DRAFT — not approved, not implemented anywhere. Owners: ChatGPT (database), Rork (iOS/Android), Lovable (Portal). No platform implements against this document until all three sign off and the database migration is applied and verified by ChatGPT.

## 1. Purpose

Extend the Fertiliser Calculator with a `nutrientTarget` calculation mode that works with ANY nutrient or element declared in a product's analysis — not just nitrogen. The grower picks a nutrient, enters a target quantity of that nutrient (g/vine or kg/ha), and the calculator derives the required product quantity from the product's declared concentration.

## 2. Non-negotiable rule (requirement zero)

**No platform may silently reinterpret a `nutrientTarget` record as `perHectare` or `perVine`, and no platform may discard a record's saved nutrient analysis.**

- The live database enum already permits `fertiliser_records.calculation_mode ∈ {perHectare, perVine, nutrientTarget, fertigation}` (SQL 110/111). Records in these modes can exist today.
- Any platform that does not understand a stored `calculation_mode` MUST display the record read-only with a clear "mode not supported by this version" notice, showing the stored values verbatim. It MUST NOT reopen the record in an editable calculator under a different mode, MUST NOT overwrite `calculation_mode` on save, and MUST NOT drop fields it does not understand.
- Known current violation (Portal, to be fixed as a standalone bug fix independent of this feature): `FertiliserCalculatorPage.tsx:312,323` and `FertiliserCalculatorDialog.tsx:246,249` treat every non-`perVine` mode as `perHectare`. Until fixed, a `nutrientTarget` record created on mobile would be displayed and reopened as per-hectare on Portal.

## 3. Product analysis model (full analysis list)

Today's saved product stores only `nitrogen_percent`, `phosphorus_percent`, `potassium_percent`, plus `analysis_basis` and density. That cannot express Ca, Mg, S, micronutrients, or custom nutrients.

Proposed replacement (additive — existing N/P/K columns stay for backward compatibility and are mirrored into the list by the migration):

```
product_nutrient_analysis (new table, or jsonb column on saved_chemicals — ChatGPT to decide)
  product_id        uuid  -> saved_chemicals.id
  nutrient_key      text  -- canonical key, e.g. "N","P","K","Ca","Mg","S","Fe","Mn","Zn","Cu","B","Mo","Cl","Si","Co", or "other:<slug>"
  display_name      text  -- e.g. "Zinc", or the grower's custom name for other:*
  percent           numeric NOT NULL CHECK (percent > 0 AND percent <= 100)
  analysis_basis    text  -- "elemental" | "oxide" (e.g. K as K2O, P as P2O5)
  concentration_basis text -- "w/w" (weight/weight, solids) | "w/v" (weight/volume, liquids; requires density)
  is_primary        boolean
```

Rules:
- Elemental vs oxide basis is stored per nutrient and shown next to every percentage. Conversion between oxide and elemental forms is NOT performed automatically in v1; the percentage is used as declared, and the basis label travels with it everywhere it is displayed.
- `w/v` concentrations do NOT require density: the percentage already expresses nutrient mass per product volume (e.g. 16% w/v = 16 g nutrient per 100 mL product, so a 2 g nutrient target needs 12.5 mL product). Density (kg/L) IS required when converting a `% w/w` concentration on a liquid product into a volume-based application quantity; if that density is missing, the calculator blocks the calculation and says why.
- `other:<slug>` supports grower-defined nutrients; `display_name` is mandatory for those.

## 4. Record payload (what a saved nutrientTarget record must carry)

Existing `fertiliser_records` columns are reused where possible; new columns (ChatGPT to confirm names/types):

```
calculation_mode        = "nutrientTarget"
nutrient_key            text NOT NULL        -- selected nutrient
nutrient_display_name   text NOT NULL
target_rate             numeric NOT NULL     -- grower's target
target_rate_unit        text NOT NULL        -- "g/vine" | "kg/ha"
nutrient_percent        numeric NOT NULL     -- percentage actually used (product-derived or manual)
nutrient_percent_source text NOT NULL        -- "product_analysis" | "manual"
analysis_basis          text                 -- elemental | oxide, copied from product
concentration_basis     text                 -- w/w | w/v
product_density_kg_per_l numeric             -- snapshot when used
product_analysis_snapshot jsonb NOT NULL     -- full declared analysis of the product at save time
```

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

Unchanged from the existing fertiliser matrix: owner/manager/supervisor write, operator read, costs visible to owner/manager only. Product analysis editing follows the existing saved-chemical permissions (owner/manager).

## 8. Portal compatibility review (Lovable, this turn — no code changed)

Verified against current source:

1. **Mode misread (critical, §2):** `FertiliserCalculatorPage.tsx:312,323` and `FertiliserCalculatorDialog.tsx:246,249` collapse every non-`perVine` mode to `perHectare`. Must become: unknown/unsupported mode → read-only display, never editable re-open, never rewritten on save.
2. **Type union:** `FertiliserCalculationMode` in `src/lib/fertiliserCalc.ts:15` is only `"perHectare" | "perVine"`; the query layer (`fertiliserRecordsQuery.ts:26`) already types it as `string`, so no DB read breaks — the narrowing happens only in UI.
3. **Product model gap:** Portal's saved-product form stores N/P/K + `analysis_basis` + density only; no place for the full analysis list. Portal UI work waits for the approved schema.
4. **Costs/inventory:** Portal already resolves product cost via SQL 264 season prices and inventory via the Chemical Inventory summary RPC — both are mode-agnostic and reusable as-is.
5. **Safeguards Portal will need when implementing:** (a) unsupported-mode read-only guard (the §2 fix); (b) density-required blocker for w/w liquids converted to volume (w/v needs no density); (c) basis labels (elemental/oxide, w/w vs w/v) shown wherever a percentage appears; (d) snapshot written at save and preferred over live product data on display; (e) gate flag defaulting off.

## 9. Open questions for reviewers

- ChatGPT: new table vs jsonb column for the analysis list; exact new column names on `fertiliser_records`; whether oxide↔elemental conversion factors belong in the DB later.
- Rork: confirm current iOS/Android behaviour when reading an unknown `calculation_mode`; confirm offline persistence can store the snapshot jsonb; confirm the mode gate mechanism.
- All: agreed canonical nutrient key list and display names (proposal in §3).

## 10. Sequence

1. Rork + Lovable review this draft; changes returned.
2. Contract v1.0 agreed.
3. ChatGPT implements and verifies the migration (additive only).
4. Lovable ships the §2 unsupported-mode guard on Portal (can ship earlier — it is a bug fix).
5. Rork + Lovable implement behind gates; cross-platform testing; gates lifted together.
