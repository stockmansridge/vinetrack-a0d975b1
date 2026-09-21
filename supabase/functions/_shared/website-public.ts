// Shared helpers for the PUBLIC VineTrack website endpoints
// (website-enquiry, newsletter-subscribe).
//
// These endpoints are anonymous, so:
//   - CORS is restricted to the VineTrack website origins (plus Lovable
//     preview/localhost during development). Non-browser callers get no
//     Access-Control-Allow-Origin header back.
//   - No service-role key, database credential or admin RPC is ever exposed
//     in a response body.

/** Production website origins. */
export const WEBSITE_ORIGINS = [
  "https://www.vinetrack.com.au",
  "https://vinetrack.com.au",
  "https://portal.vinetrack.com.au",
];

/** Development/preview origins: Lovable preview domains and localhost. */
const DEV_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  /^https:\/\/[a-z0-9-]+\.sandbox\.lovable\.dev$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (WEBSITE_ORIGINS.includes(origin)) return true;
  return DEV_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

export function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin as string;
  }
  return headers;
}

export function jsonFor(
  origin: string | null,
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
  });
}

/** Trim + lowercase. Returns "" when the value is not a usable string. */
export function normaliseEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/;

export function isValidEmail(email: string): boolean {
  return email.length >= 5 && email.length <= 254 && EMAIL_RE.test(email);
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

/** Honeypot fields must be empty — anything else is a bot. */
export function honeypotTripped(body: Record<string, unknown>): boolean {
  for (const key of ["honeypot", "website", "company_website", "hp"]) {
    const v = body[key];
    if (typeof v === "string" && v.trim().length > 0) return true;
    if (v === true) return true;
  }
  return false;
}
