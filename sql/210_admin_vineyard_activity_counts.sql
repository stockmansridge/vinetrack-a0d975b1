-- ============================================================================
-- SQL 210 — System Admin aggregate: per-vineyard activity counts
-- ============================================================================
-- Problem: the System Admin → Vineyards list derived per-vineyard activity
-- totals client-side from admin_list_pins / admin_list_spray_records /
-- admin_list_work_tasks and a trips read, all of which are globally truncated
-- newest-first lists (limit 500). The displayed counts were therefore wrong for
-- any vineyard whose records fall outside that global window.
--
-- Fix: one server-side aggregate, one row per vineyard, computed from the full
-- tables with the same active-record semantics as the existing admin_list_*
-- functions (deleted_at IS NULL). No limits.
--
-- Purely additive: no existing function signature, table, policy or grant is
-- changed, so iOS / Android are unaffected.
--
-- Authorisation: SECURITY DEFINER + explicit public.is_system_admin() check,
-- exactly like the other admin_* RPCs. EXECUTE granted to `authenticated`
-- only; a non-admin caller raises insufficient_privilege.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_vineyard_activity_counts()
RETURNS TABLE (
  vineyard_id        uuid,
  trip_count         bigint,
  pin_count          bigint,
  spray_record_count bigint,
  work_task_count    bigint
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
  WITH v AS (
    SELECT id FROM public.vineyards
  ),
  t AS (
    SELECT p.vineyard_id AS vid, count(*) AS n
      FROM public.trips p
     WHERE p.deleted_at IS NULL
     GROUP BY p.vineyard_id
  ),
  pn AS (
    SELECT p.vineyard_id AS vid, count(*) AS n
      FROM public.pins p
     WHERE p.deleted_at IS NULL
     GROUP BY p.vineyard_id
  ),
  sr AS (
    SELECT p.vineyard_id AS vid, count(*) AS n
      FROM public.spray_records p
     WHERE p.deleted_at IS NULL
     GROUP BY p.vineyard_id
  ),
  wt AS (
    SELECT p.vineyard_id AS vid, count(*) AS n
      FROM public.work_tasks p
     WHERE p.deleted_at IS NULL
     GROUP BY p.vineyard_id
  )
  SELECT v.id,
         COALESCE(t.n, 0),
         COALESCE(pn.n, 0),
         COALESCE(sr.n, 0),
         COALESCE(wt.n, 0)
    FROM v
    LEFT JOIN t  ON t.vid  = v.id
    LEFT JOIN pn ON pn.vid = v.id
    LEFT JOIN sr ON sr.vid = v.id
    LEFT JOIN wt ON wt.vid = v.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_vineyard_activity_counts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_vineyard_activity_counts() TO authenticated;

COMMIT;

-- Verification
-- 1. As a system admin:
--      select * from public.admin_vineyard_activity_counts() order by trip_count desc;
--    Cross-check one vineyard:
--      select count(*) from public.trips where vineyard_id = '<id>' and deleted_at is null;
-- 2. As a non-admin authenticated user the call must fail with 42501.
