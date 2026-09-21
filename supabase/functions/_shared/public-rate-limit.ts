// Conservative server-side rate limiting for the PUBLIC website endpoints.
//
// CORS and the honeypot only constrain browsers; a direct HTTP caller ignores
// both. This limiter is the server-side backstop.
//
// Privacy: the caller's IP address is never stored. Only a SHA-256 hash of
// `form:ip` is kept, inside a fixed time window, and rows older than two hours
// are pruned on the way through. There is nothing personal to retain.
//
// Storage lives on the Portal's own project (operational data, not VineTrack
// business data) in public.public_form_rate_limits, service-role only.

// deno-lint-ignore no-explicit-any
type Client = any;

export interface RateLimitRule {
  /** Logical form name, e.g. "website-enquiry". */
  form: string;
  /** Maximum submissions allowed per window for one caller. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Best-effort caller identity from the edge proxy headers. */
export function callerIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

async function hashKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Count this request against the rule.
 *
 * Fails OPEN: if the limiter table or the database is unavailable the request
 * is allowed, because losing a genuine enquiry is worse than allowing an extra
 * submission. The honeypot and duplicate detection still apply.
 */
export async function checkRateLimit(
  admin: Client,
  req: Request,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const allowed: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };
  try {
    const windowMs = rule.windowSeconds * 1000;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
    const keyHash = await hashKey(`${rule.form}:${callerIp(req)}`);

    const existing = await admin
      .from("public_form_rate_limits")
      .select("id, request_count")
      .eq("key_hash", keyHash)
      .eq("window_started_at", windowStart)
      .maybeSingle();

    if (existing.error) return allowed;

    if (existing.data) {
      const count = Number(existing.data.request_count ?? 0);
      if (count >= rule.limit) {
        const elapsed = Date.now() - new Date(windowStart).getTime();
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
        };
      }
      await admin
        .from("public_form_rate_limits")
        .update({ request_count: count + 1, updated_at: new Date().toISOString() })
        .eq("id", existing.data.id);
      return allowed;
    }

    const insert = await admin.from("public_form_rate_limits").insert({
      key_hash: keyHash,
      form: rule.form,
      window_started_at: windowStart,
      request_count: 1,
    });
    // Lost a race with a concurrent request in the same window — treat as one
    // more hit rather than failing the submission.
    if (insert.error && insert.error.code !== "23505") return allowed;

    // Opportunistic pruning; never blocks the caller.
    void admin
      .from("public_form_rate_limits")
      .delete()
      .lt("window_started_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .then(() => {})
      .catch(() => {});

    return allowed;
  } catch (e) {
    console.error(`${rule.form} rate limit check failed`, e);
    return allowed;
  }
}
