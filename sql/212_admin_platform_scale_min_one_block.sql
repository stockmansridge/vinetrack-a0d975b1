-- ============================================================================
-- SQL 212 — System Admin aggregate: platform scale based on vineyards with blocks
-- ============================================================================
-- Redefines public.admin_platform_scale() so vineyard-level metrics only
-- include vineyards that have created at least one active block
-- (paddocks.deleted_at IS NULL):
--
--   * total_vineyards              -> vineyards with >= 1 active block
--   * average_hectares_per_vineyard-> total hectares / vineyards with blocks
--
-- Block-level metrics are unchanged (they already derive from blocks):
--   * total_active_paddocks, total_paddocks_with_area,
--     total_hectares_under_management
--
-- Rationale: empty shell vineyards (signed up, never mapped a block) were
-- dragging the average-hectares figure down and inflating the vineyard count
-- on the System Admin dashboard.
--
-- Same return shape and security semantics as the previous definition:
-- SECURITY DEFINER, gated by public.is_system_admin(), EXECUTE for
-- authenticated only. Area uses the shared helper
-- public._paddock_polygon_area_hectares(polygon_points) (hectares per block).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_platform_scale()
RETURNS TABLE (
  total_hectares_under_management numeric,
  total_vineyards                 bigint,
  total_active_paddocks           bigint,
  total_paddocks_with_area        bigint,
  average_hectares_per_vineyard   numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_ha           numeric;
  v_vineyards          bigint;
  v_active_paddocks    bigint;
  v_paddocks_with_area bigint;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;

  WITH active_paddocks AS (
    SELECT p.id, p.vineyard_id,
           COALESCE(public._paddock_polygon_area_hectares(p.polygon_points), 0) AS area_ha
      FROM public.paddocks p
     WHERE p.deleted_at IS NULL
  ),
  -- Vineyards in scope: not deleted, with at least one active block.
  scoped_vineyards AS (
    SELECT DISTINCT v.id
      FROM public.vineyards v
      JOIN active_paddocks ap ON ap.vineyard_id = v.id
     WHERE v.deleted_at IS NULL
  )
  SELECT COALESCE(SUM(ap.area_ha), 0),
         (SELECT count(*) FROM scoped_vineyards),
         count(*),
         count(*) FILTER (WHERE ap.area_ha > 0)
    INTO v_total_ha, v_vineyards, v_active_paddocks, v_paddocks_with_area
    FROM active_paddocks ap;

  total_hectares_under_management := v_total_ha;
  total_vineyards                 := v_vineyards;
  total_active_paddocks           := v_active_paddocks;
  total_paddocks_with_area        := v_paddocks_with_area;
  average_hectares_per_vineyard   :=
    CASE WHEN v_vineyards > 0 THEN v_total_ha / v_vineyards ELSE 0 END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_scale() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_scale() TO authenticated;

COMMIT;

-- Verification
-- 1. As a system admin:
--      select * from public.admin_platform_scale();
--    total_vineyards must equal:
--      select count(distinct p.vineyard_id)
--        from public.paddocks p
--        join public.vineyards v on v.id = p.vineyard_id
--       where p.deleted_at is null and v.deleted_at is null;
--    average_hectares_per_vineyard must equal
--    total_hectares_under_management / total_vineyards.
-- 2. Vineyards with zero blocks must not move total_vineyards or the average.
-- 3. As a non-admin authenticated user the call must fail with 42501.
