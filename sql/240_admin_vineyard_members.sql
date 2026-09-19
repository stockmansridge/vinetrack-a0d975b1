-- ============================================================================
-- SQL 240 — System Admin: per-vineyard member list + member role change
-- ============================================================================
-- Problem: the System Admin → Vineyard detail page shows only an aggregate
-- member_count. There is no admin-scoped way to see WHO belongs to a
-- vineyard or to fix a member's access (role) without being a member
-- yourself. The member-scoped RPCs (get_vineyard_team_members,
-- update_member_role) intentionally require vineyard membership, so the
-- portal cannot reuse them for support/admin work.
--
-- Fix: two admin RPCs, same authorisation pattern as SQL 210–212
-- (SECURITY DEFINER + explicit public.is_system_admin() check, EXECUTE for
-- authenticated only).
--
--   admin_list_vineyard_members(p_vineyard_id)
--     One row per live membership with profile email / name for display.
--
--   admin_set_member_role(p_membership_id, p_new_role)
--     Changes vineyard_members.role. Honours the last-owner invariant
--     explicitly (same protection as the prevent_last_owner_loss trigger,
--     which also still fires) so the portal gets a friendly P0001 message.
--
-- Purely additive: no existing function, table, policy or grant is changed,
-- so iOS / Android are unaffected.
-- ============================================================================

BEGIN;

-- ---------- admin_list_vineyard_members ----------

CREATE OR REPLACE FUNCTION public.admin_list_vineyard_members(p_vineyard_id uuid)
RETURNS TABLE (
  membership_id  uuid,
  user_id        uuid,
  role           text,
  display_name   text,
  email          text,
  full_name      text,
  worker_type_id uuid,
  joined_at      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.user_id,
         m.role,
         m.display_name,
         p.email,
         p.full_name,
         m.worker_type_id,
         m.joined_at
    FROM public.vineyard_members m
    LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE m.vineyard_id = p_vineyard_id
   ORDER BY
     CASE m.role
       WHEN 'owner' THEN 0
       WHEN 'manager' THEN 1
       WHEN 'supervisor' THEN 2
       ELSE 3
     END,
     m.joined_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_vineyard_members(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_vineyard_members(uuid) TO authenticated;

-- ---------- admin_set_member_role ----------

CREATE OR REPLACE FUNCTION public.admin_set_member_role(
  p_membership_id uuid,
  p_new_role      text
)
RETURNS public.vineyard_members
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.vineyard_members%ROWTYPE;
  v_owners  integer;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;

  IF p_new_role NOT IN ('owner', 'manager', 'supervisor', 'operator') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_member
    FROM public.vineyard_members
   WHERE id = p_membership_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002';
  END IF;

  -- Last-owner protection (explicit, so the portal can show a clear message;
  -- the prevent_last_owner_loss trigger remains as the backstop).
  IF v_member.role = 'owner' AND p_new_role <> 'owner' THEN
    SELECT count(*) INTO v_owners
      FROM public.vineyard_members
     WHERE vineyard_id = v_member.vineyard_id
       AND role = 'owner'
       AND id <> v_member.id;
    IF v_owners = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of the vineyard'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.vineyard_members
     SET role = p_new_role
   WHERE id = p_membership_id
   RETURNING * INTO v_member;

  RETURN v_member;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_member_role(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_member_role(uuid, text) TO authenticated;

COMMIT;

-- Verification
-- 1. As a system admin:
--      select * from public.admin_list_vineyard_members('<vineyard_id>');
--      select public.admin_set_member_role('<membership_id>', 'manager');
-- 2. Demoting the only owner must fail with P0001
--    'Cannot demote the last owner of the vineyard'.
-- 3. As a non-admin authenticated user both calls must fail with 42501.
