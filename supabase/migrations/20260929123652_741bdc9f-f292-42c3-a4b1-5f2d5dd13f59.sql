ALTER TABLE public.newsletter_campaigns ADD COLUMN IF NOT EXISTS logo_link text;
ALTER TABLE public.newsletter_campaign_versions ADD COLUMN IF NOT EXISTS logo_link text;