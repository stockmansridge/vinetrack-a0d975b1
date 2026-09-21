-- ============================================================================
-- SQL 243 — Canonical VineTrack first-party website analytics
-- ============================================================================
-- public.website_page_views stores anonymous traffic events from the public
-- VineTrack marketing website (vinetrack.com.au). It is first-party analytics:
-- no third-party tracker, no advertising pixel, no visitor profile.
--
-- Privacy by design — the table deliberately CANNOT hold personal data:
--   * no name, no email, no raw IP address, no user agent / fingerprint
--   * page_path is normalised by the Edge Function (query string and hash
--     fragment stripped) before insert
--   * referrer_domain stores the HOST ONLY, never a full referrer URL
--   * session_id is an anonymous, short-lived id generated in the browser and
--     is never linked to a VineTrack account
--
-- Canonical sources stay authoritative and are NOT duplicated here:
--   * demo requests      -> public.support_requests (category = 'website_demo')
--   * email subscribers  -> public.email_list_subscribers (see sql/242)
--
-- Access model (deliberately closed, same pattern as sql/242):
--   * anon / authenticated get NO privileges — neither the website nor the
--     Portal ever touches this table directly.
--   * Inserts come from the public `website-analytics` Edge Function and reads
--     from `admin-website-analytics` (which verifies public.is_system_admin()
--     first), both using the VineTrack service role.
--   * RLS is enabled with no permissive policy.
--
-- Purely additive: no existing table, policy, grant or function is changed, so
-- iOS / Android are unaffected.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.website_page_views (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  page_path       text        NOT NULL,
  session_id      uuid        NOT NULL,
  referrer_domain text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  environment     text        NOT NULL DEFAULT 'production',
  CONSTRAINT website_page_views_environment_check
    CHECK (environment IN ('production', 'preview')),
  CONSTRAINT website_page_views_page_path_check
    CHECK (page_path <> '' AND page_path LIKE '/%' AND length(page_path) <= 300)
);

CREATE INDEX IF NOT EXISTS website_page_views_created_at_idx
  ON public.website_page_views (created_at DESC);

CREATE INDEX IF NOT EXISTS website_page_views_path_created_at_idx
  ON public.website_page_views (page_path, created_at DESC);

CREATE INDEX IF NOT EXISTS website_page_views_session_created_at_idx
  ON public.website_page_views (session_id, created_at DESC);

-- Service role only. Intentionally NO grants to anon or authenticated.
GRANT ALL ON public.website_page_views TO service_role;

ALTER TABLE public.website_page_views ENABLE ROW LEVEL SECURITY;
-- No policies: every client role is denied. Service-role access bypasses RLS.

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT relrowsecurity FROM pg_class
--  WHERE oid = 'public.website_page_views'::regclass;                -- true
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'website_page_views';                          -- service_role only
-- ============================================================================
