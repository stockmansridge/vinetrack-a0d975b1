ALTER TABLE public.newsletter_campaigns
  ADD COLUMN logo_url text,
  ADD COLUMN logo_path text,
  ADD COLUMN logo_alt text;

ALTER TABLE public.newsletter_campaign_versions
  ADD COLUMN logo_url text,
  ADD COLUMN logo_path text,
  ADD COLUMN logo_alt text;