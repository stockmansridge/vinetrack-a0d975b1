# Saved chemical physical-unit correction — required shared-backend contract

Status: NOT deployed. The Portal UI (`src/components/chemicals/PhysicalUnitConsistency.tsx`) shows the
mismatch and a correction preview, and keeps "Confirm correction" disabled while
`SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED` is `false` in `src/lib/chemicalPhysicalUnitConsistency.ts`.
Nothing here was run against any database.

## 1. Fix the add-to-vineyard classifier

`chemical_v3_add_to_vineyard` calls `chemical_v3_physical_form(r.product_form)`. A read-only check showed it returns an
empty value for `'DRY FLOWABLE'`. Products must not fall back to liquid. The fix:

- Make `chemical_v3_physical_form` recognise the same explicit dry list as the Portal (`DRY FLOWABLE`, `DF`, `WG`, `WDG`, water
  dispersible granule(s), `WP`, wettable powder, `SP`, `SG`, granule(s), `GR`, dust, `DP`, powder). It should return `'solid'` for those,
  `'liquid'` for recognised liquid codes, and `NULL` otherwise.
- In `chemical_v3_add_to_vineyard`, when the form is `NULL`, leave `saved_chemicals.unit` / `product_form` / `pack_unit` NULL. Do not
  default them to `Litres` / `liquid` / `L`, and never convert opening stock quantities.

## 2. New correction function

```sql
public.correct_saved_chemical_physical_unit(
  p_saved_chemical_id uuid,
  p_expected_approved_revision_id uuid,
  p_expected_unit text,
  p_expected_product_form text,
  p_target_form text            -- only 'solid' accepted
) RETURNS jsonb                  -- { saved_chemical_id, unit, product_form, audit_id }
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

The function must check all of the following, and fail closed on any check:
1. `auth.uid()` is an `owner` or `manager` in `vineyard_members` for the row's `vineyard_id`. System Admin is not enough.
2. The row is not deleted. `chemical_v3_product_id` → product `status = 'approved'`, and `approved_revision_id = p_expected_approved_revision_id`.
   That revision has the same `product_id` and `review_status = 'approved'`.
3. `chemical_v3_physical_form(revision.product_form) = 'solid'`, and every `default_rate_options[].unit` numerator is g/kg.
4. Current `unit` / `product_form` equal the expected values (optimistic guard), and the current unit is a volume unit.
5. The update sets ONLY `unit = 'Kg'`, `product_form = 'solid'` and `updated_at`. It must not touch `pack_unit`, `pack_size`, `default_rates`,
   preferred rates, density, purchases, inventory, spray jobs, spray records or tank actuals.
6. It inserts an audit row in the same transaction: actor, vineyard, saved chemical, revision, before/after values and a timestamp.
7. `GRANT EXECUTE ... TO authenticated` only.

After it is deployed and verified, set `SAVED_CHEMICAL_UNIT_CORRECTION_RPC_DEPLOYED = true`.
