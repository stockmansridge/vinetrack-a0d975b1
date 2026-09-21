// Append-only audit rows in public.email_send_log.
//
// This log is a record of what happened — it NEVER gates or decides a send.
// Allowed status values are fixed by the table's CHECK constraint; do not
// rename or add values here.
export type EmailSendLogStatus =
  | 'sent'
  | 'suppressed'
  | 'failed'
  | 'bounced'
  | 'complained';

export interface EmailSendLogEntry {
  templateName: string;
  recipientEmail: string;
  status: EmailSendLogStatus;
  messageId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

// deno-lint-ignore no-explicit-any
export async function logEmailSend(client: any, entry: EmailSendLogEntry) {
  const { error } = await client.from('email_send_log').insert({
    message_id: entry.messageId ?? null,
    template_name: entry.templateName,
    recipient_email: entry.recipientEmail,
    status: entry.status,
    error_message: entry.errorMessage ? String(entry.errorMessage).slice(0, 1000) : null,
    metadata: entry.metadata ?? null,
  });
  if (error) {
    console.error('email_send_log insert failed', {
      code: error.code,
      message: error.message,
      template: entry.templateName,
      status: entry.status,
    });
  }
}
