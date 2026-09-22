-- ============================================================================
-- SQL 246 — Feature request comments (canonical VineTrack database)
-- ============================================================================
-- Lets signed-in VineTrack users discuss a feature request so the required
-- functionality is properly captured before it is built.
--
-- Access model:
--   * authenticated  — read comments on requests they can see, add their own,
--                      edit / delete their own comment.
--   * system admin   — read, edit and delete any comment.
--   * anon           — no access at all.
--
-- Purely additive: depends only on public.feature_requests (sql/245). No
-- existing table, policy, grant or function is changed, so iOS / Android are
-- unaffected.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.feature_request_comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_request_id uuid        NOT NULL
    REFERENCES public.feature_requests (id) ON DELETE CASCADE,
  body               text        NOT NULL,
  created_by         uuid        NOT NULL DEFAULT auth.uid(),
  created_by_name    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_request_comments_body_not_blank
    CHECK (btrim(body) <> ''),
  CONSTRAINT feature_request_comments_body_length
    CHECK (char_length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS feature_request_comments_request_idx
  ON public.feature_request_comments (feature_request_id, created_at);
CREATE INDEX IF NOT EXISTS feature_request_comments_created_by_idx
  ON public.feature_request_comments (created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_request_comments TO authenticated;
GRANT ALL ON public.feature_request_comments TO service_role;

ALTER TABLE public.feature_request_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_request_comments_select" ON public.feature_request_comments;
CREATE POLICY "feature_request_comments_select"
  ON public.feature_request_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.feature_requests fr
      WHERE fr.id = feature_request_id
        AND (fr.is_hidden = false OR fr.created_by = auth.uid() OR public.is_system_admin())
    )
  );

DROP POLICY IF EXISTS "feature_request_comments_insert_own" ON public.feature_request_comments;
CREATE POLICY "feature_request_comments_insert_own"
  ON public.feature_request_comments FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.feature_requests fr
      WHERE fr.id = feature_request_id
        AND (fr.is_hidden = false OR fr.created_by = auth.uid() OR public.is_system_admin())
    )
  );

DROP POLICY IF EXISTS "feature_request_comments_update_own" ON public.feature_request_comments;
CREATE POLICY "feature_request_comments_update_own"
  ON public.feature_request_comments FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_system_admin())
  WITH CHECK (created_by = auth.uid() OR public.is_system_admin());

DROP POLICY IF EXISTS "feature_request_comments_delete_own" ON public.feature_request_comments;
CREATE POLICY "feature_request_comments_delete_own"
  ON public.feature_request_comments FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_system_admin());

DROP TRIGGER IF EXISTS feature_request_comments_set_updated_at ON public.feature_request_comments;
CREATE TRIGGER feature_request_comments_set_updated_at
  BEFORE UPDATE ON public.feature_request_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.feature_request_comments IS
  'Discussion thread on a VineTrack feature request so required functionality is captured.';

COMMIT;
