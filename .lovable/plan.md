# Team-plan billing audit (inspection only, nothing changed)

## Findings

1. `supabase/functions/stripe-vinetrack-webhook/index.ts:122-151`: **wrong column, and it can force 3 seats.** `getTeamPlan()` asks `vinetrack_plans` for `seats_included`, then `included_seats`, then only `id`. It never asks for `included_user_licences`. When both of the first two columns are missing (error 42703), it falls back to the `id`-only query, and line 146 then hard-codes `?? 3`. So every new Team subscription row gets `seats_included = 3` (line 334), whatever the plan table says.
2. Same file, lines 222-235: seat count. Every line item that isn't `STRIPE_PRICE_TEAM_EXTRA_USER` counts as "base". Then `seats_purchased = extraQty + max(0, baseQty - 1)`. If `STRIPE_PRICE_TEAM_EXTRA_USER` is unset, extra-user items are counted as base and still work out the same, but only by chance.
3. Same file, around line 334: the seat snapshot is only written when the row is first inserted. Updates never refresh `seats_included`, so rows that already exist keep whatever value they were inserted with (possibly the fallback 3).
4. Same file, lines 541-559: tax is only copied from Stripe's invoice into `tax_cents` (`invoice.tax` or the sum of `total_tax_amounts`). The Portal doesn't calculate any tax itself.
5. `supabase/functions/create-vinetrack-team-checkout/index.ts:25,43,161`: uses `STRIPE_PRICE_TEAM`. Quantity is `max(1, body.quantity ?? 1)`, and the Portal never sends a quantity (`src/pages/BillingPage.tsx:326-329`), so it is always 1. There is no `automatic_tax` or `tax_rates` setting, so GST depends entirely on the Stripe price/account settings. The price amount is never set in code.
6. `supabase/functions/update-vinetrack-team-seats/index.ts:40,45,114,130`: uses `STRIPE_PRICE_TEAM_EXTRA_USER`. Quantity is the target number of extra seats. It has no hard-coded seat or price numbers.
7. `src/pages/BillingPage.tsx:917, 1089, 1171`: **hard-coded "$99/year ex GST"** for extra users in three on-screen messages. This is text only and not read from Stripe or the plan table.
8. `src/pages/BillingPage.tsx:304`: included seats show from the subscription's `seats_included`, then the access record's `seats_included`, else 0. This number is shown at lines 812, 871 and 1088 and used in the total at 1117. It has no 3 fallback of its own, but it shows the webhook's snapshot (see finding 1).
9. `supabase/functions/create-vinetrack-user-licence/index.ts:53,65`: the seat limit is `seats_included + seats_purchased` (missing values count as 0), so a webhook-forced 3 becomes the real limit.
10. `supabase/functions/get-vinetrack-team-licences/index.ts:49` and `supabase/functions/get-vinetrack-billing-detail/index.ts:66`: these only read `seats_included` and `seats_purchased` back. They have no fallbacks.
11. `src/components/admin/access/UserAccessDrawer.tsx:111`: the admin seat summary uses `max(seats_included, seats_purchased)` instead of adding them together, so it under-reports total seats. This is display only.
12. `src/lib/vinetrackAccessQuery.ts:28` and `src/lib/accessEntitlementsQuery.ts:706,844`: these only pass `seats_included` through from the shared access functions. They have no defaults.
13. `sql/041_vinetrack_subscription_status_constraint.sql`: changes status values only. No seat or price numbers.

## Not found
- No annual base price is written anywhere in code. The base price comes only from the `STRIPE_PRICE_TEAM` Stripe price.
- `included_user_licences` isn't mentioned anywhere in the Portal codebase (code, SQL or docs).
- No other "3 included users" wording or code beyond finding 1.

## Answers
- Does any code still assume 3 included Team users? Yes: the webhook fallback (finding 1).
- Does any code still assume $99 extra users? Yes: three text messages on the Billing page (finding 7).
- Does the webhook read `vinetrack_plans.included_user_licences`? No.
- Can a fallback force 3 seats? Yes, on every new Team subscription row whenever neither `seats_included` nor `included_seats` exists on `vinetrack_plans`.
