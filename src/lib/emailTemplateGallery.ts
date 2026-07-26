// System-admin email template gallery.
//
// The VineTrack Supabase backend is the source of truth for every email
// template. The portal never reproduces template HTML: it asks the backend
// to render a sample (token-free) preview and displays whatever HTML comes
// back. If no preview endpoint is deployed yet, the gallery says so plainly
// instead of inventing a look-alike template.
import type { DiagnosticTestName, NotificationTestExtras } from "@/lib/emailDiagnostics";

export type TemplateSource = "auth" | "application";

export interface GalleryTemplate {
  key: string;
  name: string;
  purpose: string;
  sender: string;
  subject: string;
  source: TemplateSource;
  /** Diagnostic edge function that sends a real test, when one exists. */
  test?: DiagnosticTestName;
  testExtras?: NotificationTestExtras;
  /** Recovery is exercised through the real Auth API card above. */
  testNote?: string;
}

const APP_SENDER = "VineTrack <notifications@vinetrack.com.au>";
const AUTH_SENDER = "VineTrack <no-reply@vinetrack.com.au>";

export const GALLERY_TEMPLATES: GalleryTemplate[] = [
  {
    key: "recovery",
    name: "Password recovery",
    purpose: "Sent when a user requests a password reset from the portal or mobile apps.",
    sender: AUTH_SENDER,
    subject: "Reset your VineTrack password",
    source: "auth",
    testNote: "Use the Password recovery test card above — it calls the real Auth API.",
  },
  {
    key: "signup",
    name: "Signup confirmation",
    purpose: "Confirms a new VineTrack account email address.",
    sender: AUTH_SENDER,
    subject: "Confirm your VineTrack account",
    source: "auth",
  },
  {
    key: "email_change",
    name: "Email change",
    purpose: "Confirms a change of the account's sign-in email address.",
    sender: AUTH_SENDER,
    subject: "Confirm your new VineTrack email address",
    source: "auth",
  },
  {
    key: "invitation",
    name: "Vineyard invitation",
    purpose: "Invites a person to join a vineyard team with a specific role.",
    sender: APP_SENDER,
    subject: "You've been invited to a vineyard on VineTrack",
    source: "application",
    test: "test-invitation-email",
  },
  {
    key: "support_staff",
    name: "Support staff notification",
    purpose: "Internal alert to VineTrack support when a new request is opened.",
    sender: APP_SENDER,
    subject: "New VineTrack support request",
    source: "application",
    test: "test-support-staff-email",
  },
  {
    key: "support_receipt",
    name: "Support receipt",
    purpose: "Confirmation to the person who submitted a support request.",
    sender: APP_SENDER,
    subject: "We've received your VineTrack support request",
    source: "application",
    test: "test-support-receipt-email",
  },
  {
    key: "notification_information",
    name: "Information notification",
    purpose: "General informational notice with optional action link.",
    sender: APP_SENDER,
    subject: "VineTrack update",
    source: "application",
    test: "test-notification-email",
    testExtras: {
      notification_type: "information",
      title: "Information notification preview",
      summary: "This is a VineTrack information notification test.",
    },
  },
  {
    key: "notification_reminder",
    name: "Reminder notification",
    purpose: "Reminds a user about scheduled or overdue vineyard work.",
    sender: APP_SENDER,
    subject: "VineTrack reminder",
    source: "application",
    test: "test-notification-email",
    testExtras: {
      notification_type: "reminder",
      title: "Reminder notification preview",
      summary: "This is a VineTrack reminder notification test.",
    },
  },
  {
    key: "notification_warning",
    name: "Warning notification",
    purpose: "Non-critical warning, e.g. expiring licences or missing data.",
    sender: APP_SENDER,
    subject: "VineTrack warning",
    source: "application",
    test: "test-notification-email",
    testExtras: {
      notification_type: "warning",
      title: "Warning notification preview",
      summary: "This is a VineTrack warning notification test.",
    },
  },
  {
    key: "notification_critical",
    name: "Critical notification",
    purpose: "Urgent alert requiring immediate attention.",
    sender: APP_SENDER,
    subject: "Urgent: VineTrack alert",
    source: "application",
    test: "test-notification-email",
    testExtras: {
      notification_type: "critical",
      title: "Critical notification preview",
      summary: "This is a VineTrack critical notification test.",
    },
  },
];

export interface TemplatePreviewResult {
  status: "ready" | "unavailable" | "error";
  html?: string;
  subject?: string;
  source?: string;
  message?: string;
}

const PREVIEW_ENDPOINTS_BY_SOURCE: Record<TemplateSource, string[]> = {
  application: ["preview-transactional-email"],
  auth: ["preview-auth-email-template"],
};

/** Pull a sample-value preview for one template from the backend. */
export async function fetchTemplatePreview(
  template: GalleryTemplate,
): Promise<TemplatePreviewResult> {
  return {
    status: "unavailable",
    message:
      `No safe backend preview endpoint is currently available for ${template.source === "auth" ? "Auth" : "App"} templates. ` +
      `The gallery will not call missing functions such as ${PREVIEW_ENDPOINTS_BY_SOURCE[template.source]
        .map((endpoint) => `"${endpoint}"`)
        .join(" or ")} because those 404 responses trigger the runtime error overlay. ` +
      "Send-test buttons still use the real production backend templates; visual previews can be enabled once the backend exposes a deployed sample-preview endpoint.",
  };
}

export const VISUAL_CHECKLIST: string[] = [
  "Logo loads",
  "Title hierarchy is correct",
  "Body font is at least 16px",
  "CTA appears as a proper button",
  "Recovery code is readable",
  "Fallback links wrap",
  "Footer is legible",
  "Desktop width is constrained to 640px",
  "Mobile preview has no horizontal scroll",
  "Light and forced-dark modes remain readable",
];
