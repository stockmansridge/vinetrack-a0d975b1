# Chemical V3 ingredient correction deployment dependency

Status: Backend owner confirmed the shared-vineyard RPC is DEPLOYED, including System Admin authorization, pending_review/needs_attention-only edits, approved-revision protection, missing-ingredient issue resolution, before/after auditing, and ingredient validation. Portal saving is enabled. No backend migration was applied by the Portal agent; do not duplicate this RPC in the separate Portal backend.

## Required shared-vineyard RPC

`public.chemical_v3_admin_set_active_ingredients(p_revision_id uuid, p_active_ingredients jsonb)`

- Use the deployed `chemical_v3_set_product_category` authorization pattern: authenticated System Admin only, deny anonymous/PUBLIC execution, grant authenticated execution, fixed/empty search path with qualified references.
- Lock the exact revision before checking and changing it; allow only `pending_review` / `needs_attention`. Never update approved/superseded/rejected revisions or product pointers.
- Require a JSON array of objects. Each entry has nonblank `name`, finite numeric `concentration` greater than zero, nonblank `concentration_unit` in the label's units. Preserve additional existing object keys. An empty array expresses explicit removal; existing core-field/approval checks must refuse incomplete chemistry rather than invent ingredients.
- Change only this revision's ingredients. Recompute ingredient-related completeness/unresolved flags through the existing authoritative review machinery, without clearing unrelated warnings/issues or assigning resistance groups by guesswork.
- Write an audit event in the SAME transaction using the deployed audit contract: authenticated actor, revision/product identity, timestamp, before/after ingredient JSON and correction action. Existing audit table/function names are not available here; do not invent a parallel audit schema.
- Retain the existing approval/promotion transaction as the only authority updating approved catalogue and vineyard chemical records; verify that it consumes the corrected revision ingredients, preserves unrelated fields, and refuses incomplete ingredients.

## Portal release gate / acceptance

`V3_INGREDIENT_SAVING_ENABLED` is true following the owner's deployment confirmation. Publication still requires a signed-in save/reload/approval workflow against safe test records.

The client calls the RPC with exactly the two named arguments and concentration_unit, then reloads the exact revision and requires ingredient JSON identical to the RPC's normalized saved response and an editable review status before confirmation. Editing or an unconfirmed save blocks Approve. Revision completeness is refreshed from this read; review issues, queue and approved catalogue queries are invalidated. No direct table update fallback exists.

Acceptance must cover non-admin/anonymous denial, both editable statuses, immutable approved revisions, invalid numbers/units/names, multiple ingredients and removal, audit before/after, save/read-back failures and mismatches, corrected approval promotion, and no changes to existing vineyard preferred/default rates or historical snapshots. Backend deployment/protections are owner-confirmed, not independently inspected here. Live audit and promotion acceptance remain unverified: managed preview session mint reports no auth users and cannot supply a shared-vineyard System Admin session.