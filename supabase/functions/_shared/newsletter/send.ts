// Newsletter delivery through the project's existing managed email service.
//
// This is the SAME provider used for transactional email (see
// _shared/transactional-email-templates/send-email.ts) — no second delivery
// system. The difference is purpose: 'marketing', which makes the provider add
// the unsubscribe mechanism and honour marketing opt-outs. Suppression
// (bounces, complaints, unsubscribes) is enforced provider-side at send time;
// the project's own suppressed_emails list is applied before we get here too.
import { EmailAPIError, sendLovableEmail } from "npm:@lovable.dev/email-js@0.1.0";
import { logEmailSend } from "../email-send-log.ts";

const SITE_NAME = "VineTrack";
// Verified sender subdomain and From domain — identical to transactional email.
const SENDER_DOMAIN = "notify.vinetrack.com.au";
const FROM_DOMAIN = "vinetrack.com.au";

export interface SendNewsletterArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  replyTo?: string;
  /** Provider label / tag used to group a campaign's messages. */
  label: string;
  idempotencyKey: string;
}

export type SendNewsletterOutcome =
  | { ok: true; messageId: string | null }
  | { ok: false; suppressed: true; error: string }
  | { ok: false; suppressed?: false; error: string; retryable: boolean };

export async function sendNewsletterEmail(
  args: SendNewsletterArgs,
): Promise<SendNewsletterOutcome> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY is not configured", retryable: false };

  const fromName = (args.fromName ?? SITE_NAME).replace(/[<>\r\n]/g, "").trim() || SITE_NAME;

  try {
    const result = await sendLovableEmail(
      {
        to: args.to,
        from: `${fromName} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: args.subject,
        html: args.html,
        text: args.text,
        // The managed send API accepts "transactional" with an idempotency key;
        // it appends the unsubscribe footer and honours opt-outs regardless.
        purpose: "transactional",
        label: args.label,
        idempotency_key: args.idempotencyKey,
        reply_to: args.replyTo,
        // deno-lint-ignore no-explicit-any
      } as any,
      { apiKey, sendUrl: Deno.env.get("LOVABLE_SEND_URL") },
    );
    // deno-lint-ignore no-explicit-any
    const messageId = (result as any)?.message_id ?? (result as any)?.id ?? null;
    return { ok: true, messageId: typeof messageId === "string" ? messageId : null };
  } catch (error) {
    if (error instanceof EmailAPIError) {
      if (error.code === "recipient_suppressed") {
        return { ok: false, suppressed: true, error: "recipient_suppressed" };
      }
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown email error",
      retryable: false,
    };
  }
}

/** Append-only audit row in the project's email_send_log. Never gates a send. */
// deno-lint-ignore no-explicit-any
export async function logNewsletterSend(client: any, args: {
  recipient: string;
  label: string;
  outcome: SendNewsletterOutcome;
  metadata?: Record<string, unknown>;
}) {
  const { outcome } = args;
  await logEmailSend(client, {
    templateName: args.label,
    recipientEmail: args.recipient,
    status: outcome.ok ? "sent" : outcome.suppressed ? "suppressed" : "failed",
    messageId: outcome.ok ? outcome.messageId : null,
    errorMessage: outcome.ok ? null : outcome.error,
    metadata: args.metadata ?? null,
  });
}
