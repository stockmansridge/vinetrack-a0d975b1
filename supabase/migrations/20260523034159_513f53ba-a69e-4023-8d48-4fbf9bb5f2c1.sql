-- Restrict storage.objects in the private 'support-request-attachments' bucket
-- to service-role access only. Attachments are only ever written by the
-- submit-support-request edge function and read via short-lived signed URLs
-- generated server-side, so no direct client access is required.

CREATE POLICY "Support attachments: service role select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'support-request-attachments'
    AND auth.role() = 'service_role'
  );

CREATE POLICY "Support attachments: service role insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'support-request-attachments'
    AND auth.role() = 'service_role'
  );

CREATE POLICY "Support attachments: service role update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'support-request-attachments'
    AND auth.role() = 'service_role'
  )
  WITH CHECK (
    bucket_id = 'support-request-attachments'
    AND auth.role() = 'service_role'
  );

CREATE POLICY "Support attachments: service role delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'support-request-attachments'
    AND auth.role() = 'service_role'
  );
