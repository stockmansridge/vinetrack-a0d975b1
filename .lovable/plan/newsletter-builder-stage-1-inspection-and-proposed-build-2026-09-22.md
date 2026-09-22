# Newsletter Builder — Stage 1 inspection and proposed build

## 1. What already exists (inspected, no changes made)

**Email delivery — there is no working Resend integration.**
Production email goes through Lovable's managed email service (`@lovable.dev/email-js`, `sendLovableEmail`) with React Email templates in `supabase/functions/_shared/transactional-email-templates/` and the `sendTemplateEmail` helper. Sender subdomain `notify.vinetrack.com.au`, From `vinetrack.com.au`.
The only Resend code in the project is `supabase/functions/send-test-invitation-email` — a legacy System Admin diagnostic that calls `api.resend.com/emails` directly with `RESEND_API_KEY`. It has no audiences, no contacts and no broadcasts.

**So Resend Broadcasts are not available to reuse.** Choosing Resend Broadcasts would mean standing up a second delivery system (new domain verification, a second suppression list, a second unsubscribe mechanism) — exactly what this brief forbids. The newsletter will therefore send through the existing Lovable email service, which already provides: suppression enforced at send time, unsubscribe handling (`purpose: "marketing"` adds the List-Unsubscribe/footer mechanism), per-message idempotency keys, delivery/open/click logs (`listEmailLogs`) and bounce/complaint/unsubscribe webhooks (`handle-email-events` → `suppressed_emails` + `email_send_log`).

**Current Users (A):** `admin_list_users()` RPC on the canonical VineTrack database (`useAdminUsers` in `src/lib/adminApi.ts`) → email, full_name, last_sign_in_at, created_at. "Active" is already defined in the Portal as a `last_sign_in_at` window (7/30 days) on the Users page; that definition is reused unchanged, with "all users" as the default audience option.

**Newsletter Subscribers (B):** `public.email_list_subscribers` on the canonical VineTrack database (`sql/242`, awaiting Rork; legacy copy on the Portal project used as fallback), read only through the `admin-email-list` Edge Function with the service role. `status` is `subscribed` / `unsubscribed`.

**Unsubscribe / suppression:** Lovable enforces suppression at send time; the project mirrors it in `public.suppressed_emails` and `public.email_send_log`. There is no token-based unsubscribe endpoint any more (deliberately). Nothing new will be built here.

**Images:** public `guide-images` bucket on the canonical VineTrack database, uploaded from the admin browser and served via `getPublicUrl` — durable, already used for guide and canopy imagery. Newsletters reuse it under a `newsletter/` prefix.

**Admin permissions:** `is_system_admin()` RPC (canonical DB) + `useIsSystemAdmin` / `AdminGate` in the UI, and server-side re-verification inside Edge Functions via `x-vinetrack-token` → `auth.getUser` → `is_system_admin`. Same pattern used here.

## 2. Audience resolution (server-side only)

```text
A = admin_list_users()            → normalised email, source current_user
B = email_list_subscribers        → status = subscribed, source newsletter_subscriber
normalise: trim → lowercase → drop blank/invalid
A ∩ B  = same normalised email in both → source "both", counted once
union  = A ∪ B by normalised email
final  = union − suppressed_emails − unsubscribed subscribers − invalid
```

Counts returned: current_users, subscribers, in_both, unique_potential, suppressed, invalid, final. All computed in the Edge Function; the browser never receives the address list, only counts (and a masked sample if useful).

## 3. Database changes

Campaign content is a Portal-only concern (like portal notices), so the new tables go on the Portal's own backend — no Rork dependency, no new shared contract. Audience and suppression are still read from the canonical database.

- `newsletter_campaigns` — name, subject, preheader, from_name, reply_to, audience flags, `blocks` jsonb, status (draft/scheduled/sending/sent/partially_failed/failed), scheduled_at, timezone, counts, created_by, timestamps.
- `newsletter_campaign_versions` — frozen snapshot at send time: rendered HTML/text, subject, blocks, audience sources, resolved/suppressed counts, sender admin, send timestamp, provider message ids, status, error. Sent campaigns are read-only in the editor; editing = Duplicate → new draft.
- `newsletter_campaign_recipients` — one row per resolved recipient per version (normalised email hash + source + per-recipient idempotency key + delivery status). This is what makes sending idempotent and resumable.

RLS enabled, no anon/authenticated grants, service_role only — every read and write goes through the admin Edge Function after `is_system_admin` verification.

## 4. Edge Functions

- `admin-newsletters` — System Admin only: list/get/save/duplicate/delete drafts, resolve audience counts, render preview HTML, send test.
- `admin-newsletter-send` — System Admin only: freeze a version, resolve recipients, then send in batches through `sendLovableEmail` with `purpose: "marketing"` and a stable per-recipient idempotency key; re-entrant, so a retry or double click resumes the same version instead of creating a second campaign. Handles scheduled sends via a due-campaign pass.
- `handle-email-events` is already wired for bounces/complaints/unsubscribes — untouched.

## 5. Portal files

- `src/lib/newsletter/blocks.ts` — block model (hero, image+text, text, three-card, button, divider, footer) and the "Product Update" + Blank templates.
- `src/lib/newsletter/renderEmail.ts` — the single email-safe HTML renderer (table-based, 640px, inline styles, VineTrack green palette) used by preview, test send and real send.
- `src/lib/newsletterAdmin.ts` — admin queries/mutations, audience counts, status.
- `src/pages/admin/AdminNewslettersPage.tsx` (list) and `AdminNewsletterEditorPage.tsx` (editor: details, audience picker with live summary, block editor with add/duplicate/move/delete, image upload, desktop/mobile preview, Save Draft / Send Test / Schedule / Send Now with confirmation modal).
- Routes `/admin/newsletters`, `/admin/newsletters/:id`; nav group **Communications → Newsletters** alongside Email List, System Admin only.

## 6. Analytics

Delivered / bounced / opened / clicked / unsubscribed come from the existing Lovable email logs (`listEmailLogs`, filtered by the campaign label) plus `email_send_log`. Whatever the API doesn't return is shown as "not available" — no invented numbers.

## 7. Tests

Pure-function tests for: each audience selection, dedupe across both lists, case and whitespace dedupe, suppressed user in Current Users, unsubscribed subscriber, suppressed user in both, missing/invalid email, zero-recipient send blocked, test send leaves audience and subscriber status untouched, repeated send resolves to the same version (no duplicate campaign), sent version immutable, renderer output is email-safe and mobile-usable, image URLs are durable public URLs.

## 8. Notes

- No production newsletter will be sent during development; test sends only, to addresses you enter.
- Transactional email stays completely separate from newsletter/marketing preferences.
- The legacy `send-test-invitation-email` Resend diagnostic is left alone.
