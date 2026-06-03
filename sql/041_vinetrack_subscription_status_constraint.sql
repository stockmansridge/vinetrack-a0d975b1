-- Patch: relax vinetrack_subscriptions.status constraint to accept all
-- Stripe subscription lifecycle states. Apply this to the VineTrack
-- Supabase project (the backend referenced by VINETRACK_SUPABASE_URL).
--
-- Stripe sends `customer.subscription.created` with status = 'incomplete'
-- before payment confirmation moves it to 'active'. The previous CHECK
-- constraint rejected that initial write and caused the webhook to 500.
--
-- Allowed statuses (Stripe + internal):
--   trialing, active, past_due, canceled, expired, paused, manual,
--   incomplete, incomplete_expired, unpaid
--
-- IMPORTANT: Access is granted ONLY for active, trialing, and (optionally)
-- past_due. incomplete / incomplete_expired / unpaid / canceled / expired
-- / paused must NEVER grant access. This is enforced in application code
-- (see src/pages/BillingPage.tsx, supabase/functions/*), not in the DB.

ALTER TABLE public.vinetrack_subscriptions
  DROP CONSTRAINT IF EXISTS vinetrack_subscriptions_status_check;

ALTER TABLE public.vinetrack_subscriptions
  ADD CONSTRAINT vinetrack_subscriptions_status_check
  CHECK (status IN (
    'trialing',
    'active',
    'past_due',
    'canceled',
    'expired',
    'paused',
    'manual',
    'incomplete',
    'incomplete_expired',
    'unpaid'
  ));
