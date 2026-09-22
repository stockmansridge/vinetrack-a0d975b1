// System-admin only: manage newsletter drafts, resolve audience counts, render
// previews and send test emails. Real sending lives in admin-newsletter-send.
//
// POST { action: "list" }                     -> { campaigns }
// POST { action: "get", id }                  -> { campaign, versions }
// POST { action: "save", campaign }           -> { campaign }
// POST { action: "duplicate", id }            -> { campaign }
// POST { action: "delete", id }               -> { deleted }
// POST { action: "audience", include_current_users, include_subscribers }
//                                             -> { counts, warnings }
// POST { action: "preview", campaign }        -> { html, text }
// POST { action: "send_test", campaign, recipients: string[] } -> { sent, failed }
import { requireSystemAdmin, json, jsonError, corsHeaders, resolveLiveAudience } from "../_shared/newsletter/admin.ts";
import { renderNewsletterHtml, renderNewsletterText } from "../_shared/newsletter/render.ts";
import { isValidEmail, normaliseEmail } from "../_shared/newsletter/audience.ts";
import { sendNewsletterEmail } from "../_shared/newsletter/send.ts";

const CAMPAIGN_COLUMNS =
  "id, name, subject, preheader, from_name, reply_to, logo_url, logo_path, logo_alt, audience_current_users, audience_subscribers, blocks, status, scheduled_at, timezone, audience_counts, current_version_id, created_by_email, created_at, updated_at";

const EDITABLE_STATUSES = new Set(["draft", "scheduled", "failed"]);

function durableLogoUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.pathname.toLowerCase().includes("/storage/v1/object/sign/") || url.searchParams.has("token")) {
      return null;
    }
    return raw.slice(0, 2_000);
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderOf(campaign: any, isTest = false) {
  return {
    subject: String(campaign?.subject ?? ""),
    preheader: campaign?.preheader ?? null,
    blocks: Array.isArray(campaign?.blocks) ? campaign.blocks : [],
    logoUrl: campaign?.logo_url ?? null,
    logoAlt: campaign?.logo_alt ?? null,
    isTest,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const auth = await requireSystemAdmin(req);
  if (!auth.ok) return auth.response;
  const { portal, userId, userEmail } = auth.ctx;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body.action ?? "list");

  try {
    if (action === "list") {
      const { data, error } = await portal
        .from("newsletter_campaigns")
        .select(CAMPAIGN_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return jsonError(500, error.message);
      const ids = (data ?? []).map((c: { id: string }) => c.id);
      let versions: unknown[] = [];
      if (ids.length) {
        const v = await portal
          .from("newsletter_campaign_versions")
          .select(
            "id, campaign_id, status, recipient_count, suppressed_count, sent_count, failed_count, scheduled_at, started_at, completed_at, sender_email, error_message, created_at",
          )
          .in("campaign_id", ids)
          .order("created_at", { ascending: false });
        versions = v.data ?? [];
      }
      return json(200, { campaigns: data ?? [], versions });
    }

    if (action === "get") {
      const id = String(body.id ?? "");
      if (!id) return jsonError(400, "Missing id");
      const { data, error } = await portal
        .from("newsletter_campaigns")
        .select(CAMPAIGN_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) return jsonError(500, error.message);
      if (!data) return jsonError(404, "Newsletter not found");
      const versions = await portal
        .from("newsletter_campaign_versions")
        .select(
          "id, status, subject, recipient_count, suppressed_count, sent_count, failed_count, audience_current_users, audience_subscribers, audience_counts, sender_email, scheduled_at, started_at, completed_at, error_message, created_at",
        )
        .eq("campaign_id", id)
        .order("created_at", { ascending: false });
      return json(200, { campaign: data, versions: versions.data ?? [] });
    }

    if (action === "save") {
      const c = (body.campaign ?? {}) as Record<string, unknown>;
      const logoUrl = durableLogoUrl(c.logo_url);
      const patch = {
        name: String(c.name ?? "Untitled newsletter").slice(0, 200) || "Untitled newsletter",
        subject: String(c.subject ?? "").slice(0, 300),
        preheader: c.preheader ? String(c.preheader).slice(0, 300) : null,
        from_name: c.from_name ? String(c.from_name).slice(0, 120) : null,
        reply_to: c.reply_to ? String(c.reply_to).slice(0, 200) : null,
        logo_url: logoUrl,
        logo_path: logoUrl && c.logo_path ? String(c.logo_path).slice(0, 500) : null,
        logo_alt: c.logo_alt ? String(c.logo_alt).slice(0, 200) : null,
        audience_current_users: Boolean(c.audience_current_users),
        audience_subscribers: Boolean(c.audience_subscribers),
        blocks: Array.isArray(c.blocks) ? c.blocks : [],
        scheduled_at: c.scheduled_at ? String(c.scheduled_at) : null,
        timezone: String(c.timezone ?? "Australia/Sydney"),
      };

      const id = c.id ? String(c.id) : "";
      if (!id) {
        const { data, error } = await portal
          .from("newsletter_campaigns")
          .insert({ ...patch, created_by: userId, created_by_email: userEmail })
          .select(CAMPAIGN_COLUMNS)
          .single();
        if (error) return jsonError(500, error.message);
        return json(200, { campaign: data });
      }

      const existing = await portal
        .from("newsletter_campaigns")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (existing.error) return jsonError(500, existing.error.message);
      if (!existing.data) return jsonError(404, "Newsletter not found");
      // A sent campaign keeps its historical content — duplicate to edit.
      if (!EDITABLE_STATUSES.has(String(existing.data.status))) {
        return jsonError(
          409,
          "This newsletter has already been sent. Duplicate it to make a new draft.",
        );
      }
      const { data, error } = await portal
        .from("newsletter_campaigns")
        .update(patch)
        .eq("id", id)
        .select(CAMPAIGN_COLUMNS)
        .single();
      if (error) return jsonError(500, error.message);
      return json(200, { campaign: data });
    }

    if (action === "duplicate") {
      const id = String(body.id ?? "");
      if (!id) return jsonError(400, "Missing id");
      const source = await portal
        .from("newsletter_campaigns")
        .select(CAMPAIGN_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (source.error) return jsonError(500, source.error.message);
      if (!source.data) return jsonError(404, "Newsletter not found");
      const s = source.data as Record<string, unknown>;
      const { data, error } = await portal
        .from("newsletter_campaigns")
        .insert({
          name: `${String(s.name ?? "Newsletter")} (copy)`.slice(0, 200),
          subject: s.subject,
          preheader: s.preheader,
          from_name: s.from_name,
          reply_to: s.reply_to,
          logo_url: s.logo_url,
          logo_path: s.logo_path,
          logo_alt: s.logo_alt,
          audience_current_users: s.audience_current_users,
          audience_subscribers: s.audience_subscribers,
          blocks: s.blocks,
          timezone: s.timezone,
          status: "draft",
          created_by: userId,
          created_by_email: userEmail,
        })
        .select(CAMPAIGN_COLUMNS)
        .single();
      if (error) return jsonError(500, error.message);
      return json(200, { campaign: data });
    }

    if (action === "delete") {
      const id = String(body.id ?? "");
      if (!id) return jsonError(400, "Missing id");
      const existing = await portal
        .from("newsletter_campaigns")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (existing.error) return jsonError(500, existing.error.message);
      if (!existing.data) return jsonError(404, "Newsletter not found");
      if (!["draft", "failed"].includes(String(existing.data.status))) {
        return jsonError(409, "Only drafts can be deleted.");
      }
      const { error } = await portal.from("newsletter_campaigns").delete().eq("id", id);
      if (error) return jsonError(500, error.message);
      return json(200, { deleted: true });
    }

    if (action === "audience") {
      const resolved = await resolveLiveAudience(auth.ctx, {
        includeCurrentUsers: Boolean(body.include_current_users),
        includeSubscribers: Boolean(body.include_subscribers),
      });
      return json(200, { counts: resolved.counts, warnings: resolved.warnings });
    }

    if (action === "preview") {
      const opts = renderOf(body.campaign);
      return json(200, {
        html: renderNewsletterHtml(opts),
        text: renderNewsletterText(opts),
      });
    }

    if (action === "send_test") {
      const raw = Array.isArray(body.recipients) ? body.recipients : [];
      const recipients = Array.from(
        new Set(raw.map((r) => normaliseEmail(r)).filter((e) => e && isValidEmail(e))),
      ).slice(0, 5);
      if (recipients.length === 0) {
        return jsonError(400, "Enter at least one valid test address.");
      }
      // Test sends use the same renderer as the real send and touch neither the
      // campaign audience nor subscriber status.
      const opts = renderOf(body.campaign, true);
      const html = renderNewsletterHtml(opts);
      const text = renderNewsletterText(opts);
      const subject = `[TEST] ${opts.subject || "VineTrack newsletter"}`.slice(0, 300);
      const campaign = (body.campaign ?? {}) as Record<string, unknown>;

      const results: { email: string; ok: boolean; error?: string }[] = [];
      for (const email of recipients) {
        const outcome = await sendNewsletterEmail({
          to: email,
          subject,
          html,
          text,
          fromName: campaign.from_name ? String(campaign.from_name) : undefined,
          replyTo: campaign.reply_to ? String(campaign.reply_to) : undefined,
          label: "newsletter_test",
          idempotencyKey: `nltest_${crypto.randomUUID()}`,
        });
        results.push({ email, ok: outcome.ok, error: outcome.ok ? undefined : outcome.error });
      }
      return json(200, {
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).map((r) => ({ email: r.email, error: r.error })),
      });
    }

    return jsonError(400, "Unknown action");
  } catch (err) {
    console.error("admin-newsletters failed", err);
    return jsonError(500, err instanceof Error ? err.message : "Unexpected error");
  }
});
