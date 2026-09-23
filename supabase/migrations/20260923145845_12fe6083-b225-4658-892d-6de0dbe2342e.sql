-- Tighten public reads for portal_maintenance without changing admin writes.
REVOKE SELECT ON public.portal_maintenance FROM anon;
REVOKE SELECT ON public.portal_maintenance FROM authenticated;

GRANT SELECT (id, is_enabled, message, created_at, updated_at)
ON public.portal_maintenance TO anon;
GRANT SELECT (id, is_enabled, message, created_at, updated_at)
ON public.portal_maintenance TO authenticated;
GRANT ALL ON public.portal_maintenance TO service_role;

DROP POLICY IF EXISTS "Maintenance status is publicly readable"
ON public.portal_maintenance;

CREATE POLICY "Public can read maintenance status row"
ON public.portal_maintenance
FOR SELECT
TO anon, authenticated
USING (id = 1);

-- Tighten public reads for portal_notices without changing admin writes.
REVOKE SELECT ON public.portal_notices FROM anon;
REVOKE SELECT ON public.portal_notices FROM authenticated;

GRANT SELECT (id, title, message, tone, priority, is_active, starts_at, ends_at, created_at, updated_at)
ON public.portal_notices TO anon;
GRANT SELECT (id, title, message, tone, priority, is_active, starts_at, ends_at, created_at, updated_at)
ON public.portal_notices TO authenticated;
GRANT ALL ON public.portal_notices TO service_role;

DROP POLICY IF EXISTS "Portal notices are readable by everyone"
ON public.portal_notices;

CREATE POLICY "Public can read active portal notices"
ON public.portal_notices
FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at >= now())
);