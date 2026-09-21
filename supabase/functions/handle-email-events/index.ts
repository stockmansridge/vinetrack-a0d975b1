import { createEmailWebhookHandler } from 'npm:@lovable.dev/email-js@0.1.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Records terminal delivery outcomes in the project's own notification tables.
// These writes are a record only — Lovable enforces suppression at send time.
// Handlers tolerate redeliveries: both writes are idempotent per event.

function admin() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new Error('Supabase configuration missing')
  return createClient(url, serviceKey)
}

type Reason = 'bounce' | 'complaint' | 'unsubscribe'

const LOG_STATUS: Record<Reason, 'bounced' | 'complained' | 'suppressed'> = {
  bounce: 'bounced',
  complaint: 'complained',
  unsubscribe: 'suppressed',
}

const LOG_MESSAGE: Record<Reason, string> = {
  bounce: 'Permanent bounce — email address is invalid or rejected',
  complaint: 'Spam complaint — recipient marked email as spam',
  unsubscribe: 'Recipient unsubscribed',
}

// deno-lint-ignore no-explicit-any
async function record(reason: Reason, event: any) {
  const recipient = String(event?.data?.recipient ?? '').toLowerCase()
  if (!recipient) {
    console.warn('Email event without recipient', { event_id: event?.event_id })
    return
  }
  const supabase = admin()

  const suppression = await supabase
    .from('suppressed_emails')
    .upsert({ email: recipient, reason, metadata: null }, { onConflict: 'email' })
  if (suppression.error) {
    console.error('Failed to record suppression', {
      event_id: event?.event_id,
      code: suppression.error.code,
      message: suppression.error.message,
    })
    throw new Error('Failed to record suppression')
  }

  const log = await supabase.from('email_send_log').insert({
    message_id: event?.data?.message_id ?? null,
    template_name: 'system',
    recipient_email: recipient,
    status: LOG_STATUS[reason],
    error_message: LOG_MESSAGE[reason],
    metadata: null,
  })
  if (log.error) {
    console.error('Failed to record email send log entry', {
      event_id: event?.event_id,
      code: log.error.code,
      message: log.error.message,
    })
    throw new Error('Failed to record email send log entry')
  }
}

const handler = createEmailWebhookHandler({
  apiKey: Deno.env.get('LOVABLE_API_KEY')!,
  on: {
    'email.bounced': async (event) => {
      await record('bounce', event)
    },
    'email.complaint': async (event) => {
      await record('complaint', event)
    },
    'email.unsubscribed': async (event) => {
      await record('unsubscribe', event)
    },
  },
})

Deno.serve((req) => handler(req))
