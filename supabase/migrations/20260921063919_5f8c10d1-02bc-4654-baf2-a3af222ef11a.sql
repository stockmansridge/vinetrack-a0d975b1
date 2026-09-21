CREATE TABLE public.email_list_subscribers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  first_name text,
  last_name text,
  status text NOT NULL DEFAULT 'subscribed',
  source text NOT NULL,
  source_page text,
  consent_text text,
  consent_version text,
  consent_captured_at timestamptz,
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_list_subscribers_status_check
    CHECK (status IN ('subscribed', 'unsubscribed')),
  CONSTRAINT email_list_subscribers_email_not_blank
    CHECK (length(btrim(email)) > 0)
);

CREATE UNIQUE INDEX email_list_subscribers_email_lower_key
  ON public.email_list_subscribers (lower(btrim(email)));

CREATE INDEX email_list_subscribers_created_at_idx
  ON public.email_list_subscribers (created_at DESC);

-- Service role only: the public website endpoints and the System Admin
-- Email List screen both run through Edge Functions that verify their caller.
-- No anon or authenticated Data API access is granted.
GRANT ALL ON public.email_list_subscribers TO service_role;

ALTER TABLE public.email_list_subscribers ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER email_list_subscribers_updated_at
  BEFORE UPDATE ON public.email_list_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();