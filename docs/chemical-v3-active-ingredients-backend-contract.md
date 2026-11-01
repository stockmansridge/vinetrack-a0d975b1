# Chemical V3 ingredient correction deployment dependency

Status: Portal editor implemented; live saving DISABLED. No backend migration was applied. The available managed database tools target the separate Portal backend, not the shared vineyard backend; do not create this RPC there.

## Required shared-vineyard RPC

`public.chemical_v3_admin_set_active_ingredients(p_revision_id uuid, p_active_ingredients jsonb)`

- Use the deployed `chemical_v3_set_product_category` authorization pattern: authenticated System Admin only, deny anonymous/PUBLIC execution, grant authenticated execution, fixed/empty search path with qualified references.
- Lock the exact revision before checking and changing it; allow only `pending_review` / `needs_attention`. Never update approved/superseded/rejected revisions or product pointers.
- Require a JSON array of objects. Each entry has nonblank `name`, finite numeric `concentration` greater than zero, nonblank `concentration_unit` in the label's units. Preserve additional existing object keys. An empty array expresses explicit removal; existing core-field/approval checks must refuse incomplete chemistry rather than invent ingredients.
- Change only this revision's ingredients. Recompute ingredient-related completeness/unresolved flags through the existing authoritative review machinery, without clearing unrelated warnings/issues or assigning resistance groups by guesswork.
- Write an audit event in the SAME transaction using the deployed audit contract: authenticated actor, revision/product identity, timestamp, before/after ingredient JSON and correction action. Existing audit table/function names are not available here; do not invent a parallel audit schema.
- Retain the existing approval/promotion transaction as the only authority updating approved catalogue and vineyard chemical records; verify that it consumes the corrected revision ingredients, preserves unrelated fields, and refuses incomplete ingredients.

## Portal release gate / acceptance

`V3_INGREDIENT_SAVING_ENABLED` is false. The Portal currently permits drafting only; Save Ingredients is disabled and no new RPC runs. Enable only after the shared owner deploys the contract and a signed-in save/reload/approval workflow passes against safe test records.

The prepared client calls the RPC with exactly the two named arguments, then reloads the exact revision and requires identical ingredient JSON and an editable review status before confirmation. Editing or an unconfirmed save blocks Approve. No direct table update fallback exists.

Acceptance must cover non-admin/anonymous denial, both editable statuses, immutable approved revisions, invalid numbers/units/names, multiple ingredients and removal, audit before/after, save/read-back failures and mismatches, corrected approval promotion, and no changes to existing vineyard preferred/default rates or historical snapshots. Backend deployment, audit, promotion and live acceptance remain unverified.