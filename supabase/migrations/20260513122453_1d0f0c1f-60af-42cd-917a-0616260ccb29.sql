-- Remove user-bound policies (auth runs on a separate Supabase project, so auth.uid() is null here).
drop policy if exists "auth users create support requests" on public.support_requests;
drop policy if exists "users read own support requests" on public.support_requests;
drop policy if exists "auth upload support attachments" on storage.objects;
drop policy if exists "auth read own support attachments" on storage.objects;

-- Table keeps RLS enabled with no policies → only service role (edge function) can read/write.
-- Bucket stays private with no public policies → only service role can upload/list.