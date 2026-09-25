-- 254: System Admin support access to every vineyard
-- ---------------------------------------------------------------------------
-- HANDOFF FOR RORK. Confirm 254 is the next free number.
--
-- Purpose: a "hidden" support authority. System Admins (public.is_system_admin())
-- can read any vineyard's data and fix block layouts, WITHOUT being added as a
-- vineyard member. vineyard_members is untouched, so the vineyard dropdown,
-- member lists, billing seats and invites are unaffected.
--
-- Design:
--   * Adds NEW permissive policies only (OR'd with existing ones), so no
--     customer loses or gains access.
--   * READ on vineyards and every RLS-enabled public table with vineyard_id.
--   * WRITE (insert/update) on paddocks only. No delete.
--   * Idempotent and safe to re-run.
--
-- Revision 2 (deadlock fix): the first version created every policy in ONE
-- transaction, so it held exclusive locks on many tables at once while the
-- live apps were reading them -> deadlock. Nothing was applied (it rolled
-- back). This version commits after EACH table, uses a short lock_timeout,
-- and retries a busy table a few times instead of deadlocking.
--
-- IMPORTANT: run this file as-is, NOT wrapped in BEGIN/COMMIT (the DO block
-- commits per table, which is only allowed outside an explicit transaction).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t record;
  attempt int;
  done boolean;
  skipped text[] := '{}';
BEGIN
  FOR t IN
    SELECT tbl, policy, ddl FROM (
      -- vineyards read
      SELECT 'vineyards'::text AS tbl,
             'system_admin_support_select'::text AS policy,
             'CREATE POLICY system_admin_support_select ON public.vineyards
                FOR SELECT TO authenticated USING (public.is_system_admin())'::text AS ddl
      UNION ALL
      -- read on every RLS-enabled table with vineyard_id
      SELECT c.relname::text,
             'system_admin_support_select',
             format('CREATE POLICY system_admin_support_select ON public.%I
                       FOR SELECT TO authenticated USING (public.is_system_admin())', c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
         AND a.attname = 'vineyard_id' AND NOT a.attisdropped
      UNION ALL
      SELECT 'paddocks', 'system_admin_support_update',
             'CREATE POLICY system_admin_support_update ON public.paddocks
                FOR UPDATE TO authenticated
                USING (public.is_system_admin()) WITH CHECK (public.is_system_admin())'
      UNION ALL
      SELECT 'paddocks', 'system_admin_support_insert',
             'CREATE POLICY system_admin_support_insert ON public.paddocks
                FOR INSERT TO authenticated WITH CHECK (public.is_system_admin())'
    ) q
  LOOP
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t.tbl AND policyname = t.policy) THEN
      CONTINUE;
    END IF;

    done := false;
    attempt := 0;
    WHILE NOT done AND attempt < 5 LOOP
      attempt := attempt + 1;
      BEGIN
        PERFORM set_config('lock_timeout', '3s', true);
        EXECUTE t.ddl;
        done := true;
      EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
        PERFORM pg_sleep(1);
      END;
    END LOOP;

    IF NOT done THEN
      skipped := skipped || (t.tbl || '.' || t.policy);
    END IF;
    COMMIT;  -- release this table's lock before moving on
  END LOOP;

  IF array_length(skipped, 1) IS NOT NULL THEN
    RAISE NOTICE 'Busy tables skipped — re-run this file to finish: %', skipped;
  ELSE
    RAISE NOTICE 'System Admin support policies in place.';
  END IF;
END $$;

-- Verify (read-only):
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND policyname LIKE 'system_admin_support_%'
--  ORDER BY tablename, cmd;
