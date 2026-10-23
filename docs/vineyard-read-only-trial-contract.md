# Expired trial = read-only vineyard (Portal contract + server work still required)

Status: Portal implemented. **No SQL was changed or applied.** `get_my_vineyard_access_matrix` and the
trial/entitlement functions live in the shared VineTrack (iOS) database and are not in this repo, so
the server side below is a specification for ChatGPT/Rork to implement after owner review.

## 1. Access matrix rows (additive fields)

| Field | Type | Meaning |
|---|---|---|
| `can_write` | boolean | Missing => Portal treats as `true` (deploy-order safe). |
| `read_only_reason` | text \| null | `'trial_expired'` for an expired trial. |

Required outcomes:
- Expired **trial** with a live membership on the vineyard: `can_enter_vineyard=true`, `can_write=false`, `read_only_reason='trial_expired'`.
- Active trial, paid, legacy, manual grant, internal/unlimited, vineyard-funded subscription (including team members of that vineyard): `can_write=true`.
- Revoked / no membership / no relationship: unchanged (`can_enter_vineyard=false`).
- Write permission follows the entitlement that funds **the vineyard**, not the member's personal trial.

Portal transitional rule (until the server ships): a row with `can_enter_vineyard=false`, `is_trial=true`,
`vineyard_access_reason='expired'` and a non-null `membership_role` is shown read-only instead of blocked.
Anything else that is denied stays blocked.

## 2. Server write enforcement (not yet in place)

Add one helper, then call it from write paths:

```sql
-- Proposed; owner approval required. Must mirror the matrix's can_write decision exactly.
create or replace function public.vineyard_write_allowed(p_vineyard_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select /* same entitlement source as get_my_vineyard_access_matrix().can_write */ ...
$$;

-- Fixed error identifier the Portal recognises (message, hint or code containing VT_READ_ONLY):
-- raise exception 'VT_READ_ONLY' using errcode = 'P0001', hint = 'trial_expired';
```

- RLS: add `public.vineyard_write_allowed(vineyard_id)` to INSERT/UPDATE/DELETE policies only (never SELECT).
- Write RPCs: first statement `if not public.vineyard_write_allowed(<vineyard>) then raise exception 'VT_READ_ONLY' ...`.
- System Admin support sessions keep their existing bypass.

Tables the Portal writes directly (need write-policy enforcement): app_notices*, damage_records,
equipment_items, fertiliser_record_allocations, fertiliser_records, fuel_purchases, grape_allocation_blocks,
grape_allocations, grape_purchasers, historical_yield_records, maintenance_logs, paddocks, picking_records,
pins, pruning_seasons, resistance_plans, saved_chemicals, saved_inputs, spray_equipment, spray_job_paddocks,
spray_jobs, spray_records, tractor_photos, trips, vineyard_external_resources, vineyard_machines,
vineyard_materials, vineyard_members, vineyards, work_task_labour_lines, work_task_machine_lines,
work_task_materials, work_task_paddocks, work_task_piece_rate_rows, work_task_types, work_tasks, worker_types.
(*admin-only; feature_requests/comments/votes, profiles, support_requests are account-level — leave writable.)

Vineyard write RPCs: archive_/restore_/soft_delete_/hard_delete_* family, correct_spray_tank_actual_v1,
correct_spray_trip_metadata_v1, create_vineyard_spray_target, delete_damage_record,
delete_fertiliser_record_allocation, delete_paddock_soil_profile, delete_pruning_entry, duplicate_spray_job,
pin_row_backfill_create_approval, pin_row_backfill_apply, portal_upsert_tractor, portal_archive_tractor,
record_pruning_entry, record_skipped_pruning_entry, refresh_pruning_yield_estimates,
save_pruning_activity_labour_lines, save_spray_trip_worksheet_v1, set_pruning_activity_resource_cas,
set_pruning_entry_work_task, set_vineyard_location, set_vineyard_region_settings,
set_vineyard_season_settings, set_vineyard_yield_sampling_settings, update_pruning_entry,
update_skipped_pruning_entry, upsert_vineyard_grape_clone/variety/rootstock, upsert_worker_type,
create_invitation, cancel_invitation, resend_invitation, remove_member, update_member_role,
update_member_worker_type, plus the Chemical Purchase/Inventory and fertigation RPCs.

Must stay writable: record_my_client_activity, accept_invitation, decline_invitation,
create_vineyard_with_owner (account onboarding), billing/checkout edge functions, support requests,
profile/display name, System Admin functions.

## 3. Compatibility risks
- Older mobile builds will see raw errors once RLS enforcement lands; Rork should map `VT_READ_ONLY` to a
  purchase prompt and stop offline sync retries for it.
- Legacy/manual/unlimited sources must resolve to `can_write=true` or long-standing users lose editing.
