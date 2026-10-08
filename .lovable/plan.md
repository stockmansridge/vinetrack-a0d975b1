# Crew / External Contractors — inspection findings and implementation plan

## What exists today

- **Team (internal, signed-in people):** `src/pages/Team.tsx` (route `/team`). Names come from `get_vineyard_team_members` through `src/hooks/useTeamLookup.ts`. Membership comes from `vineyard_members` through `fetchVineyardMembersWithCategory`. Vineyard Settings (`src/pages/setup/VineyardSettingsPage.tsx`) has no Team or Crew section.
- **Work Task "Assigned to":** `AssigneePicker` in `src/pages/setup/WorkTasksPage.tsx` (around lines 357–369 and 1066–1130). It is a searchable Command popover that lists only vineyard members and writes `work_tasks.assigned_to` (uuid, linked to `profiles`). Completion display uses `resolveCompletedBy` in this order: `completed_by`, then the linked trip operator, then `finalized_by`.
- **Pruning "Worker / crew":** a free-text `Input` in `src/components/pruning/PruningActivityDialog.tsx` (around line 454) and in `EditPruningDialog.tsx`. It saves as `worker_or_crew` text on the activity through `activityObject()` in `src/lib/pruningActivityContract.ts`. That goes through the shared `record_pruning_activity` / `update_pruning_activity` functions (`src/lib/pruningActivityApi.ts`), which are owned by Rork. Linked entries, history, reports and the Work Task link (`work_task_id`) read the same text (`pruningQuery.ts`, `pruningActivityQuery.ts`, `ActivityHistory.tsx`). No person or crew id is stored, so existing records are plain names only.
- **Permission helpers on the shared database** (documented in `docs/supabase-schema.md` and used by the existing SQL): `is_vineyard_member(vineyard)`, `has_vineyard_role(vineyard, roles[])`, `is_vineyard_owner_or_manager(vineyard)`. The house pattern is: members can read, role-gated insert/update, no client deletes, and soft delete through an RPC.

## Proposed schema (shared database, Rork applies; I won't run it)

1. New table `public.vineyard_external_resources`:
   - Columns: `id`, `vineyard_id`, `name`, `kind` (`crew` or `contractor`), optional `contact_name`, `phone`, `email`, `notes`, `is_active`, `created_by`, `created_at`, `updated_at`, `deleted_at`.
   - The name must be unique within a vineyard, ignoring case, for rows that are not deleted.
   - Grants to `authenticated`; RLS on.
   - Read: `is_vineyard_member(vineyard_id)`.
   - Add and edit: `has_vineyard_role(vineyard_id, array['owner','manager'])`. Supervisor access is for you to decide.
   - Removal: `soft_delete_vineyard_external_resource(p_id)` (security definer, same role check). No client deletes.
   - No login, profile or membership is created, so an external resource can never act as a signed-in user.
2. `work_tasks.assigned_external_resource_id uuid null`, linked to the new table.
   - A check prevents setting it together with `assigned_to`.
   - `assigned_to`, `completed_by` and `completed_at` are unchanged.
3. Pruning activities: add `external_resource_id uuid null`, plus an optional internal `worker_user_id`.
   - `record_pruning_activity` / `update_pruning_activity` accept these keys and check the id belongs to the same vineyard.
   - `worker_or_crew` text keeps the chosen name, so older mobile builds, reports and history still work.
   - Old records stay as plain text; nothing is guessed from names.

No costing fields change: labour still comes from hours × rate.

## Portal implementation (after the schema is live)

1. `src/lib/externalResources.ts`: list, create, update and soft delete calls, plus a hook scoped to the selected vineyard.
2. Settings screen: a new "Crew & Contractors" card in `VineyardSettingsPage.tsx`, or its own page linked from Team. You can add, edit, deactivate and remove entries; it is read-only for roles that can't manage them.
3. Shared picker `src/components/people/ResourcePicker.tsx`:
   - One searchable list with two headings, "Team" (vineyard members) first and "Crew / contractors" (active external resources) second.
   - It returns `{type:'member', userId}`, `{type:'external', id}` or nothing (unassigned).
   - Inactive or removed resources still show by name on old records, marked "(inactive)".
4. Work Tasks: replace `AssigneePicker` with `ResourcePicker`.
   - Saving writes exactly one of `assigned_to` or `assigned_external_resource_id`; picking one clears the other.
   - The "Assigned to" column shows the external name with a "Contractor"/"Crew" badge.
   - Completed tasks still show the signed-in completer; an external crew is never shown as having completed one.
5. Pruning New and Edit dialogs: replace the text box with `ResourcePicker` plus an "Other (type a name)" option.
   - The display name is written to `worker_or_crew`, and the matching id to `external_resource_id` or `worker_user_id`.
   - Lists keep reading `worker_or_crew`, so nothing has to be filled in for past records.
6. Tests:
   - picker grouping and order
   - only one of the two assignment fields is ever set
   - pruning payload keeps the text and sets the right id
   - inactive resources still show on existing records

## Blockers

- All three schema changes and the pruning function updates need Rork, plus iOS/Android follow-up so mobile shows the same list.
- Until then, the Portal can only offer a picker that fills in names (no stored id), and I don't recommend that.
- The live permission rules on `work_tasks` and the pruning tables couldn't be read from this project. Before writing the migration, check that `assigned_external_resource_id` falls under the existing update rule.
