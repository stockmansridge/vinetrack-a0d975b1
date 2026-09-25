-- 254: System Admin support access to every vineyard
-- ---------------------------------------------------------------------------
-- HANDOFF FOR RORK — NOT APPLIED. Confirm 254 is the next free number.
--
-- Purpose: a "hidden" support authority. System Admins (public.is_system_admin())
-- can read any vineyard's data and fix block layouts, WITHOUT being added as a
-- vineyard member. Nothing changes in vineyard_members, so the vineyard
-- dropdown, member lists, billing seats and invites are unaffected.
--
-- Design:
--   * Adds NEW permissive policies only. Existing policies are untouched, and
--     permissive policies are OR'd, so no customer loses or gains access.
--   * READ on every public table that has a vineyard_id column, plus vineyards.
--   * WRITE (insert/update) on paddocks only — block layout repair.
--     No delete. Hard/soft delete stays with owners/managers via existing RPCs.
--   * Idempotent: policies are created only if missing.
--   * Tables without RLS enabled are skipped (policies would have no effect).
-- ---------------------------------------------------------------------------

BEGIN;

-- Read access: vineyards
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'vineyards'
       AND policyname = 'system_admin_support_select'
  ) THEN
    EXECUTE 'CREATE POLICY system_admin_support_select ON public.vineyards
               FOR SELECT TO authenticated USING (public.is_system_admin())';
  END IF;
END $$;

-- Read access: every RLS-enabled public table with a vineyard_id column
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity
       AND a.attname = 'vineyard_id'
       AND NOT a.attisdropped
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t.relname
         AND policyname = 'system_admin_support_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY system_admin_support_select ON public.%I
           FOR SELECT TO authenticated USING (public.is_system_admin())',
        t.relname);
    END IF;
  END LOOP;
END $$;

-- Write access: paddocks (block layout repair)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'paddocks'
       AND policyname = 'system_admin_support_update'
  ) THEN
    EXECUTE 'CREATE POLICY system_admin_support_update ON public.paddocks
               FOR UPDATE TO authenticated
               USING (public.is_system_admin())
               WITH CHECK (public.is_system_admin())';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'paddocks'
       AND policyname = 'system_admin_support_insert'
  ) THEN
    EXECUTE 'CREATE POLICY system_admin_support_insert ON public.paddocks
               FOR INSERT TO authenticated
               WITH CHECK (public.is_system_admin())';
  END IF;
END $$;

COMMIT;

-- Verify (read-only):
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND policyname LIKE 'system_admin_support_%'
--  ORDER BY tablename, cmd;
