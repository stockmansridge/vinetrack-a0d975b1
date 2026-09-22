import { describe, expect, it } from "vitest";
import { isEditableStatus, statusLabel } from "@/lib/newsletterAdmin";

// Mirrors the server-side rules in supabase/functions/admin-newsletters (save:
// EDITABLE_STATUSES) and admin-newsletter-send (open-version reconciliation).
// The UI is only a convenience; the Edge Functions enforce the same rules after
// verifying system-admin status.
describe("newsletter campaign state rules", () => {
  it("sent history cannot be edited — duplicate to change it", () => {
    expect(isEditableStatus("draft")).toBe(true);
    expect(isEditableStatus("scheduled")).toBe(true);
    expect(isEditableStatus("failed")).toBe(true);
    expect(isEditableStatus("sending")).toBe(false);
    expect(isEditableStatus("sent")).toBe(false);
    expect(isEditableStatus("partially_failed")).toBe(false);
  });

  it("shows the send lifecycle states", () => {
    expect(statusLabel("preparing")).toBe("Preparing");
    expect(statusLabel("scheduled")).toBe("Scheduled");
    expect(statusLabel("sending")).toBe("Sending");
    expect(statusLabel("sent")).toBe("Sent");
    expect(statusLabel("partially_failed")).toBe("Partially failed");
    expect(statusLabel("failed")).toBe("Failed");
  });
});
