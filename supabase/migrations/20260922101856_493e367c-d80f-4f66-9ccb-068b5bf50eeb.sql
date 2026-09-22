REVOKE ALL ON public.newsletter_campaigns FROM anon, authenticated;
REVOKE ALL ON public.newsletter_campaign_versions FROM anon, authenticated;
REVOKE ALL ON public.newsletter_campaign_recipients FROM anon, authenticated;
GRANT ALL ON public.newsletter_campaigns TO service_role;
GRANT ALL ON public.newsletter_campaign_versions TO service_role;
GRANT ALL ON public.newsletter_campaign_recipients TO service_role;