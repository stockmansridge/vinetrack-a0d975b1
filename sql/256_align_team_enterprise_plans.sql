-- 256: Align Team and Enterprise plan records with vinetrack.com.au/pricing.
-- Apply to the VineTrack Supabase project (VINETRACK_SUPABASE_URL). Rork owns
-- this schema — review column names before running. Data-only; creates no
-- invoices, subscriptions or Stripe charges.
--
-- Team:       $799 AUD / yearly, 5 licences, Mobile app + Web Portal, Email support
-- Enterprise: $1,499 AUD / yearly, 10 licences, Mobile app + Web Portal,
--             Phone support, Free setup support, manually billed
--
-- NOTE: mobile/portal access flag columns on vinetrack_plans are not known to
-- the Portal codebase; Rork to confirm they are enabled for both plans.

BEGIN;

UPDATE public.vinetrack_plans
   SET billing_cycle = 'yearly',
       base_price_cents = 79900,
       included_user_licences = 5
 WHERE code = 'team';

UPDATE public.vinetrack_plans
   SET billing_cycle = 'yearly',
       base_price_cents = 149900,
       included_user_licences = 10
 WHERE code = 'enterprise';

-- Manual Team grants created with the old 3-seat snapshot -> 5.
UPDATE public.vinetrack_subscriptions s
   SET seats_included = 5
  FROM public.vinetrack_plans p
 WHERE s.plan_id = p.id
   AND p.code = 'team'
   AND s.billing_provider = 'manual'
   AND s.deleted_at IS NULL
   AND s.seats_included = 3;

COMMIT;

-- Verify:
-- SELECT code, billing_cycle, base_price_cents, included_user_licences
--   FROM public.vinetrack_plans WHERE code IN ('team','enterprise');
-- SELECT id, billing_provider, seats_included, seats_purchased
--   FROM public.vinetrack_subscriptions s JOIN public.vinetrack_plans p ON p.id = s.plan_id
--  WHERE p.code = 'team' AND s.deleted_at IS NULL;
