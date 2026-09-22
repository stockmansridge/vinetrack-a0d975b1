-- lovable-cron-fallback-reviewed: scheduled newsletter sends have no triggering row change; a time-based check is the only way to deliver at the chosen time, and it also recovers interrupted sends. 5-minute cadence (288 runs/day) reported to the user.
ALTER TABLE public.newsletter_campaign_recipients
  ADD COLUMN IF NOT EXISTS claim_id uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE public.newsletter_campaign_recipients
  DROP CONSTRAINT IF EXISTS newsletter_campaign_recipients_status_check;

ALTER TABLE public.newsletter_campaign_recipients
  ADD CONSTRAINT newsletter_campaign_recipients_status_check CHECK (
    status IN ('pending','sending','sent','suppressed','failed')
  );

CREATE INDEX IF NOT EXISTS newsletter_campaign_recipients_claimed_idx
  ON public.newsletter_campaign_recipients (version_id, status, claimed_at);

DO $$
BEGIN
  PERFORM cron.unschedule('newsletter-run-due');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'newsletter-run-due',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qpgkkertfwdycjhcbnpf.supabase.co/functions/v1/admin-newsletter-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := jsonb_build_object('action', 'run_due')
  );
  $$
);