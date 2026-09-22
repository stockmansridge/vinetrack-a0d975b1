CREATE TABLE public.newsletter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Untitled newsletter',
  subject text NOT NULL DEFAULT '',
  preheader text,
  from_name text,
  reply_to text,
  audience_current_users boolean NOT NULL DEFAULT false,
  audience_subscribers boolean NOT NULL DEFAULT false,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  audience_counts jsonb,
  current_version_id uuid,
  created_by uuid,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_campaigns_status_check CHECK (
    status IN ('draft','scheduled','preparing','sending','sent','partially_failed','failed')
  )
);

CREATE TABLE public.newsletter_campaign_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  subject text NOT NULL,
  preheader text,
  from_name text,
  reply_to text,
  blocks jsonb NOT NULL,
  html text NOT NULL,
  text_body text,
  audience_current_users boolean NOT NULL DEFAULT false,
  audience_subscribers boolean NOT NULL DEFAULT false,
  audience_counts jsonb,
  recipient_count integer NOT NULL DEFAULT 0,
  suppressed_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'preparing',
  error_message text,
  sender_user_id uuid,
  sender_email text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_campaign_versions_status_check CHECK (
    status IN ('preparing','scheduled','sending','sent','partially_failed','failed','cancelled')
  )
);

CREATE TABLE public.newsletter_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.newsletter_campaign_versions(id) ON DELETE CASCADE,
  email_hash text NOT NULL,
  email text NOT NULL,
  source text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_campaign_recipients_source_check CHECK (
    source IN ('current_user','newsletter_subscriber','both','test')
  ),
  CONSTRAINT newsletter_campaign_recipients_status_check CHECK (
    status IN ('pending','sent','suppressed','failed')
  )
);

CREATE UNIQUE INDEX newsletter_campaign_recipients_version_email_key
  ON public.newsletter_campaign_recipients (version_id, email_hash);
CREATE INDEX newsletter_campaign_recipients_pending_idx
  ON public.newsletter_campaign_recipients (version_id, status);
CREATE INDEX newsletter_campaign_versions_campaign_idx
  ON public.newsletter_campaign_versions (campaign_id, created_at DESC);
CREATE INDEX newsletter_campaigns_status_idx
  ON public.newsletter_campaigns (status, created_at DESC);

GRANT ALL ON public.newsletter_campaigns TO service_role;
GRANT ALL ON public.newsletter_campaign_versions TO service_role;
GRANT ALL ON public.newsletter_campaign_recipients TO service_role;

ALTER TABLE public.newsletter_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_campaign_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_newsletter_campaigns_updated_at
  BEFORE UPDATE ON public.newsletter_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_newsletter_campaign_versions_updated_at
  BEFORE UPDATE ON public.newsletter_campaign_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_newsletter_campaign_recipients_updated_at
  BEFORE UPDATE ON public.newsletter_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();