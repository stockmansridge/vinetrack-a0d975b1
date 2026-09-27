-- ============================================================================
-- SQL 255 — Website call-to-action clicks (App Store, Google Play, Portal)
-- ============================================================================
-- Anonymous click counts for the main website call-to-action links. Same
-- privacy and access model as sql/243 (website_page_views): no personal data,
-- service role only, RLS on with no policies. Purely additive.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.website_cta_clicks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  target      text        NOT NULL,
  page_path   text        NOT NULL,
  session_id  uuid        NOT NULL,
  environment text        NOT NULL DEFAULT 'production',
  CONSTRAINT website_cta_clicks_target_check
    CHECK (target IN ('app_store', 'google_play', 'portal')),
  CONSTRAINT website_cta_clicks_environment_check
    CHECK (environment IN ('production', 'preview')),
  CONSTRAINT website_cta_clicks_page_path_check
    CHECK (page_path <> '' AND page_path LIKE '/%' AND length(page_path) <= 300)
);

CREATE INDEX IF NOT EXISTS website_cta_clicks_created_at_idx
  ON public.website_cta_clicks (created_at DESC);

GRANT ALL ON public.website_cta_clicks TO service_role;

ALTER TABLE public.website_cta_clicks ENABLE ROW LEVEL SECURITY;

COMMIT;
