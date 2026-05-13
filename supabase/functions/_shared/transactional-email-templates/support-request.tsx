/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface AttachmentLink {
  name: string
  url: string
}

interface SupportRequestProps {
  request_type?: string
  subject?: string
  message?: string
  request_id?: string
  user_name?: string | null
  user_email?: string | null
  user_role?: string | null
  vineyard_name?: string | null
  vineyard_id?: string | null
  page_path?: string | null
  browser_info?: string | null
  attachments?: AttachmentLink[]
}

const labelStyle: React.CSSProperties = {
  color: '#666',
  fontSize: '12px',
  margin: '0',
  padding: '0',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const valueStyle: React.CSSProperties = {
  color: '#1a1a1a',
  fontSize: '14px',
  margin: '2px 0 12px',
  padding: '0',
}

function SupportRequestEmail(props: SupportRequestProps) {
  const {
    request_type = 'support',
    subject = '(no subject)',
    message = '',
    request_id = '',
    user_name,
    user_email,
    user_role,
    vineyard_name,
    vineyard_id,
    page_path,
    browser_info,
    attachments = [],
  } = props

  return (
    <Html>
      <Head />
      <Preview>{`[${request_type}] ${subject}`}</Preview>
      <Body
        style={{
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, Helvetica, sans-serif',
          margin: 0,
          padding: '24px',
        }}
      >
        <Container
          style={{
            maxWidth: '640px',
            margin: '0 auto',
            border: '1px solid #eaeaea',
            borderRadius: '8px',
            padding: '24px',
          }}
        >
          <Heading
            as="h2"
            style={{ margin: '0 0 4px', fontSize: '18px', color: '#1a1a1a' }}
          >
            New VineTrack support request
          </Heading>
          <Text style={{ margin: '0 0 20px', color: '#666', fontSize: '13px' }}>
            Type: <strong>{request_type}</strong>
          </Text>

          <Section>
            <Text style={labelStyle}>Subject</Text>
            <Text style={valueStyle}>{subject}</Text>

            <Text style={labelStyle}>Message</Text>
            <Text
              style={{
                ...valueStyle,
                whiteSpace: 'pre-wrap',
                background: '#f7f7f7',
                border: '1px solid #eee',
                borderRadius: '6px',
                padding: '12px',
                lineHeight: 1.5,
              }}
            >
              {message}
            </Text>
          </Section>

          <Hr style={{ borderColor: '#eaeaea', margin: '20px 0' }} />

          <Section>
            <Text style={labelStyle}>From</Text>
            <Text style={valueStyle}>
              {user_name ?? '—'} &lt;{user_email ?? 'unknown'}&gt;
              {user_role ? ` · ${user_role}` : ''}
            </Text>

            <Text style={labelStyle}>Vineyard</Text>
            <Text style={valueStyle}>
              {vineyard_name ?? '—'}
              {vineyard_id ? ` (${vineyard_id})` : ''}
            </Text>

            <Text style={labelStyle}>Page</Text>
            <Text style={valueStyle}>{page_path ?? '—'}</Text>

            <Text style={labelStyle}>Browser</Text>
            <Text style={valueStyle}>{browser_info ?? '—'}</Text>

            <Text style={labelStyle}>Request ID</Text>
            <Text style={valueStyle}>{request_id}</Text>
          </Section>

          {attachments.length > 0 && (
            <>
              <Hr style={{ borderColor: '#eaeaea', margin: '20px 0' }} />
              <Section>
                <Text style={labelStyle}>Attachments (links valid 7 days)</Text>
                {attachments.map((a, i) => (
                  <Text key={i} style={{ ...valueStyle, margin: '4px 0' }}>
                    <Link href={a.url} style={{ color: '#1a73e8' }}>
                      {a.name}
                    </Link>
                  </Text>
                ))}
              </Section>
            </>
          )}
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SupportRequestEmail,
  displayName: 'Support request notification',
  subject: (data: SupportRequestProps) =>
    `[VineTrack ${data.request_type ?? 'support'}] ${data.subject ?? '(no subject)'}`,
  // Always sent to the team inbox regardless of caller input.
  to: 'jonathan@stockmansridge.com.au',
  previewData: {
    request_type: 'bug',
    subject: 'Spray job totals look wrong',
    message:
      'When I add three paddocks the total area is double what it should be.\n\nSteps:\n1. Pick three paddocks\n2. Save\n3. See total',
    request_id: '00000000-0000-0000-0000-000000000000',
    user_name: 'Jane Grower',
    user_email: 'jane@example.com',
    user_role: 'manager',
    vineyard_name: 'Stockmans Ridge',
    vineyard_id: 'abc-123',
    page_path: '/work-tasks',
    browser_info: 'Mozilla/5.0 ...',
    attachments: [{ name: 'screenshot.png', url: 'https://example.com/sample.png' }],
  } satisfies SupportRequestProps,
} satisfies TemplateEntry
