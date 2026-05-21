# Team & Invitations — Backend Contract Spec (for Rork / iOS Supabase project)

This spec covers the backend work the Lovable portal needs in order to:

1. Permanently clean up duplicate `operator_categories` and prevent future ones.
2. Let owners/managers invite users, manage roles, and assign operator
   categories from the portal using **the same** invite/member system the
   iOS app uses (no Lovable-only flow).

The Lovable portal will not build the Invite User UI until these RPCs are
live and tested on the shared (iOS) Supabase project. Until then, the
portal does client-side dedupe of the operator category dropdown only.

Target project: iOS Supabase project (`tbafuqwruefgkbyxrxyb`).
Conventions match existing schema (`docs/supabase-schema.md`).

---

## 1. Operator categories — dedupe + prevention

### 1.1 Detect duplicates

A duplicate is any row in `operator_categories` (where `deleted_at IS NULL`)
sharing the same `(vineyard_id, lower(btrim(name)) collapsed-whitespace,
cost_per_hour)` with another row.

### 1.2 Migration: dedupe existing data

For each vineyard, for each duplicate group:

1. Choose the **kept** row:
   - Most recent `updated_at` (fallback `created_at`).
   - Tiebreak: row with a non-null `cost_per_hour`.
   - Final tiebreak: lowest `id`.
2. Reassign references on the **dupes** to the kept row:
   - `UPDATE vineyard_members SET operator_category_id = <kept_id>
      WHERE operator_category_id IN (<dupe_ids>);`
   - Any other tables that FK to `operator_categories` (e.g. `work_tasks`
     `resources jsonb`, trip cost allocations) — Rork to audit and patch
     in the same migration. The portal currently only reads/writes
     `vineyard_members.operator_category_id`.
3. **Soft-delete** the dupes:
   `UPDATE operator_categories SET deleted_at = now(),
    updated_at = now(), updated_by = <system uid or null>,
    sync_version = sync_version + 1
    WHERE id IN (<dupe_ids>);`
   Do **not** hard-delete (sync clients need to see the tombstone).

### 1.3 Prevention: partial unique index

```sql
CREATE UNIQUE INDEX IF NOT EXISTS operator_categories_vineyard_name_cost_uniq
ON public.operator_categories (
  vineyard_id,
  lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))),
  COALESCE(cost_per_hour, -1)
)
WHERE deleted_at IS NULL;
```

This must be created **after** 1.2 completes successfully.

### 1.4 Application-side upsert RPC (preferred over raw insert)

```
upsert_operator_category(
  p_vineyard_id uuid,
  p_name text,
  p_cost_per_hour numeric
) returns operator_categories
```

Behaviour:
- Auth: owner/manager/supervisor of `p_vineyard_id`.
- If a live row exists with the same `(vineyard_id, normalised name,
  cost_per_hour)`, return it (idempotent — clients can stop creating dupes).
- Otherwise insert.
- If a soft-deleted row exists for the same normalised key, restore it
  (`deleted_at = NULL`, bump `sync_version`).

The Lovable portal will switch `createOperatorCategory` to call this RPC
once it exists.

### 1.5 Merge RPC (optional but useful)

```
merge_operator_categories(p_keep_id uuid, p_dupe_ids uuid[]) returns void
```

Owner/manager only. Reassigns references then soft-deletes the dupes,
same logic as 1.2. Useful for manual cleanup in the admin UI later.

---

## 2. Invitations — create / cancel / resend

`invitations` table and `accept_invitation(id)` / `decline_invitation(id)`
already exist (`docs/supabase-schema.md` §3.4). What's missing is the
**creation** side.

### 2.1 `create_invitation`

```
create_invitation(
  p_vineyard_id uuid,
  p_email text,
  p_role text,                       -- 'owner' | 'manager' | 'supervisor' | 'operator'
  p_operator_category_id uuid = null,
  p_message text = null,
  p_expires_in_days int = 14
) returns invitations
```

Behaviour:
- Auth: caller must be `owner` or `manager` of `p_vineyard_id`.
  - Managers may not invite as `owner` (only owners can create owners).
- Normalise `p_email` (`lower(btrim(...))`).
- If the email already maps to a `vineyard_members` row for this
  vineyard (live), raise `EXCEPTION ... ERRCODE = 'P0001'` with message
  `"User is already a member"`.
- If a `pending` invitation already exists for `(vineyard_id, lower(email))`
  (the existing partial unique index), return that row instead of
  creating a duplicate (idempotent).
- Otherwise insert with:
  - `status = 'pending'`
  - `invited_by = auth.uid()`
  - `expires_at = now() + (p_expires_in_days || ' days')::interval`
- Persist `p_operator_category_id` and `p_message` (add nullable columns
  `default_operator_category_id uuid` and `message text` to `invitations`
  if not present; they're carried through to `accept_invitation` so the
  new `vineyard_members` row gets the operator category pre-set).
- Side effect: enqueue the invitation email via whatever mechanism iOS
  already uses (Lovable portal will not own the email pipeline).

### 2.2 `cancel_invitation`

```
cancel_invitation(p_id uuid) returns invitations
```

Auth: owner/manager of the invitation's vineyard, or the `invited_by`
user. Sets `status = 'cancelled'`, `updated_at = now()`. Only allowed
when current status is `pending`.

### 2.3 `resend_invitation`

```
resend_invitation(p_id uuid, p_extend_days int = 14) returns invitations
```

Auth: owner/manager of the invitation's vineyard. Only when current
status is `pending` or `expired`. Sets
`status = 'pending'`, `expires_at = now() + p_extend_days`, bumps
`updated_at`, and triggers the email side effect again.

### 2.4 List for a single vineyard

The portal currently only has `admin_list_invitations` (system-admin
scoped). Please add:

```
list_vineyard_invitations(p_vineyard_id uuid)
  returns table (
    id uuid,
    email text,
    role text,
    status text,
    default_operator_category_id uuid,
    invited_by uuid,
    invited_by_display_name text,
    invited_by_email text,
    created_at timestamptz,
    updated_at timestamptz,
    expires_at timestamptz
  )
```

Auth: any `vineyard_members` row for `p_vineyard_id` may SELECT (read-only
visibility for the whole team is fine), or restrict to owner/manager if
you prefer — please confirm which.

---

## 3. Membership management

### 3.1 `update_member_role`

```
update_member_role(p_membership_id uuid, p_new_role text) returns vineyard_members
```

Auth: owner of the vineyard. Must honour the existing
`prevent_last_owner_loss` trigger — i.e. you cannot demote the final
owner. Managers may **not** change roles (confirm with iOS behaviour).

### 3.2 `update_member_operator_category`

```
update_member_operator_category(
  p_membership_id uuid,
  p_operator_category_id uuid
) returns vineyard_members
```

Auth: owner/manager of the vineyard. The portal currently does this with
a direct `UPDATE` against `vineyard_members`; moving it behind an RPC
lets us add audit logging and use a single permission check. Until this
ships, the portal keeps using the direct update — no rush.

### 3.3 `remove_member`

```
remove_member(p_membership_id uuid) returns void
```

Auth: owner of the vineyard. Cannot remove the last owner
(`prevent_last_owner_loss`). Performs a hard delete of the
`vineyard_members` row (matching current iOS behaviour) **unless** iOS
already soft-deletes — please confirm and align.

A user removing themselves (`auth.uid() = vineyard_members.user_id`)
should also be permitted regardless of role, except for the last owner.

---

## 4. RLS expectations (summary)

| Object | SELECT | INSERT / writes |
| --- | --- | --- |
| `operator_categories` | members of the vineyard | owner / manager / supervisor (via RPCs above) |
| `invitations` | members of the vineyard (via `list_vineyard_invitations`) + the invited email's user | owner / manager via RPCs only; no direct inserts from clients |
| `vineyard_members` | members of the vineyard | owner / manager via RPCs only; no direct role changes from clients |

All RPCs should be `SECURITY DEFINER` with `set search_path = public`,
and must raise `42501` for unauthorised callers so the existing portal
error mapper surfaces a friendly message.

---

## 5. Portal cut-over checklist (after Rork ships)

Once the above is live on the shared project, the Lovable portal will:

1. Switch `createOperatorCategory` to `upsert_operator_category`.
2. Remove the client-side `dedupeOperatorCategories` step from the Team
   dropdown (or keep as belt-and-braces).
3. Add the Team page UI:
   - `+ Invite user` button (owner/manager).
   - Invite dialog (email, role, default operator category, optional message).
   - **Active members** table with role editor (owner only), category
     editor (owner/manager), remove button (owner; self-removal allowed).
   - **Pending invitations** table with cancel + resend (owner/manager).
4. Reuse the same email pipeline — no Lovable-only invite flow.

Until then, the portal:

- Deduplicates the operator category dropdown on the Team page.
- Shows an admin notice on the Operator Categories page when duplicates
  are detected, telling the user the cleanup is pending.
- Does **not** expose an Invite User button.
