# Vineyard Insights RLS Proposal — Scout Reports & Vintage Notes (Portal)

Status: **PROPOSED — awaiting approval. Not executed.** No SQL in this document
has been run against any environment.

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
private `scout-photos` Storage objects. Ordinary vineyard members get
permission errors (the Portal shows an honest "access restricted" state —
never an empty list).

## Approved permission matrix (per Jonathan Hambrook)

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
- Global `vintage_note_types` (`vineyard_id IS NULL`) must be readable by any
  authenticated member for the add form; vineyard-specific types only by that
  vineyard's members.
- `scout-photos` Storage reads must follow the scout SELECT rule for the
  observation's vineyard (path is rooted by vineyard id).
- No service-role usage in the browser; all reads stay on the anon key + RLS.

## Proposed migration (review before applying)

```sql
-- 1. New helpers — deliberately separate from can_use_vineyard_insights so
--    the existing System-Admin-only Vintage Report generator is untouched.
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
    SELECT 1 FROM public.vineyard_members vm
    WHERE vm.vineyard_id = p_vineyard_id
      AND vm.user_id = auth.uid()
      AND vm.role IN ('owner', 'manager', 'supervisor')
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_vineyard_insights(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_vineyard_insights(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_add_vintage_notes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_add_vintage_notes(uuid) TO authenticated;

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

-- 3. Vintage notes: member read; owner/manager/supervisor insert.
CREATE POLICY vintage_notes_member_select ON public.vintage_notes
  FOR SELECT TO authenticated
  USING (public.can_view_vineyard_insights(vineyard_id));

CREATE POLICY vintage_notes_member_insert ON public.vintage_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_add_vintage_notes(vineyard_id)
    AND observed_by_user_id = auth.uid()
  );

-- 4. Note types: any member reads global types; members read their
--    vineyard's types.
CREATE POLICY vintage_note_types_member_select ON public.vintage_note_types
  FOR SELECT TO authenticated
  USING (
    vineyard_id IS NULL
    OR public.can_view_vineyard_insights(vineyard_id)
  );

-- 5. Private scout-photos Storage reads follow the scout SELECT rule.
--    Path convention: <vineyard_id>/<observation_id>/<file>.
CREATE POLICY scout_photos_storage_member_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'scout-photos'
    AND public.can_view_vineyard_insights((storage.foldername(name))[1]::uuid)
  );
```

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
DROP FUNCTION IF EXISTS public.can_add_vintage_notes(uuid);
DROP FUNCTION IF EXISTS public.can_view_vineyard_insights(uuid);
```

## Isolated role tests (run on a scratch project, not production)

1. Member (operator) of vineyard A: SELECT on all four scout tables returns
   rows for A, zero rows for vineyard B; INSERT into scout_visits fails.
2. Operator: INSERT into vintage_notes fails (42501); SELECT succeeds.
3. Supervisor: INSERT vintage_notes with own `observed_by_user_id` succeeds;
   with another user's id fails.
4. Member reads global note types and own-vineyard types; cannot read another
   vineyard's types.
5. Member signs/downloads a scout-photos object in own vineyard; same path
   for another vineyard fails.
6. System Admin non-member: existing `can_use_vineyard_insights` behaviour
   unchanged (Vintage Report generator still gated).
7. Anonymous: everything still denied.

## Open verification items

- Exact live policy names on each table (to confirm the new policies are
  additive, not replacements).
- Whether `is_vineyard_member` is already SECURITY DEFINER and callable in
  policy context (it is used by existing policies, so expected yes).
- The scout-photos path convention — confirmed as vineyard-rooted, but the
  exact folder depth should be checked against a real object name before
  applying policy 5.
