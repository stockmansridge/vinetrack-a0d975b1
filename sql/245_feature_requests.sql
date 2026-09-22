-- ============================================================================
-- SQL 245 — Feature requests + voting (canonical VineTrack database)
-- ============================================================================
-- A shared, cross-customer suggestion board. Any signed-in VineTrack user can
-- post a feature request and give each request a single upvote; System Admin
-- curates status and can hide spam/duplicates.
--
-- Not vineyard-scoped data: requests are visible to every signed-in user so
-- voting reflects demand across the whole customer base. `vineyard_id` is kept
-- only as optional context about where the request came from.
--
-- Access model:
--   * authenticated  — read visible requests, create requests, edit their own
--                      request while it is still 'open', vote / unvote once.
--   * system admin   — read everything, set status, hide, delete.
--   * anon           — no access at all.
--
-- Purely additive: no existing table, policy, grant or function is changed,
-- so iOS / Android are unaffected.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.feature_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text        NOT NULL,
  details         text,
  status          text        NOT NULL DEFAULT 'open',
  is_hidden       boolean     NOT NULL DEFAULT false,
  created_by      uuid        NOT NULL DEFAULT auth.uid(),
  created_by_name text,
  vineyard_id     uuid,
  admin_note      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_requests_status_check
    CHECK (status IN ('open', 'planned', 'in_progress', 'done', 'declined')),
  CONSTRAINT feature_requests_title_not_blank
    CHECK (btrim(title) <> ''),
  CONSTRAINT feature_requests_title_length
    CHECK (char_length(title) <= 160),
  CONSTRAINT feature_requests_details_length
    CHECK (details IS NULL OR char_length(details) <= 4000)
);

CREATE INDEX IF NOT EXISTS feature_requests_created_at_idx
  ON public.feature_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS feature_requests_status_idx
  ON public.feature_requests (status);
CREATE INDEX IF NOT EXISTS feature_requests_created_by_idx
  ON public.feature_requests (created_by);

GRANT SELECT, INSERT, UPDATE ON public.feature_requests TO authenticated;
GRANT ALL ON public.feature_requests TO service_role;

ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_requests_select" ON public.feature_requests;
CREATE POLICY "feature_requests_select"
  ON public.feature_requests FOR SELECT TO authenticated
  USING (
    is_hidden = false
    OR created_by = auth.uid()
    OR public.is_system_admin()
  );

DROP POLICY IF EXISTS "feature_requests_insert_own" ON public.feature_requests;
CREATE POLICY "feature_requests_insert_own"
  ON public.feature_requests FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Authors may correct their own wording while the request is still open.
DROP POLICY IF EXISTS "feature_requests_update_own" ON public.feature_requests;
CREATE POLICY "feature_requests_update_own"
  ON public.feature_requests FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND status = 'open' AND is_hidden = false)
  WITH CHECK (created_by = auth.uid() AND status = 'open' AND is_hidden = false);

DROP POLICY IF EXISTS "feature_requests_admin_update" ON public.feature_requests;
CREATE POLICY "feature_requests_admin_update"
  ON public.feature_requests FOR UPDATE TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

DROP TRIGGER IF EXISTS feature_requests_set_updated_at ON public.feature_requests;
CREATE TRIGGER feature_requests_set_updated_at
  BEFORE UPDATE ON public.feature_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Votes: exactly one per user per request.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feature_request_votes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_request_id uuid        NOT NULL
    REFERENCES public.feature_requests (id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_request_votes_unique UNIQUE (feature_request_id, user_id)
);

CREATE INDEX IF NOT EXISTS feature_request_votes_request_idx
  ON public.feature_request_votes (feature_request_id);
CREATE INDEX IF NOT EXISTS feature_request_votes_user_idx
  ON public.feature_request_votes (user_id);

GRANT SELECT, INSERT, DELETE ON public.feature_request_votes TO authenticated;
GRANT ALL ON public.feature_request_votes TO service_role;

ALTER TABLE public.feature_request_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_request_votes_select" ON public.feature_request_votes;
CREATE POLICY "feature_request_votes_select"
  ON public.feature_request_votes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "feature_request_votes_insert_own" ON public.feature_request_votes;
CREATE POLICY "feature_request_votes_insert_own"
  ON public.feature_request_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "feature_request_votes_delete_own" ON public.feature_request_votes;
CREATE POLICY "feature_request_votes_delete_own"
  ON public.feature_request_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_system_admin());

COMMENT ON TABLE public.feature_requests IS
  'Cross-customer VineTrack feature suggestion board. Status curated by System Admin.';
COMMENT ON TABLE public.feature_request_votes IS
  'One upvote per signed-in user per feature request.';

COMMIT;
