import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

type TemplateSource = 'auth' | 'application'

interface PreviewRequest {
  source?: TemplateSource
  templateName?: string
  expectedEndpoints?: string[]
}

interface PreviewResponse {
  status: 'ready' | 'unavailable' | 'error'
  html?: string
  subject?: string
  source?: string
  message?: string
}

const DEFAULT_ENDPOINTS: Record<TemplateSource, string[]> = {
  application: ['preview-transactional-email', 'preview-email-template'],
  auth: ['preview-auth-email-template', 'preview-email-template'],
}

function jsonResponse(body: PreviewResponse, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function templateCandidates(templateName: string) {
  const kebab = templateName.replace(/_/g, '-')
  const snake = templateName.replace(/-/g, '_')
  const aliases: Record<string, string[]> = {
    support_staff: ['support-staff', 'support_staff', 'supportStaff'],
    support_receipt: ['support-receipt', 'support_receipt', 'supportReceipt'],
    notification_information: ['notification-information', 'notification', 'information'],
    notification_reminder: ['notification-reminder', 'reminder'],
    notification_warning: ['notification-warning', 'warning'],
    notification_critical: ['notification-critical', 'critical'],
  }
  return [templateName, kebab, snake, ...(aliases[templateName] ?? [])].map(normalise)
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function extractPreview(payload: unknown, templateName: string, source: string): PreviewResponse | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const directHtml = readString(record, ['html', 'previewHtml', 'bodyHtml'])
  if (directHtml) {
    return {
      status: 'ready',
      html: directHtml,
      subject: readString(record, ['subject']),
      source,
    }
  }

  const templates = Array.isArray(record.templates)
    ? record.templates
    : Array.isArray(record.data)
      ? record.data
      : []
  const candidates = templateCandidates(templateName)
  const match = templates.find((item) => {
    if (!item || typeof item !== 'object') return false
    const itemRecord = item as Record<string, unknown>
    const names = [
      readString(itemRecord, ['templateName', 'template_name', 'key', 'name', 'displayName']),
    ].filter((value): value is string => Boolean(value))
    return names.some((name) => candidates.includes(normalise(name)))
  })

  if (!match || typeof match !== 'object') return null
  const matchRecord = match as Record<string, unknown>
  const html = readString(matchRecord, ['html', 'previewHtml', 'bodyHtml'])
  if (!html) return null
  return {
    status: 'ready',
    html,
    subject: readString(matchRecord, ['subject']),
    source,
  }
}

// The VineTrack backend project is the only source of truth for template HTML.
// These are publishable values (project URL + anon key), never secrets.
const VINETRACK_URL = 'https://tbafuqwruefgkbyxrxyb.supabase.co'
const VINETRACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw'

async function fetchFromVineTrack(endpoint: string, templateName: string): Promise<PreviewResponse> {
  const baseUrl = Deno.env.get('VINETRACK_SUPABASE_URL') ?? VINETRACK_URL
  const anonKey = Deno.env.get('VINETRACK_ANON_KEY') ?? VINETRACK_ANON_KEY



  const url = new URL(`${baseUrl.replace(/\/$/, '')}/functions/v1/${endpoint}`)
  url.searchParams.set('template', templateName)
  url.searchParams.set('sample', '1')

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  }

  const attempts = [
    () => fetch(url, { method: 'POST', headers, body: JSON.stringify({ template: templateName, templateName, sample: true }) }),
    () => fetch(url, { method: 'GET', headers }),
  ]

  for (const attempt of attempts) {
    const response = await attempt()
    const text = await response.text()
    if (response.status === 404) {
      return {
        status: 'unavailable',
        message: `The production backend preview endpoint "${endpoint}" is not deployed yet. The browser request was safely handled by this proxy, so no runtime 404 overlay is triggered.`,
      }
    }
    if (!response.ok) {
      if (response.status === 405) continue
      return {
        status: 'error',
        message: `The production backend preview endpoint "${endpoint}" returned HTTP ${response.status}.`,
      }
    }

    try {
      const payload = text ? JSON.parse(text) : null
      const extracted = extractPreview(payload, templateName, endpoint)
      if (extracted) return extracted
      return {
        status: 'unavailable',
        source: endpoint,
        message: `The production backend preview endpoint "${endpoint}" responded, but it did not include preview HTML for "${templateName}".`,
      }
    } catch {
      return {
        status: 'error',
        message: `The production backend preview endpoint "${endpoint}" returned a non-JSON response.`,
      }
    }
  }

  return {
    status: 'unavailable',
    message: `The production backend preview endpoint "${endpoint}" did not accept the supported preview methods.`,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return jsonResponse({
      status: 'unavailable',
      message: 'Use POST with a template name to request a safe production preview.',
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405)
  }

  let body: PreviewRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON request body.' }, 400)
  }

  const source: TemplateSource = body.source === 'auth' ? 'auth' : 'application'
  const templateName = typeof body.templateName === 'string' ? body.templateName.trim() : ''
  if (!templateName) {
    return jsonResponse({ status: 'error', message: 'templateName is required.' }, 400)
  }

  const endpoints = Array.from(
    new Set([...(body.expectedEndpoints ?? []), ...DEFAULT_ENDPOINTS[source]])
  ).filter((endpoint) => typeof endpoint === 'string' && endpoint.trim())

  const unavailableMessages: string[] = []
  for (const endpoint of endpoints) {
    try {
      const result = await fetchFromVineTrack(endpoint, templateName)
      if (result.status === 'ready') return jsonResponse(result)
      if (result.message) unavailableMessages.push(result.message)
    } catch (error) {
      unavailableMessages.push(
        `The production backend preview endpoint "${endpoint}" could not be reached.`
      )
    }
  }

  return jsonResponse({
    status: 'unavailable',
    message:
      unavailableMessages[0] ??
      'No production backend preview endpoint returned sample HTML for this template.',
  })
})
