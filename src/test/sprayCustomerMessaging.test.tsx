// Customer-facing wording stays free of internal implementation language, and
// the technical explanation is only visible to verified system admins.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ACTUALS_SAVE_FAILED,
  ACTUALS_VERSION_CONFLICT,
  TRIP_METADATA_SAVE_FAILED,
  WEATHER_RECOVERY_UNAVAILABLE,
  isTechnicalMessage,
  toCustomerError,
} from "@/lib/sprayReportMessaging";
import { SPRAY_ACTUALS_SAVE_FAILED } from "@/lib/sprayActuals";

const adminState = { isAdmin: false, loading: false };
vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => adminState,
  useIsSystemAdminRaw: () => adminState,
}));

// Imported after the mock so the component picks it up.
import { SystemAdminDiagnostics } from "@/components/admin/SystemAdminDiagnostics";

const BANNED = [
  /rork/i,
  /lovable/i,
  /\bSQL\b/i,
  /\bRPC\b/i,
  /supabase/i,
  /contract/i,
  /migration/i,
  /_/,
];

const customerStrings = [
  ACTUALS_SAVE_FAILED.customer,
  ACTUALS_VERSION_CONFLICT.customer,
  TRIP_METADATA_SAVE_FAILED.customer,
  WEATHER_RECOVERY_UNAVAILABLE.customer,
  SPRAY_ACTUALS_SAVE_FAILED,
];

describe("customer-facing spray messages", () => {
  it("contain no internal implementation language", () => {
    for (const s of customerStrings) {
      for (const pattern of BANNED) {
        expect(pattern.test(s), `${s} matched ${pattern}`).toBe(false);
      }
    }
  });

  it("tells the customer plainly that nothing was saved", () => {
    expect(ACTUALS_SAVE_FAILED.customer).toContain("have not been saved");
    expect(ACTUALS_VERSION_CONFLICT.customer).toContain("changed by someone else");
  });


  it("recognises and replaces technical failures", () => {
    expect(isTechnicalMessage("violates row-level security policy")).toBe(true);
    const { customer, diagnostic } = toCustomerError(
      "new row violates row-level security policy for table spray_tank_actuals",
    );
    expect(customer).not.toContain("spray_tank_actuals");
    expect(diagnostic).toContain("spray_tank_actuals");
  });
});

describe("system admin diagnostics panel", () => {
  it("is hidden from non-admin users", () => {
    adminState.isAdmin = false;
    render(<SystemAdminDiagnostics details={["internal detail"]} />);
    expect(screen.queryByTestId("system-admin-diagnostics")).toBeNull();
  });

  it("is collapsed by default for admins and expands on click", () => {
    adminState.isAdmin = true;
    render(<SystemAdminDiagnostics details={["internal detail", "", null]} />);
    expect(screen.queryByText("internal detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /system admin diagnostics/i }));
    expect(screen.getByText("internal detail")).toBeTruthy();
  });

  it("renders nothing when there is no technical detail", () => {
    adminState.isAdmin = true;
    render(<SystemAdminDiagnostics details={[null, "  "]} />);
    expect(screen.queryByTestId("system-admin-diagnostics")).toBeNull();
  });
});
