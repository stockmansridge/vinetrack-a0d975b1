/// <reference types="npm:@types/react@18.3.1" />
import type * as React from 'npm:react@18.3.1'
import { template as supportRequest } from './support-request.tsx'

export interface TemplateEntry {
  // React Email component rendered to HTML/text
  component: React.ComponentType<any>
  // Subject line — string or function of templateData
  subject: string | ((data: any) => string)
  // Optional UI label for the previewer
  displayName?: string
  // Optional fixed recipient — overrides caller-provided recipientEmail
  to?: string
  // Optional sample props used by the previewer
  previewData?: Record<string, unknown>
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  support_request: supportRequest,
}
