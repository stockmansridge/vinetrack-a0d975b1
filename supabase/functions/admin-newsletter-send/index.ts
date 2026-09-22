// System-admin only: freeze a newsletter version and deliver it.
//
// Idempotency model — a repeated click, retry or uncertain response NEVER
// creates a second campaign:
//   1. A send/schedule creates at most ONE open version per campaign. If an
//      open version already exists it is reused ("reconcile" path).
//   2. Every recipient of that version gets a row with a stable idempotency
//      key; a resumed run only sends rows still 'pending', and the provider
//      rejects a duplicate key.
//
// POST { action: "send", id }                 -> { version, sent, failed }
// POST { action: "schedule", id, scheduled_at } -> { version }
// POST { action: "cancel", id }               -> { cancelled }
// POST { action: "resume", id }               -> { version, sent, failed }
// POST { action: "run_due" }                  -> { processed }  (scheduler pass)
import {
  corsHeaders,
  cronAuthorised,
  emailHash,
  json,
  jsonError,
  requireSystemAdmin,
  resolveLiveAudience,
  systemContext,
  type AdminContext,
} from "../_shared/newsletter/admin.ts";
import { renderNewsletterHtml, renderNewsletterText } from "../_shared/newsletter/render.ts";
import { recipientIdempotencyKey } from "../_shared/newsletter/audience.ts";
import { logNewsletterSend, sendNewsletterEmail } from "../_shared/newsletter/send.ts";

const OPEN_VERSION_STATUSES = ["preparing", "scheduled", "sending"];
/** Messages delivered per invocation; the client resumes until complete. */
const BATCH_SIZE = 60;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

async function loadCampaign(ctx: AdminContext, id: string): Promise<Row | null> {
  const { data } = await ctx.portal
    .from("newsletter_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Row) ?? null;
}

async function openVersion(ctx: AdminContext, campaignId: string): Promise<Row | null> {
  const { data } = await ctx.portal
    .from("newsletter_campaign_versions")
    .select("*")
    .eq("campaign_id", campaignId)
    .in("status", OPEN_VERSION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  const rows = (data ?? []) as Row[];
  return rows[0] ?? null;
}

/** Freezes content + audience into a version and materialises the recipients. */
async function createVersion(
  ctx: AdminContext,
  campaign: Row,
  opts: { scheduledAt?: string | null },
): Promise<{ ok: true; version: Row } | { ok: false; status: number; error: string }> {
  const includeCurrentUsers = Boolean(campaign.audience_current_users);
  const includeSubscribers = Boolean(campaign.audience_subscribers);
  if (!includeCurrentUsers && !includeSubscribers) {
    return { ok: false, status: 400, error: "Select at least one audience first." };
  }
  if (!String(campaign.subject ?? "").trim()) {
    return { ok: false, status: 400, error: "Add an email subject first." };
  }

  const resolved = await resolveLiveAudience(ctx, { includeCurrentUsers, includeSubscribers });
  // FAIL CLOSED: any warning means a source (users, subscribers or the
  // suppression list) could not be read in full. Sending on a partial audience
  // could email someone who has unsubscribed, so it is refused outright.
  if (resolved.warnings.length > 0) {
    return {
      ok: false,
      status: 503,
      error: `${resolved.warnings.join(" ")} Nothing was sent — try again once the data can be read.`,
    };
  }
  if (resolved.recipients.length === 0) {
    return { ok: false, status: 400, error: "This audience resolves to zero recipients." };
  }

  const renderOpts = {
    subject: String(campaign.subject ?? ""),
    preheader: campaign.preheader ?? null,
    blocks: Array.isArray(campaign.blocks) ? campaign.blocks : [],
    logoUrl: campaign.logo_url ?? null,
    logoAlt: campaign.logo_alt ?? null,
  };

  const insert = await ctx.portal
    .from("newsletter_campaign_versions")
    .insert({
      campaign_id: campaign.id,
      subject: renderOpts.subject,
      preheader: campaign.preheader ?? null,
      from_name: campaign.from_name ?? null,
      reply_to: campaign.reply_to ?? null,
      blocks: renderOpts.blocks,
      logo_url: campaign.logo_url ?? null,
      logo_path: campaign.logo_path ?? null,
      logo_alt: campaign.logo_alt ?? null,
      html: renderNewsletterHtml(renderOpts),
      text_body: renderNewsletterText(renderOpts),
      audience_current_users: includeCurrentUsers,
      audience_subscribers: includeSubscribers,
      audience_counts: resolved.counts,
      recipient_count: resolved.recipients.length,
      suppressed_count: resolved.counts.suppressed,
      status: opts.scheduledAt ? "scheduled" : "preparing",
      sender_user_id: ctx.userId,
      sender_email: ctx.userEmail,
      scheduled_at: opts.scheduledAt ?? null,
    })
    .select("*")
    .single();
  if (insert.error) return { ok: false, status: 500, error: insert.error.message };
  const version = insert.data as Row;

  const rows = await Promise.all(
    resolved.recipients.map(async (r) => ({
      version_id: version.id,
      email: r.email,
      email_hash: await emailHash(r.email),
      source: r.source,
      idempotency_key: recipientIdempotencyKey(version.id, r.email),
      status: "pending",
    })),
  );
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await ctx.portal
      .from("newsletter_campaign_recipients")
      .upsert(chunk, { onConflict: "version_id,email_hash", ignoreDuplicates: true });
    if (error) return { ok: false, status: 500, error: error.message };
  }

  await ctx.portal
    .from("newsletter_campaigns")
    .update({
      status: opts.scheduledAt ? "scheduled" : "preparing",
      scheduled_at: opts.scheduledAt ?? null,
      audience_counts: resolved.counts,
      current_version_id: version.id,
    })
    .eq("id", campaign.id);

  return { ok: true, version };
}

/** Sends up to BATCH_SIZE pending recipients for a version. */
async function deliverBatch(ctx: AdminContext, version: Row) {
  await ctx.portal
    .from("newsletter_campaign_versions")
    .update({ status: "sending", started_at: version.started_at ?? new Date().toISOString() })
    .eq("id", version.id);
  await ctx.portal
    .from("newsletter_campaigns")
    .update({ status: "sending" })
    .eq("id", version.campaign_id);

  // CONCURRENCY: two overlapping passes (a resume loop and the scheduler, say)
  // must not work the same rows. Each pass CLAIMS its rows with a conditional
  // update — only rows still 'pending' are returned, so a row can be claimed
  // once. The provider idempotency key remains the final backstop.
  const claimId = crypto.randomUUID();
  const pending = await ctx.portal
    .from("newsletter_campaign_recipients")
    .update({ status: "sending", claim_id: claimId, claimed_at: new Date().toISOString() })
    .eq("version_id", version.id)
    .eq("status", "pending")
    .in(
      "id",
      ((
        await ctx.portal
          .from("newsletter_campaign_recipients")
          .select("id")
          .eq("version_id", version.id)
          .eq("status", "pending")
          .limit(BATCH_SIZE)
      ).data ?? []).map((r: Row) => r.id),
    )
    .select("id, email, idempotency_key");
  if (pending.error) return { error: pending.error.message, sent: 0, failed: 0, remaining: -1 };

  const label = `newsletter_${version.campaign_id}`;
  let sent = 0;
  let failed = 0;

  for (const row of (pending.data ?? []) as Row[]) {
    const outcome = await sendNewsletterEmail({
      to: row.email,
      subject: version.subject,
      html: version.html,
      text: version.text_body ?? undefined,
      fromName: version.from_name ?? undefined,
      replyTo: version.reply_to ?? undefined,
      label,
      idempotencyKey: row.idempotency_key,
    });

    const patch = outcome.ok
      ? { status: "sent", message_id: outcome.messageId, sent_at: new Date().toISOString(), error_message: null }
      : outcome.suppressed
      ? { status: "suppressed", error_message: "recipient_suppressed" }
      : { status: "failed", error_message: String(outcome.error).slice(0, 500) };
    await ctx.portal.from("newsletter_campaign_recipients").update(patch).eq("id", row.id);
    await logNewsletterSend(ctx.portal, {
      recipient: row.email,
      label,
      outcome,
      metadata: { campaign_id: version.campaign_id, version_id: version.id },
    });
    if (outcome.ok) sent += 1;
    else if (!outcome.suppressed) failed += 1;
  }

  const tally = await ctx.portal
    .from("newsletter_campaign_recipients")
    .select("status")
    .eq("version_id", version.id);
  const statuses = ((tally.data ?? []) as Row[]).map((r) => r.status);
  const remaining = statuses.filter((s) => s === "pending" || s === "sending").length;
  const totalSent = statuses.filter((s) => s === "sent").length;
  const totalFailed = statuses.filter((s) => s === "failed").length;

  let status = "sending";
  if (remaining === 0) status = totalFailed > 0 ? (totalSent > 0 ? "partially_failed" : "failed") : "sent";

  await ctx.portal
    .from("newsletter_campaign_versions")
    .update({
      status,
      sent_count: totalSent,
      failed_count: totalFailed,
      completed_at: remaining === 0 ? new Date().toISOString() : null,
    })
    .eq("id", version.id);
  await ctx.portal
    .from("newsletter_campaigns")
    .update({ status: remaining === 0 ? status : "sending" })
    .eq("id", version.campaign_id);

  return { sent, failed, remaining, status };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body.action ?? "send");

  // The scheduler pass has no signed-in admin: it delivers versions whose
  // content and recipients a system admin already froze. It is authorised by
  // the cron secret (or the service role key) instead.
  let ctx: AdminContext;
  if (action === "run_due" && cronAuthorised(req)) {
    const system = systemContext();
    if (!system) return jsonError(503, "Backend is not configured.");
    ctx = system;
  } else {
    const auth = await requireSystemAdmin(req);
    if (!auth.ok) return auth.response;
    ctx = auth.ctx;
  }

  try {
    if (action === "run_due") {
      const now = Date.now();
      const due = await ctx.portal
        .from("newsletter_campaign_versions")
        .select("*")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date(now).toISOString())
        .limit(3);

      // INTERRUPTED SEND RECOVERY: a version left 'sending' because an earlier
      // invocation was cut short (timeout, deploy, crash) is picked up again.
      // Delivery resumes on the SAME frozen version, and rows claimed by the
      // dead pass are released so they can be retried; the provider
      // idempotency key prevents any duplicate email.
      const STALE_MS = 10 * 60 * 1000;
      const stuck = await ctx.portal
        .from("newsletter_campaign_versions")
        .select("*")
        .eq("status", "sending")
        .lte("started_at", new Date(now - STALE_MS).toISOString())
        .limit(3);

      const versions = [...((due.data ?? []) as Row[]), ...((stuck.data ?? []) as Row[])];
      let processed = 0;
      for (const version of versions) {
        await ctx.portal
          .from("newsletter_campaign_recipients")
          .update({ status: "pending", claim_id: null, claimed_at: null })
          .eq("version_id", version.id)
          .eq("status", "sending")
          .lte("claimed_at", new Date(now - STALE_MS).toISOString());

        // Drain this version within the invocation; the next pass continues if
        // the batch budget runs out.
        let guard = 0;
        let result = await deliverBatch(ctx, version);
        while (!("error" in result && result.error) && result.remaining > 0 && guard < 20) {
          guard += 1;
          result = await deliverBatch(ctx, { ...version, started_at: version.started_at ?? new Date().toISOString() });
        }
        processed += 1;
      }
      return json(200, { processed });
    }

    const id = String(body.id ?? "");
    if (!id) return jsonError(400, "Missing id");
    const campaign = await loadCampaign(ctx, id);
    if (!campaign) return jsonError(404, "Newsletter not found");

    if (action === "cancel") {
      const existing = await openVersion(ctx, id);
      if (!existing) return jsonError(409, "Nothing to cancel.");
      if (existing.status === "sending") {
        return jsonError(409, "Sending has already started and cannot be cancelled.");
      }
      await ctx.portal
        .from("newsletter_campaign_versions")
        .update({ status: "cancelled" })
        .eq("id", existing.id);
      await ctx.portal
        .from("newsletter_campaigns")
        .update({ status: "draft", scheduled_at: null, current_version_id: null })
        .eq("id", id);
      return json(200, { cancelled: true });
    }

    if (action === "schedule") {
      const when = String(body.scheduled_at ?? "");
      if (!when || Number.isNaN(Date.parse(when))) return jsonError(400, "Invalid schedule time.");
      if (Date.parse(when) < Date.now() - 60_000) {
        return jsonError(400, "Choose a time in the future.");
      }
      const existing = await openVersion(ctx, id);
      if (existing) {
        // Reconcile instead of creating a second campaign.
        await ctx.portal
          .from("newsletter_campaign_versions")
          .update({ status: "scheduled", scheduled_at: when })
          .eq("id", existing.id);
        await ctx.portal
          .from("newsletter_campaigns")
          .update({ status: "scheduled", scheduled_at: when })
          .eq("id", id);
        return json(200, { version: { ...existing, status: "scheduled", scheduled_at: when } });
      }
      const created = await createVersion(ctx, campaign, { scheduledAt: when });
      if (!created.ok) return jsonError(created.status, created.error);
      return json(200, { version: created.version });
    }

    if (action === "send" || action === "resume") {
      if (["sent", "sending", "partially_failed"].includes(String(campaign.status)) && action === "send") {
        const existing = await openVersion(ctx, id);
        if (!existing) {
          return jsonError(409, "This newsletter has already been sent. Duplicate it to send again.");
        }
      }
      let version = await openVersion(ctx, id);
      if (!version) {
        if (action === "resume") return jsonError(409, "Nothing in progress to resume.");
        const created = await createVersion(ctx, campaign, { scheduledAt: null });
        if (!created.ok) return jsonError(created.status, created.error);
        version = created.version;
      }
      const result = await deliverBatch(ctx, version);
      if ("error" in result && result.error) return jsonError(500, result.error);
      return json(200, { version_id: version.id, ...result });
    }

    return jsonError(400, "Unknown action");
  } catch (err) {
    console.error("admin-newsletter-send failed", err);
    return jsonError(500, err instanceof Error ? err.message : "Unexpected error");
  }
});
