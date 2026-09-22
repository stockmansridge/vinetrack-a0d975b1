// Shared server-side plumbing for the Newsletter Builder admin functions.
//
// Authorisation mirrors admin-email-list: the caller must present a canonical
// VineTrack access token (x-vinetrack-token or Authorization: Bearer) that
// resolves to a user for whom public.is_system_admin() is true. The UI gate is
// never trusted. Campaign rows live on the Portal's own project (service role);
// audience data is read from the canonical VineTrack project.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** PostgREST / Postgres codes meaning "this table does not exist here". */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "PGRST200" || error.code === "42P01") return true;
  return /could not find the table/i.test(error.message ?? "");
}
import {
  normaliseEmail,
  resolveAudience,
  type AudienceCounts,
  type ResolvedRecipient,
} from "./audience.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vinetrack-token, x-newsletter-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
export const jsonError = (status: number, message: string) => json(status, { error: message });

export interface AdminContext {
  /** Portal project, service role — owns the newsletter tables. */
  portal: SupabaseClient;
  /** Canonical VineTrack project, service role — subscribers. */
  vinetrack: SupabaseClient;
  /** Canonical VineTrack project acting as the signed-in admin — RPC reads. */
  asAdmin: SupabaseClient;
  userId: string;
  userEmail: string;
}

export type AdminResult = { ok: true; ctx: AdminContext } | { ok: false; response: Response };

/**
 * Scheduler context — NO user token.
 *
 * Used only by the run_due scheduler pass, which delivers versions whose
 * content and recipient list were already frozen by a system admin. It never
 * resolves an audience, so no admin RPC is required. Callers must pass the
 * cron secret (see cronAuthorised) before using this.
 */
export function systemContext(): AdminContext | null {
  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const CLOUD_URL = Deno.env.get("SUPABASE_URL");
  const CLOUD_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!VT_URL || !VT_SERVICE || !CLOUD_URL || !CLOUD_SERVICE) return null;
  const vinetrack = createClient(VT_URL, VT_SERVICE, { auth: { persistSession: false } });
  return {
    portal: createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } }),
    vinetrack,
    asAdmin: vinetrack,
    userId: "",
    userEmail: "scheduler",
  };
}

/** True when the request carries the scheduler secret or the service role key. */
export function cronAuthorised(req: Request): boolean {
  const secret = Deno.env.get("NEWSLETTER_CRON_SECRET") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("x-newsletter-cron-secret") ?? "").trim();
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (secret && provided && provided === secret) return true;
  if (service && bearer && bearer === service) return true;
  return false;
}

export async function requireSystemAdmin(req: Request): Promise<AdminResult> {
  const VT_URL = Deno.env.get("VINETRACK_SUPABASE_URL");
  const VT_ANON = Deno.env.get("VINETRACK_ANON_KEY");
  const VT_SERVICE = Deno.env.get("VINETRACK_SERVICE_ROLE_KEY");
  const CLOUD_URL = Deno.env.get("SUPABASE_URL");
  const CLOUD_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!VT_URL || !VT_ANON || !VT_SERVICE || !CLOUD_URL || !CLOUD_SERVICE) {
    return { ok: false, response: jsonError(503, "Backend is not configured.") };
  }

  const vinetrackToken = (req.headers.get("x-vinetrack-token") ?? "").trim();
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = vinetrackToken ||
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "");
  if (!bearer) return { ok: false, response: jsonError(401, "Unauthorized") };

  const asAdmin = createClient(VT_URL, VT_ANON, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await asAdmin.auth.getUser(bearer);
  if (userErr || !userData?.user) return { ok: false, response: jsonError(401, "Unauthorized") };

  const { data: isAdmin, error: adminErr } = await asAdmin.rpc("is_system_admin");
  if (adminErr) {
    return { ok: false, response: jsonError(403, "Could not verify system admin access.") };
  }
  if (!isAdmin) return { ok: false, response: jsonError(403, "System admin access required.") };

  return {
    ok: true,
    ctx: {
      portal: createClient(CLOUD_URL, CLOUD_SERVICE, { auth: { persistSession: false } }),
      vinetrack: createClient(VT_URL, VT_SERVICE, { auth: { persistSession: false } }),
      asAdmin,
      userId: userData.user.id,
      userEmail: userData.user.email ?? "",
    },
  };
}

export interface AudienceSelection {
  includeCurrentUsers: boolean;
  includeSubscribers: boolean;
}

export interface AudienceResolution {
  recipients: ResolvedRecipient[];
  counts: AudienceCounts;
  warnings: string[];
}

/** Reads the live sets and applies the pure set logic. */
export async function resolveLiveAudience(
  ctx: AdminContext,
  selection: AudienceSelection,
): Promise<AudienceResolution> {
  const warnings: string[] = [];
  let currentUsers: string[] = [];
  let subscribers: string[] = [];
  let unsubscribed: string[] = [];

  if (selection.includeCurrentUsers) {
    // Called as the signed-in system admin: admin_list_users is the Portal's
    // existing definition of the user base.
    const { data, error } = await ctx.asAdmin.rpc("admin_list_users");
    if (error) {
      warnings.push("Current Users could not be read from the VineTrack database.");
    } else {
      // "Current Users" = every row admin_list_users returns, i.e. every
      // VineTrack auth account, regardless of vineyard membership or last
      // sign-in. Rows without a usable address are dropped here and counted as
      // invalid by resolveAudience.
      currentUsers = ((data ?? []) as { email?: string | null }[])
        .map((u) => (u.email ?? "").trim())
        .filter((e) => e.length > 0);
    }
  }

  if (selection.includeSubscribers) {
    let rows: { email: string; status: string }[] | null = null;
    const primary = await ctx.vinetrack
      .from("email_list_subscribers")
      .select("email, status");
    if (primary.error && isMissingTableError(primary.error)) {
      const legacy = await ctx.portal.from("email_list_subscribers").select("email, status");
      if (legacy.error) warnings.push("Newsletter Subscribers could not be read.");
      else rows = legacy.data as { email: string; status: string }[];
    } else if (primary.error) {
      warnings.push("Newsletter Subscribers could not be read.");
    } else {
      rows = primary.data as { email: string; status: string }[];
    }
    for (const row of rows ?? []) {
      if (row.status === "subscribed") subscribers.push(row.email);
      else unsubscribed.push(row.email);
    }
  }

  // Unsubscribes/bounces/complaints recorded by the email webhooks always apply.
  const suppressedRes = await ctx.portal.from("suppressed_emails").select("email");
  if (suppressedRes.error) {
    warnings.push("Suppression list could not be read — send blocked for safety.");
  }
  const suppressed = ((suppressedRes.data ?? []) as { email: string }[]).map((r) => r.email);

  const resolved = resolveAudience({
    currentUsers,
    subscribers,
    unsubscribed,
    suppressed,
    includeCurrentUsers: selection.includeCurrentUsers,
    includeSubscribers: selection.includeSubscribers,
  });

  return { ...resolved, warnings };
}

/** SHA-256 hex of the normalised address — stored instead of raw addresses. */
export async function emailHash(email: string): Promise<string> {
  const data = new TextEncoder().encode(normaliseEmail(email));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
