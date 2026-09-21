/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface ReceiptProps {
  first_name?: string | null
}

function WebsiteEnquiryReceiptEmail({ first_name }: ReceiptProps) {
  const greeting = first_name?.trim() ? `Hi ${first_name.trim()},` : 'Hi,'
  return (
    <Html>
      <Head />
      <Preview>We've received your VineTrack enquiry</Preview>
      <Body style={{ backgroundColor: '#f6f6f6', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '8px', maxWidth: '520px' }}>
          <Heading style={{ fontSize: '18px', color: '#1a1a1a', margin: '0 0 12px' }}>
            Thanks for contacting VineTrack
          </Heading>
          <Text style={{ fontSize: '14px', color: '#1a1a1a', margin: '0 0 12px' }}>{greeting}</Text>
          <Text style={{ fontSize: '14px', color: '#1a1a1a', margin: '0 0 12px' }}>
            Thanks for contacting VineTrack. We've received your enquiry and will be in touch.
          </Text>
          <Text style={{ fontSize: '13px', color: '#666', margin: '16px 0 0' }}>
            The VineTrack team
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WebsiteEnquiryReceiptEmail,
  displayName: 'Website enquiry receipt',
  subject: () => 'We\u2019ve received your VineTrack enquiry',
  previewData: { first_name: 'Jane' } satisfies ReceiptProps,
} satisfies TemplateEntry
