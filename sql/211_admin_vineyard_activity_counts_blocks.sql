-- ============================================================================
-- SQL 211 — System Admin aggregate: add configured block count
-- ============================================================================
-- Adds `block_count` (active paddocks) to the per-vineyard activity aggregate
-- so the System Admin → Vineyards list can surface configuration depth alongside
-- activity counts. Still server-side, no limits, same active-record semantics
-- (deleted_at IS NULL).
--
-- Purely additive column: existing consumers selecting specific columns are
-- unaffected; `SELECT *` callers receive the extra column.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_vineyard_activity_counts()
RETURNS TABLE (
  vineyard_id        uuid,
  trip_count         bigint,
  pin_count          bigint,
  spray_record_count bigint,
  work_task_count    bigint,
  block_count        bigint
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
  ),
  blk AS (
    SELECT p.vineyard_id AS vid, count(*) AS n
      FROM public.paddocks p
     WHERE p.deleted_at IS NULL
     GROUP BY p.vineyard_id
  )
  SELECT v.id,
         COALESCE(t.n, 0),
         COALESCE(pn.n, 0),
         COALESCE(sr.n, 0),
         COALESCE(wt.n, 0),
         COALESCE(blk.n, 0)
    FROM v
    LEFT JOIN t   ON t.vid   = v.id
    LEFT JOIN pn  ON pn.vid  = v.id
    LEFT JOIN sr  ON sr.vid  = v.id
    LEFT JOIN wt  ON wt.vid  = v.id
    LEFT JOIN blk ON blk.vid = v.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_vineyard_activity_counts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_vineyard_activity_counts() TO authenticated;

COMMIT;

-- Verification
-- 1. As a system admin:
--      select vineyard_id, block_count from public.admin_vineyard_activity_counts() order by block_count desc;
--    Cross-check one vineyard:
--      select count(*) from public.paddocks where vineyard_id = '<id>' and deleted_at is null;
-- 2. As a non-admin authenticated user the call must fail with 42501.
