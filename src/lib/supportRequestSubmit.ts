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

/** SQL 123 attachment limits. */
export const SUPPORT_ATTACHMENT_BUCKET = "support-attachments";
export const SUPPORT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const SUPPORT_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Upload attachments straight into the VineTrack private bucket using the
 * authenticated VineTrack client. Canonical path:
 *   {user_id}/{request_id}/attachment-N.{ext}
 * Only canonical VineTrack storage paths are returned.
 */
async function uploadAttachments(
  input: SupportSubmitInput,
  requestId: string,
  userId: string,
): Promise<{ paths: string[]; ok: boolean }> {
  if (!input.attachments.length) return { paths: [], ok: true };
  const paths: string[] = [];
  try {
    let n = 0;
    for (const att of input.attachments) {
      const mime = att.mime;
      if (!(SUPPORT_ALLOWED_MIME as readonly string[]).includes(mime)) {
        throw new Error("unsupported attachment type");
      }
      const blob = base64ToBlob(att.base64, mime);
      if (blob.size > SUPPORT_MAX_ATTACHMENT_BYTES) {
        throw new Error("attachment too large");
      }
      n += 1;
      const path = `${userId}/${requestId}/attachment-${n}.${EXT_BY_MIME[mime]}`;
      const { error } = await vinetrack.storage
        .from(SUPPORT_ATTACHMENT_BUCKET)
        .upload(path, blob, { contentType: mime, upsert: true });
      if (error) throw error;
      paths.push(path);
    }
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
