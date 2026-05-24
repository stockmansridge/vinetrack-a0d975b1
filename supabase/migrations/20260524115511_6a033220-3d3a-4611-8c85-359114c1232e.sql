-- Users can read only their own support requests
CREATE POLICY "Users can read their own support requests"
ON public.support_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own support requests from the client.
-- The submit-support-request edge function uses the service role and bypasses RLS,
-- so the existing server-side submission path is unaffected.
CREATE POLICY "Users can create their own support requests"
ON public.support_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);