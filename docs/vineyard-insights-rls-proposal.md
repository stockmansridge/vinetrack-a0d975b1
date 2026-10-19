# Vineyard Insights RLS Proposal — Scout Reports & Vintage Notes (Portal)

Status: **PROPOSED FOR APPROVAL — not approved, not executed.** No SQL in this
document has been run against any environment. The permission matrix below is
a proposal awaiting Jonathan Hambrook's explicit approval; nothing here is
authorised for migration execution.

## Why

The Portal now ships read-only Scout Reports and read/create Vintage Notes
frontend. The production gate behind every insights table is:

```sql
public.can_use_vineyard_insights(vineyard_id uuid)
-- current behaviour: is_system_admin() AND is_vineyard_member(vineyard_id)
```

So today only System Administrators who are also members can read or write
`scout_visits`, `scout_block_assessments`, `scout_observations`,
`scout_observation_photos`, `vintage_notes`, `vintage_note_types`, and the
private `scout-photos` Storage objects.

Important correction from review: ordinary members do **not** reliably get a
permission error — PostgreSQL RLS SELECT silently filters disallowed rows, so
a blocked member sees an EMPTY result. The Portal therefore runs an explicit
access preflight (`can_use_vineyard_insights` RPC) before trusting any empty
list, and shows "access restricted" / "couldn't confirm access" states instead
of a false empty history.

## Proposed permission matrix (NOT yet approved)

| Surface | Owner | Manager | Supervisor | Operator |
|---|---|---|---|---|
| Scout Reports (read) | ✓ | ✓ | ✓ | ✓ |
| Vintage Notes (read) | ✓ | ✓ | ✓ | ✓ |
| Vintage Notes (add) | ✓ | ✓ | ✓ | — (read-only) |
| Scouting capture / edit / delete / complete | mobile-only, unchanged |
| Vintage Report generator | System Admin only, unchanged |

## Design constraints

- Do **not** widen Scout write/delete/photo permissions. Only SELECT widens
  for scout tables; mutation policies keep the current gate.
- Vintage Notes need distinct SELECT (all members) and INSERT
  (owner/manager/supervisor) controls.
- `is_vineyard_member(vineyard_id)` recognises BOTH `vineyards.owner_id` and
  `vineyard_members` rows. All helpers must build on it so a genuine owner
  without a duplicated membership row is never locked out.
- Global `vintage_note_types` (`vineyard_id IS NULL`) must NOT be readable by
  an authenticated account with no vineyard membership at all; scope the
  global catalogue to users with at least one authorised vineyard.
- `scout-photos` Storage reads must follow the scout SELECT rule for the
  observation's vineyard, parsed with the existing safe
  `public.storage_first_folder_uuid(name)` (never `(storage.foldername(name))[1]::uuid`,
  which can throw on malformed paths).
- No service-role usage in the browser; all reads stay on the anon key + RLS.

## Known reconciliation issue — existing INSERT policy (review-gated decision)

All existing policies are PERMISSIVE (OR-ed). The live
`vintage_notes_insert_insights` policy permits any System Admin who is also a
member — including a System Admin whose vineyard role is Operator. Simply
ADDING the new insert policy does not strictly enforce the proposed
operator-read-only matrix, because the old policy still ORs in.

Options (needs an explicit decision before any migration):

- **Option A (recommended):** leave the legacy policy untouched. Legacy mobile
  writes by System-Admin Operators keep working; the Portal UI independently
  hides the Add control for Operators. The matrix is enforced at the Portal
  layer only, and the document record notes the backend exception.
- **Option B:** rewrite `vintage_notes_insert_insights` to
  `can_use_vineyard_insights(vineyard_id) AND <role check>`, so System-Admin
  Operators lose insert rights everywhere. This changes existing mobile
  behaviour and must be confirmed with Rork before it is considered.

Either way, the new insert policy must also demand:
`observed_by_user_id = auth.uid()` (no author spoofing), `vineyard_id` equal to
a vineyard the writer may add notes to (no cross-vineyard spoofing), and —
when `note_type_id` is set — that the type row is global
(`vineyard_id IS NULL`) or belongs to the SAME vineyard.

## Proposed migration (review before applying)

```sql
-- 1. New helpers — deliberately separate from can_use_vineyard_insights so
--    the existing System-Admin-only Vintage Report generator is untouched.
--    Both build on is_vineyard_member, which covers vineyards.owner_id as
--    well as vineyard_members rows.
CREATE OR REPLACE FUNCTION public.can_view_vineyard_insights(p_vineyard_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_vineyard_member(p_vineyard_id)
$$;

CREATE OR REPLACE FUNCTION public.can_add_vintage_notes(p_vineyard_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Owner via the vineyards row itself (no membership row required)…
    SELECT 1 FROM public.vineyards v
    WHERE v.id = p_vineyard_id AND v.owner_id = auth.uid()
  ) OR EXISTS (
    -- …or an owner/manager/supervisor membership row.
    SELECT 1 FROM public.vineyard_members vm
    WHERE vm.vineyard_id = p_vineyard_id
      AND vm.user_id = auth.uid()
      AND vm.role IN ('owner', 'manager', 'supervisor')
  )
$$;

-- True when the caller belongs to at least one vineyard (gates the global
-- note-type catalogue so unrelated authenticated accounts cannot read it).
CREATE OR REPLACE FUNCTION public.has_any_vineyard_membership()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vineyards v WHERE v.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.vineyard_members vm WHERE vm.user_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_vineyard_insights(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_vineyard_insights(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_add_vintage_notes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_add_vintage_notes(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.has_any_vineyard_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_any_vineyard_membership() TO authenticated;

-- 2. Scout tables: add member SELECT policies alongside the existing ones.
--    (Policy names adjusted to the live ones at apply time.)
CREATE POLICY scout_visits_member_select ON public.scout_visits
  FOR SELECT TO authenticated
  USING (public.can_view_vineyard_insights(vineyard_id));

CREATE POLICY scout_assessments_member_select ON public.scout_block_assessments
  FOR SELECT TO authenticated
  USING (public.can_view_vineyard_insights(vineyard_id));

CREATE POLICY scout_observations_member_select ON public.scout_observations
  FOR SELECT TO authenticated
  USING (public.can_view_vineyard_insights(vineyard_id));

CREATE POLICY scout_photos_member_select ON public.scout_observation_photos
  FOR SELECT TO authenticated
  USING (public.can_view_vineyard_insights(vineyard_id));

-- 3. Vintage notes: member read; owner/manager/supervisor insert with
--    anti-spoofing checks.
CREATE POLICY vintage_notes_member_select ON public.vintage_notes
  FOR SELECT TO authenticated
  USING (public.can_view_vineyard_insights(vineyard_id));

CREATE POLICY vintage_notes_member_insert ON public.vintage_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_add_vintage_notes(vineyard_id)
    AND observed_by_user_id = auth.uid()
    AND (
      note_type_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.vintage_note_types t
        WHERE t.id = note_type_id
          AND t.deleted_at IS NULL
          AND (t.vineyard_id IS NULL OR t.vineyard_id = vintage_notes.vineyard_id)
      )
    )
  );

-- 4. Note types: global catalogue only for users with at least one
--    authorised vineyard; vineyard-specific types only for that vineyard.
CREATE POLICY vintage_note_types_member_select ON public.vintage_note_types
  FOR SELECT TO authenticated
  USING (
    (vineyard_id IS NULL AND public.has_any_vineyard_membership())
    OR public.can_view_vineyard_insights(vineyard_id)
  );

-- 5. Private scout-photos Storage reads follow the scout SELECT rule.
--    Path convention: <vineyard_id>/<observation_id>/<file>; parsed with the
--    existing safe helper, never a casting subscript.
CREATE POLICY scout_photos_storage_member_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'scout-photos'
    AND public.can_view_vineyard_insights(public.storage_first_folder_uuid(name))
  );
```

## Policy diff summary

- ADDED: 3 helper functions, 4 scout SELECT policies, 1 vintage_notes SELECT,
  1 vintage_notes INSERT, 1 vintage_note_types SELECT, 1 storage SELECT.
- CHANGED: nothing. No existing policy, function, grant or trigger is
  modified or dropped. Scout INSERT/UPDATE/DELETE, the System-Admin Vintage
  Report gate, mobile sync/ownership and historical rows are untouched.
- The legacy `vintage_notes_insert_insights` exception (System-Admin
  Operators) is documented under "Known reconciliation issue" and requires a
  separate decision before any change.

## Rollback

```sql
DROP POLICY IF EXISTS scout_photos_storage_member_select ON storage.objects;
DROP POLICY IF EXISTS vintage_note_types_member_select ON public.vintage_note_types;
DROP POLICY IF EXISTS vintage_notes_member_insert ON public.vintage_notes;
DROP POLICY IF EXISTS vintage_notes_member_select ON public.vintage_notes;
DROP POLICY IF EXISTS scout_photos_member_select ON public.scout_observation_photos;
DROP POLICY IF EXISTS scout_observations_member_select ON public.scout_observations;
DROP POLICY IF EXISTS scout_assessments_member_select ON public.scout_block_assessments;
DROP POLICY IF EXISTS scout_visits_member_select ON public.scout_visits;
DROP FUNCTION IF EXISTS public.has_any_vineyard_membership();
DROP FUNCTION IF EXISTS public.can_add_vintage_notes(uuid);
DROP FUNCTION IF EXISTS public.can_view_vineyard_insights(uuid);
```

## Isolated role tests (run on a scratch project, not production)

1. Member (operator) of vineyard A: SELECT on all four scout tables returns
   rows for A, zero rows for vineyard B; INSERT into scout_visits fails.
2. Operator: INSERT into vintage_notes fails (42501); SELECT succeeds.
3. Supervisor: INSERT vintage_notes with own `observed_by_user_id` succeeds;
   with another user's id fails; with a note_type_id belonging to another
   vineyard fails.
4. Vineyard owner with NO vineyard_members row: SELECT and INSERT both
   succeed (owner_id path).
5. Member reads global note types and own-vineyard types; cannot read another
   vineyard's types. Authenticated user with NO vineyard anywhere: global
   note types return zero rows.
6. Member signs/downloads a scout-photos object in own vineyard; same path
   for another vineyard fails; malformed object names do not error the policy.
7. System Admin non-member: existing `can_use_vineyard_insights` behaviour
   unchanged (Vintage Report generator still gated). System-Admin Operator:
   legacy insert behaviour per the chosen reconciliation option.
8. Anonymous: everything still denied.

## Open verification items

- Exact live policy names on each table (to confirm the new policies are
  additive, not replacements).
- Whether `is_vineyard_member` is already SECURITY DEFINER and callable in
  policy context (it is used by existing policies, so expected yes).
- The scout-photos path convention — confirmed as vineyard-rooted, but the
  exact folder depth should be checked against a real object name before
  applying policy 5.
- The reconciliation decision for `vintage_notes_insert_insights`
  (Option A vs Option B above) — requires explicit owner approval, and Rork
  sign-off for Option B.
