DO $$
BEGIN
  PERFORM cron.unschedule('sync-support-request-emails');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-support-request-emails',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://qpgkkertfwdycjhcbnpf.supabase.co/functions/v1/sync-support-request-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := jsonb_build_object('batch_size', 10)
  );
  $$
);