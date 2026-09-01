-- SQL 220 — Fix RLS on grape_allocation_blocks.
--
-- Symptom: Portal save fails with
--   new row violates row-level security policy for table "grape_allocation_blocks"
-- The parent grape_allocations insert succeeds, so the blocks policy is the
-- problem: the Portal insert only provides allocation_id / paddock_id /
-- quantity_tonnes, so any policy predicate that reads a vineyard_id (or other
-- column) on the blocks row itself evaluates NULL and rejects the row.
--
-- Fix: scope the policy through the parent allocation's vineyard membership,
-- with matching USING and WITH CHECK so INSERT/UPDATE/DELETE all pass for
-- vineyard members.

-- ============================================================
-- 1) Diagnostic (optional): see what policies exist today.
-- ============================================================
-- SELECT polname, polcmd,
--        pg_get_expr(polqual, polrelid)     AS using_expr,
--        pg_get_expr(polwithcheck, polrelid) AS check_expr
--   FROM pg_policy p
--   JOIN pg_class c ON c.oid = p.polrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relname = 'grape_allocation_blocks';

-- ============================================================
-- 2) Replace block policies with parent-allocation-scoped ones.
--    Adjust the vineyard_members join if your membership table
--    uses different column names.
-- ============================================================

ALTER TABLE public.grape_allocation_blocks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grape_allocation_blocks TO authenticated;
GRANT ALL ON public.grape_allocation_blocks TO service_role;

-- Drop whatever partial policies SQL 217/218 created (names may vary).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT p.polname
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'grape_allocation_blocks'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.grape_allocation_blocks', pol.polname);
  END LOOP;
END $$;

-- Single FOR ALL policy: a member of the allocation's vineyard can read and
-- write its block rows. USING and WITH CHECK are identical so inserts are
-- validated the same way as selects.
CREATE POLICY "Vineyard members can manage allocation blocks"
  ON public.grape_allocation_blocks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.grape_allocations a
        JOIN public.vineyard_members m
          ON m.vineyard_id = a.vineyard_id
       WHERE a.id = grape_allocation_blocks.allocation_id
         AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.grape_allocations a
        JOIN public.vineyard_members m
          ON m.vineyard_id = a.vineyard_id
       WHERE a.id = grape_allocation_blocks.allocation_id
         AND m.user_id = auth.uid()
    )
  );

-- ============================================================
-- 3) If grape_allocations itself relies on a different membership
--    pattern (e.g. a has_role / is_vineyard_member helper function),
--    reuse that same expression in place of the vineyard_members
--    join above so the two tables stay consistent.
-- ============================================================
