// PUBLIC newsletter subscribe endpoint for the VineTrack marketing website.
// Anonymous; CORS restricted to the VineTrack website origins (plus Lovable
// preview/localhost during development).
//
// Collects and manages the list only — no campaign or marketing email is sent
// from here. Writes go through the service role: the website never touches
// public.email_list_subscribers directly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  cleanText,
  corsHeadersFor,
  honeypotTripped,
  isValidEmail,
  jsonFor,
  normaliseEmail,
} from "../_shared/website-public.ts";
import { upsertSubscriber } from "../_shared/email-list.ts";

const OK_MESSAGE = "You're subscribed to VineTrack updates.";

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
  if (!CLOUD_URL || !CLOUD_SERVICE) {
    console.error("newsletter-subscribe missing configuration");
    return jsonFor(origin, 503, { ok: false, error: "This form is temporarily unavailable." });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonFor(origin, 400, { ok: false, error: "Invalid request." });
  }

  // Silently accept and discard honeypot spam.
  if (honeypotTripped(body)) {
    return jsonFor(origin, 200, { ok: true, message: OK_MESSAGE });
  }

  const email = normaliseEmail(body.email);
  const firstName = cleanText(body.first_name, 80);
  const lastName = cleanText(body.last_name, 80);
  const sourcePage = cleanText(body.source_page, 300);
  const consentText = cleanText(body.consent_text, 1000);
  const consentVersion = cleanText(body.consent_version, 50);

  if (!isValidEmail(email)) {
    return jsonFor(origin, 400, { ok: false, error: "Please enter a valid email address." });
  }

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } });
  const result = await upsertSubscriber(cloud, {
    email,
    first_name: firstName || null,
    last_name: lastName || null,
    source: "website_newsletter",
    source_page: sourcePage || null,
    consent_text: consentText || null,
    consent_version: consentVersion || null,
  });

  if (!result.ok) {
    console.error("newsletter-subscribe upsert failed", result.error);
    return jsonFor(origin, 500, {
      ok: false,
      error: "We couldn't complete your subscription. Please try again.",
    });
  }

  // Never reveal whether the address already existed.
  return jsonFor(origin, 200, { ok: true, message: OK_MESSAGE });
});
