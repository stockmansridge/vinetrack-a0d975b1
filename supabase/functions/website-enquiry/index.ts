// PUBLIC website demo / contact enquiry endpoint for the VineTrack marketing
// website. Anonymous — no JWT required, CORS restricted to the VineTrack
// website origins (plus Lovable preview/localhost during development).
//
// This function does NOT replace or weaken the authenticated support path
// (`submit-support-request` here, `support-request` on the VineTrack project).
//
// Flow:
//   1. Validate + normalise the submission. Honeypot spam is silently accepted
//      and discarded. Rapid duplicates from the same address are de-duplicated.
//   2. Insert the enquiry into the canonical public.support_requests table on
//      the VineTrack project (category = website_demo, app_platform = website,
//      email_status = pending) using the VineTrack service role. This record is
//      authoritative and is never rolled back because of an email failure.
//   3. Return success to the browser as soon as the durable record exists.
//      The staff notification, the visitor receipt, the email_status
//      bookkeeping and the marketing opt-in are finished in the background
//      (EdgeRuntime.waitUntil) so the public form is not held open for the
//      email round-trips. If the staff notification fails the record is left
//      at email_status = pending so the existing sync-support-request-emails
//      cron retries it — unchanged retry behaviour.
//   4. When marketing_opt_in is explicitly true, also add the submitter to the
//      canonical VineTrack public.email_list_subscribers (source =
//      website_demo_opt_in). Without explicit consent the submitter is never
//      added to the marketing list.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  cleanText,
  corsHeadersFor,
  honeypotTripped,
  isValidEmail,
  jsonFor,
  normaliseEmail,
} from "../_shared/website-public.ts";
import { upsertSubscriberCanonical } from "../_shared/email-list.ts";
import { checkRateLimit } from "../_shared/public-rate-limit.ts";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { logEmailSend } from "../_shared/email-send-log.ts";



const CATEGORY = "website_demo";
const PLATFORM = "website";
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const STAFF_TEMPLATE = "support_request";
const RECEIPT_TEMPLATE = "website_enquiry_receipt";
const STAFF_FALLBACK_RECIPIENT = "support@vinetrack.com.au";
const ADMIN_BASE = "https://portal.vinetrack.com.au/admin/support-requests";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(origin) });
  }
  if (req.method !== "POST") {
    return jsonFor(origin, 405, { ok: false, error: "Method not allowed" });
  }

  const CLOUD_URL = Deno.env.get("SUPABASE_URL");
  const CLOUD_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  if (!CLOUD_URL || !CLOUD_SERVICE || !VT_URL || !VT_SERVICE) {
    console.error("website-enquiry missing configuration");
    return jsonFor(origin, 503, { ok: false, error: "This form is temporarily unavailable." });
  }

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } });
  const vinetrack = createClient(VT_URL, VT_SERVICE, { auth: { persistSession: false } });

  // Server-side backstop: CORS and the honeypot do not constrain direct HTTP
  // callers. Conservative enough that a genuine visitor never sees it. Started
  // here and awaited before anything is written, so its round-trip overlaps
  // request parsing and validation.
  const limitPromise = checkRateLimit(cloud, req, {
    form: "website-enquiry",
    limit: 8,
    windowSeconds: 900,
  });


  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonFor(origin, 400, { ok: false, error: "Invalid request." });
  }


  // Silently accept and discard honeypot spam.
  if (honeypotTripped(body)) {
    return jsonFor(origin, 200, { ok: true, message: "Thanks — we'll be in touch." });
  }

  const firstName = cleanText(body.first_name, 80);
  const lastName = cleanText(body.last_name, 80);
  const email = normaliseEmail(body.email);
  const phone = cleanText(body.phone, 40);
  const message = cleanText(body.message, 5000);
  const sourcePage = cleanText(body.source_page, 300);
  const browserInfo = cleanText(body.browser_info, 500);
  const marketingOptIn = body.marketing_opt_in === true;
  const consentText = cleanText(body.consent_text, 1000);
  const consentVersion = cleanText(body.consent_version, 50);

  if (firstName.length < 1 || firstName.length > 80) {
    return jsonFor(origin, 400, { ok: false, error: "Please enter your first name." });
  }
  if (lastName.length < 1 || lastName.length > 80) {
    return jsonFor(origin, 400, { ok: false, error: "Please enter your last name." });
  }
  if (!isValidEmail(email)) {
    return jsonFor(origin, 400, { ok: false, error: "Please enter a valid email address." });
  }
  if (phone && (phone.length < 6 || phone.length > 40)) {
    return jsonFor(origin, 400, { ok: false, error: "Please enter a valid phone number." });
  }
  if (message.length < 1) {
    return jsonFor(origin, 400, { ok: false, error: "Please enter a message." });
  }
  if (typeof body.message === "string" && body.message.length > 5000) {
    return jsonFor(origin, 400, { ok: false, error: "Your message is too long (max 5000 characters)." });
  }
  if (!sourcePage) {
    return jsonFor(origin, 400, { ok: false, error: "Invalid request." });
  }

  const fullName = `${firstName} ${lastName}`.trim();
  const subject = `Website demo request — ${fullName}`;
  const contextLines = [
    `Name: ${fullName}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : null,
    `Source page: ${sourcePage}`,
    browserInfo ? `Browser: ${browserInfo}` : null,
    `Marketing opt-in: ${marketingOptIn ? "yes" : "no"}`,
  ].filter(Boolean);
  const storedMessage = `${message}\n\n---\n${contextLines.join("\n")}`;

  // Rapid duplicate guard — same address, same category, within the window.
  // Runs alongside the rate-limit round-trip; both are awaited before the
  // enquiry is written.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const duplicatePromise = vinetrack
    .from("support_requests")
    .select("id, message")
    .eq("category", CATEGORY)
    .ilike("submitter_email", email)
    .gte("created_at", since)
    .limit(5);

  const [limit, recent] = await Promise.all([
    limitPromise,
    duplicatePromise.then(
      (r) => r,
      (e) => {
        console.error("website-enquiry duplicate check failed", e);
        return { data: null, error: e } as { data: null; error: unknown };
      },
    ),
  ]);

  if (!limit.allowed) {
    return jsonFor(origin, 429, {
      ok: false,
      error: "Too many attempts. Please try again in a few minutes.",
    });
  }

  if (!recent.error) {
    const dup = ((recent.data ?? []) as Array<{ id: string; message?: string }>).find(
      (r) => typeof r.message === "string" && r.message.startsWith(message),
    );
    if (dup) {
      return jsonFor(origin, 200, {
        ok: true,
        id: dup.id,
        message: "Thanks — we've already received your enquiry and will be in touch.",
      });
    }
  }


  // Durable record first — the DB row is authoritative.
  const insert = await vinetrack
    .from("support_requests")
    .insert({
      user_id: null,
      submitter_name: fullName,
      submitter_email: email,
      category: CATEGORY,
      subject,
      message: storedMessage,
      app_platform: PLATFORM,
      status: "new",
      email_status: "pending",
    })
    .select("id, created_at")
    .single();

  if (insert.error || !insert.data) {
    console.error("website-enquiry save failed", insert.error);
    return jsonFor(origin, 500, {
      ok: false,
      error: "We couldn't submit your enquiry. Please try again.",
    });
  }

  const requestId = (insert.data as { id: string }).id;
  const submittedAt = (insert.data as { created_at?: string }).created_at ??
    new Date().toISOString();

  // Sends through Lovable's managed email API. Suppression, retries and rate

  // limits are enforced server-side; a suppressed recipient is an expected
  // outcome, not a failure.
  async function sendTemplate(
    templateName: string,
    recipientEmail: string,
    idempotencyKey: string,
    templateData: Record<string, unknown>,
  ): Promise<{ ok: boolean; suppressed?: boolean; error?: string }> {
    try {
      const result = await sendTemplateEmail(templateName, recipientEmail, {
        templateData,
        idempotencyKey,
      });
      if (!result.sent) {
        await logEmailSend(cloud, {
          templateName,
          recipientEmail,
          status: "suppressed",
          errorMessage: result.reason,
        });
        return { ok: true, suppressed: true };
      }
      await logEmailSend(cloud, { templateName, recipientEmail, status: "sent" });
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await logEmailSend(cloud, {
        templateName,
        recipientEmail,
        status: "failed",
        errorMessage: message,
      });
      return { ok: false, error: message.slice(0, 500) };
    }
  }


  // ---------------------------------------------------------------------
  // Post-persistence work. The enquiry row is already durable and
  // authoritative, so none of this can lose it and the public browser is not
  // held open for the email round-trips. email_status / email_error
  // bookkeeping and the existing sync-support-request-emails retry behaviour
  // are unchanged.
  // ---------------------------------------------------------------------
  async function finishEnquiry(): Promise<void> {
    // Staff notification — existing shared support_request template/recipient.
    const staff = await sendTemplate(
      STAFF_TEMPLATE,
      STAFF_FALLBACK_RECIPIENT,
      `support_request:${requestId}`,
      {
        request_type: CATEGORY,
        subject: `WEBSITE DEMO REQUEST — ${fullName}`,
        message:
          `${message}\n\nName: ${fullName}\nEmail: ${email}\nPhone: ${phone || "—"}\n` +
          `Source page: ${sourcePage}\nSubmitted: ${submittedAt}\nSupport Request ID: ${requestId}`,
        request_id: requestId,
        user_name: fullName,
        user_email: email,
        user_role: "website visitor",
        vineyard_name: null,
        vineyard_id: null,
        page_path: sourcePage,
        browser_info: browserInfo || null,
        attachments: [],
        admin_url: `${ADMIN_BASE}/${requestId}`,
      },
    );

    // Visitor receipt — no admin links, no private information.
    const receipt = await sendTemplate(
      RECEIPT_TEMPLATE,
      email,
      `website_enquiry_receipt:${requestId}`,
      { first_name: firstName },
    );

    if (!staff.ok) console.error("website-enquiry staff email failed", staff.error);
    if (!receipt.ok) console.error("website-enquiry receipt email failed", receipt.error);

    // Email status bookkeeping only — never undo the saved enquiry. A failed
    // staff notification stays "pending" so the existing retry cron picks it up.
    try {
      const patch: Record<string, unknown> = staff.ok
        ? {
          email_status: staff.suppressed ? "suppressed" : "sent",
          email_sent_at: staff.suppressed ? null : new Date().toISOString(),
          email_error: receipt.ok ? null : `receipt: ${receipt.error}`,
        }
        : { email_status: "pending", email_error: `staff: ${staff.error}`.slice(0, 1000) };

      await vinetrack.from("support_requests").update(patch).eq("id", requestId);
    } catch (e) {
      console.error("website-enquiry email status update failed", e);
    }

    // Marketing list — canonical VineTrack store, only with explicit consent.
    if (marketingOptIn) {
      const sub = await upsertSubscriberCanonical(vinetrack, cloud, {
        email,
        first_name: firstName,
        last_name: lastName,
        source: "website_demo_opt_in",
        source_page: sourcePage,
        consent_text: consentText || null,
        consent_version: consentVersion || null,
      });
      if (!sub.ok) console.error("website-enquiry subscriber upsert failed", sub.error);
    }
  }

  const background = finishEnquiry().catch((e) => {
    console.error("website-enquiry background work failed", e);
  });
  const waitUntil = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil(background);
  } else {
    // No background support in this runtime — correctness before speed.
    await background;
  }

  return jsonFor(origin, 200, {
    ok: true,
    id: requestId,
    message: "Thanks for contacting VineTrack. We've received your enquiry and will be in touch.",
  });
});
