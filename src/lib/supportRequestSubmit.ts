// Shared VineTrack support submission path.
//
// Flow:
//   1. Upload attachments directly to the VineTrack project's private
//      `support-attachments` bucket using the authenticated VineTrack client,
//      under the canonical path {user_id}/{request_id}/attachment-N.{ext}.
//      The request id is generated client-side so uploads finish before the
//      record is inserted. The legacy Lovable Cloud upload function is no
//      longer used by the portal.
//   2. Insert the canonical record into public.support_requests on the
//      VineTrack project (tbafuqwruefgkbyxrxyb) using the signed-in session.
//   3. Invoke the shared `support-request` Edge Function with
//      { request_id, source_platform: "portal" } to send the staff
//      notification and the submitter receipt via the shared Resend backend.
//      Signed links are generated server-side only (24h, staff email only);
//      the browser never produces signed URLs and the receipt has no links.
//
// Rules: never email when saving fails; never delete the request when an
// email fails; never surface raw Supabase/Resend errors to the user.
import { supabase as vinetrack } from "@/integrations/ios-supabase/client";


export interface SupportAttachmentInput {
  name: string;
  mime: string;
  base64: string;
}

export interface SupportSubmitInput {
  category: string;
  subject: string;
  message: string;
  vineyardId: string | null;
  vineyardName: string | null;
  userId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  userRole: string | null;
  pagePath: string | null;
  browserInfo: string | null;
  attachments: SupportAttachmentInput[];
}

export type DeliveryState = "pending" | "submitted" | "failed" | "skipped";

export interface SupportSubmitResult {
  ok: boolean;
  requestId: string | null;
  submittedAt: string | null;
  saved: boolean;
  staff: DeliveryState;
  receipt: DeliveryState;
  /** User-facing message. Never contains raw backend errors. */
  message: string;
}

const SAVE_FAILED =
  "Your support request could not be submitted. Please check the details and try again.";
const ALL_OK =
  "Your support request has been received. A confirmation email has been sent to you.";
const RECEIPT_FAILED =
  "Your support request has been received, but the confirmation email could not be sent. Our support team can still access your request.";
const STAFF_FAILED =
  "Your support request has been received. We have recorded it, but the staff notification may be delayed.";
const BOTH_FAILED =
  "Your support request has been received, but our email notifications could not be sent. Our support team can still access your request.";

function readState(value: unknown): DeliveryState {
  if (value == null) return "pending";
  if (typeof value === "boolean") return value ? "submitted" : "failed";
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (["sent", "submitted", "queued", "accepted", "ok", "success"].includes(v)) return "submitted";
    if (["skipped", "disabled", "none"].includes(v)) return "skipped";
    return "failed";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("success" in obj) return readState(obj.success);
    if ("status" in obj) return readState(obj.status);
  }
  return "pending";
}

/** Upload attachments via the legacy pathway (email suppressed). */
async function uploadAttachments(
  input: SupportSubmitInput,
): Promise<{ paths: string[]; ok: boolean }> {
  if (!input.attachments.length) return { paths: [], ok: true };
  try {
    const { data, error } = await lovableCloud.functions.invoke("submit-support-request", {
      body: {
        request_type:
          input.category === "general"
            ? "support"
            : ["bug", "feature"].includes(input.category)
              ? input.category
              : "other",
        subject: input.subject,
        message: input.message,
        page_path: input.pagePath,
        browser_info: input.browserInfo,
        vineyard_id: input.vineyardId,
        vineyard_name: input.vineyardName,
        user_id: input.userId,
        user_email: input.contactEmail,
        user_name: input.contactName,
        user_role: input.userRole,
        attachments: input.attachments,
        // Legacy email pipeline stays deployed but is never triggered.
        skip_email: true,
      },
    });
    if (error) throw error;
    const paths = (data as { attachment_paths?: string[] } | null)?.attachment_paths ?? [];
    return { paths, ok: true };
  } catch (e) {
    console.error("support attachment upload failed", e);
    return { paths: [], ok: false };
  }
}

export async function submitSupportRequest(
  input: SupportSubmitInput,
): Promise<SupportSubmitResult> {
  const base: SupportSubmitResult = {
    ok: false,
    requestId: null,
    submittedAt: null,
    saved: false,
    staff: "pending",
    receipt: "pending",
    message: SAVE_FAILED,
  };

  // 1. Attachments first — the email function must see the final record.
  const upload = await uploadAttachments(input);
  if (!upload.ok) {
    return { ...base, message: SAVE_FAILED };
  }

  // 2. Canonical record on the VineTrack project.
  const contactLines = [
    input.contactName ? `Name: ${input.contactName}` : null,
    input.contactEmail ? `Email: ${input.contactEmail}` : null,
    input.userRole ? `Role: ${input.userRole}` : null,
    input.pagePath ? `Page: ${input.pagePath}` : null,
    input.browserInfo ? `Browser: ${input.browserInfo}` : null,
  ].filter(Boolean);
  const message = contactLines.length
    ? `${input.message}\n\n---\n${contactLines.join("\n")}`
    : input.message;

  let requestId: string | null = null;
  let submittedAt: string | null = null;
  try {
    const { data, error } = await vinetrack
      .from("support_requests")
      .insert({
        user_id: input.userId,
        vineyard_id: input.vineyardId,
        vineyard_name: input.vineyardName,
        category: input.category,
        subject: input.subject,
        message,
        attachment_paths: upload.paths,
        app_version: "portal-web",
      })
      .select("id, created_at")
      .single();
    if (error) throw error;
    requestId = (data as { id: string }).id;
    submittedAt = (data as { created_at?: string }).created_at ?? new Date().toISOString();
  } catch (e) {
    console.error("support request save failed", e);
    return { ...base, message: SAVE_FAILED };
  }

  const saved: SupportSubmitResult = {
    ...base,
    ok: true,
    saved: true,
    requestId,
    submittedAt,
  };

  // 3. Shared Resend emails. Failures never roll the request back.
  try {
    const { data, error } = await vinetrack.functions.invoke("support-request", {
      body: { request_id: requestId, source_platform: "portal" },
    });
    if (error) throw error;
    const res = (data ?? {}) as Record<string, unknown>;
    const staff = readState(
      res.staff ?? res.staff_email ?? res.staff_notification ?? res.staff_result,
    );
    const receipt = readState(
      res.receipt ?? res.receipt_email ?? res.submitter_receipt ?? res.receipt_result,
    );
    const overall = res.success === false;
    const staffState: DeliveryState = staff === "pending" && !overall ? "submitted" : staff;
    const receiptState: DeliveryState = receipt === "pending" && !overall ? "submitted" : receipt;
    const staffOk = staffState === "submitted" || staffState === "skipped";
    const receiptOk = receiptState === "submitted" || receiptState === "skipped";
    return {
      ...saved,
      staff: staffState,
      receipt: receiptState,
      message: staffOk && receiptOk
        ? ALL_OK
        : !staffOk && !receiptOk
          ? BOTH_FAILED
          : receiptOk
            ? STAFF_FAILED
            : RECEIPT_FAILED,
    };
  } catch (e) {
    console.error("support-request email invoke failed", e);
    return { ...saved, staff: "failed", receipt: "failed", message: BOTH_FAILED };
  }
}
