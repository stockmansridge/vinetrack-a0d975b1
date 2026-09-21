-- ============================================================================
-- SQL 242 — Canonical VineTrack marketing email list
-- ============================================================================
-- public.email_list_subscribers is the global VineTrack marketing/newsletter
-- list collected by the public website (newsletter form + demo-request
-- marketing opt-in). It is NOT vineyard-scoped data.
--
-- It was initially created on the Portal's Lovable Cloud project; this file
-- moves it to the canonical VineTrack database so it lives alongside
-- public.support_requests and the rest of the shared VineTrack data.
--
-- Access model (deliberately closed):
--   * anon / authenticated get NO privileges — the public website and the
--     Portal never touch this table directly.
--   * All reads and writes go through Edge Functions using the VineTrack
--     service role (`newsletter-subscribe`, `website-enquiry`,
--     `admin-email-list`, which verifies public.is_system_admin() first).
--   * RLS is enabled with no permissive policy, so even if a Data API grant
--     were ever added by mistake, nothing is readable by a client role.
--
-- Purely additive: no existing table, policy, grant or function is changed,
-- so iOS / Android are unaffected.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_list_subscribers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text        NOT NULL,
  first_name          text,
  last_name           text,
  status              text        NOT NULL DEFAULT 'subscribed',
  source              text        NOT NULL,
  source_page         text,
  consent_text        text,
  consent_version     text,
  consent_captured_at timestamptz,
  subscribed_at       timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_list_subscribers_status_check
    CHECK (status IN ('subscribed', 'unsubscribed')),
  CONSTRAINT email_list_subscribers_email_not_blank
    CHECK (btrim(email) <> '')
);

-- One canonical row per email address, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS email_list_subscribers_email_lower_key
  ON public.email_list_subscribers (lower(btrim(email)));

CREATE INDEX IF NOT EXISTS email_list_subscribers_status_idx
  ON public.email_list_subscribers (status);

CREATE INDEX IF NOT EXISTS email_list_subscribers_subscribed_at_idx
  ON public.email_list_subscribers (subscribed_at DESC);

-- Service role only. Intentionally NO grants to anon or authenticated.
GRANT ALL ON public.email_list_subscribers TO service_role;

ALTER TABLE public.email_list_subscribers ENABLE ROW LEVEL SECURITY;
-- No policies: every client role is denied. Service-role access bypasses RLS.

-- Keep updated_at honest. Reuse the existing shared trigger function when the
-- database already has one; otherwise fall back to an inline definition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS email_list_subscribers_set_updated_at
             ON public.email_list_subscribers';
    EXECUTE 'CREATE TRIGGER email_list_subscribers_set_updated_at
             BEFORE UPDATE ON public.email_list_subscribers
             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  ELSIF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS email_list_subscribers_set_updated_at
             ON public.email_list_subscribers';
    EXECUTE 'CREATE TRIGGER email_list_subscribers_set_updated_at
             BEFORE UPDATE ON public.email_list_subscribers
             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT relrowsecurity FROM pg_class
--  WHERE oid = 'public.email_list_subscribers'::regclass;           -- true
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'email_list_subscribers';                     -- service_role only
-- ============================================================================
