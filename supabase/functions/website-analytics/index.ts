// PUBLIC first-party analytics endpoint for the VineTrack marketing website.
//
// Receives anonymous traffic events only. Same origin rules and server-side
// abuse protection as website-enquiry / newsletter-subscribe; no service-role
// key, credential or admin RPC is ever exposed to the website.
//
// Privacy: nothing personal is accepted or stored — no name, email, IP address
// or user agent. page_path is normalised (query string and hash stripped) and
// only the referrer HOST is kept. session_id is an anonymous browser id.
//
// Request:
//   { event: "page_view", page_path, session_id (uuid), referrer_domain?,
//     utm_source?, utm_medium?, utm_campaign? }
// Response: 200 { ok: true } — always fast, and never blocks navigation.
//
// Writes go to the canonical VineTrack public.website_page_views
// (see sql/243). Analytics data is never stored on the Portal's own project.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  cleanText,
  corsHeadersFor,
  isAllowedOrigin,
  jsonFor,
} from "../_shared/website-public.ts";
import { checkRateLimit } from "../_shared/public-rate-limit.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BOT_RE =
  /(bot|crawler|spider|crawl|slurp|bingpreview|headlesschrome|phantomjs|puppeteer|playwright|curl|wget|python-requests|facebookexternalhit|preview|monitor|pingdom|lighthouse|gtmetrix|semrush|ahrefs|mj12|dotbot)/i;

/** Strip query string, hash and trailing slash; keep a leading slash. */
export function normalisePagePath(raw: unknown): string {
  let value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  // Accept a full URL as well as a path.
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return "";
    }
  }
  value = value.split("?")[0].split("#")[0];
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1) value = value.replace(/\/+$/, "") || "/";
  if (value.length > 300) return "";
  if (/[\s<>"'\\]/.test(value)) return "";
  return value;
}

/** Host only — never a full referrer URL, which could carry personal data. */
export function normaliseReferrerDomain(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return "";
  let host = value;
  if (/^https?:\/\//.test(value)) {
    try {
      host = new URL(value).hostname;
    } catch {
      return "";
    }
  }
  host = host.split("/")[0].split("?")[0].replace(/^www\./, "");
  if (!/^[a-z0-9.-]{1,180}$/.test(host)) return "";
  return host;
}

const PRODUCTION_ORIGINS = ["https://www.vinetrack.com.au", "https://vinetrack.com.au"];

export function environmentFor(origin: string | null): "production" | "preview" {
  return origin && PRODUCTION_ORIGINS.includes(origin) ? "production" : "preview";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(origin) });
  }
  if (req.method !== "POST") {
    return jsonFor(origin, 405, { ok: false, error: "Method not allowed" });
  }
  if (!isAllowedOrigin(origin)) {
    return jsonFor(origin, 403, { ok: false, error: "Not allowed." });
  }

  // Obvious automated traffic is dropped silently — it must not skew reports,
  // and the caller is never told it was ignored.
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT_RE.test(ua)) {
    return jsonFor(origin, 200, { ok: true });
  }

  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const CLOUD_URL = Deno.env.get("SUPABASE_URL");
  const CLOUD_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!VT_URL || !VT_SERVICE || !CLOUD_URL || !CLOUD_SERVICE) {
    console.error("website-analytics missing configuration");
    return jsonFor(origin, 200, { ok: true });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonFor(origin, 400, { ok: false, error: "Invalid request." });
  }

  const event = cleanText(body.event, 40) || "page_view";
  if (event !== "page_view") {
    return jsonFor(origin, 400, { ok: false, error: "Unsupported event." });
  }

  const pagePath = normalisePagePath(body.page_path);
  if (!pagePath) {
    return jsonFor(origin, 400, { ok: false, error: "Invalid page_path." });
  }
  const sessionId = cleanText(body.session_id, 64);
  if (!UUID_RE.test(sessionId)) {
    return jsonFor(origin, 400, { ok: false, error: "Invalid session_id." });
  }

  const cloud = createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } });
  // Generous but finite: a real visitor browsing quickly stays well under this.
  const limit = await checkRateLimit(cloud, req, {
    form: "website-analytics",
    limit: 240,
    windowSeconds: 900,
  });
  if (!limit.allowed) {
    // Silently accepted: tracking must never surface an error to a visitor.
    return jsonFor(origin, 200, { ok: true });
  }

  const vinetrack = createClient(VT_URL, VT_SERVICE, { auth: { persistSession: false } });
  const { error } = await vinetrack.from("website_page_views").insert({
    page_path: pagePath,
    session_id: sessionId,
    referrer_domain: normaliseReferrerDomain(body.referrer_domain) || null,
    utm_source: cleanText(body.utm_source, 120) || null,
    utm_medium: cleanText(body.utm_medium, 120) || null,
    utm_campaign: cleanText(body.utm_campaign, 200) || null,
    environment: environmentFor(origin),
  });
  if (error) {
    // Never fail the visitor's page: log and still return ok.
    console.error("website-analytics insert failed", error.message);
  }

  return jsonFor(origin, 200, { ok: true });
});
