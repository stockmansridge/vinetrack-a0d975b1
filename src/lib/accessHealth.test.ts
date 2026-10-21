import { describe, expect, it } from "vitest";
import { accessHealthSummary, parseAccessHealth, type AccessHealth } from "./accessHealth";

function healthy(): AccessHealth {
  return {
    generated_at: "2026-10-21T10:02:00Z",
    rollout: { is_enabled: true, cohort: "all", configuration_valid: true },
    scheduler: { active: true, last_success_at: "2026-10-21T10:01:00Z", overdue: false },
    latest_scan: {
      started_at: "2026-10-21T10:00:00Z", completed_at: "2026-10-21T10:01:00Z", status: "succeeded",
      total_accounts: 120, checked_accounts: 120, stale_states_corrected: 4,
      mismatch_count: 0, unknown_client_accounts: 0, error_count: 0,
    },
    open_issue_count: 0,
  };
}

describe("access health RPC contract", () => {
  it("keeps successful full coverage and real zero counts", () => {
    const value = parseAccessHealth(healthy());
    expect(value.latest_scan?.stale_states_corrected).toBe(4);
    expect(value.latest_scan?.mismatch_count).toBe(0);
    expect(accessHealthSummary(value).tone).toBe("healthy");
  });

  it.each(["total_accounts", "checked_accounts", "stale_states_corrected", "mismatch_count", "unknown_client_accounts", "error_count"])(
    "rejects a missing %s instead of displaying zero", (key) => {
      const value = healthy();
      delete (value.latest_scan as unknown as Record<string, unknown>)[key];
      expect(() => parseAccessHealth(value)).toThrow("Access health returned an invalid");
    },
  );

  it.each([-1, 1.5, "0", null, undefined, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid counts (%s)", (value) => {
      expect(() => parseAccessHealth({ ...healthy(), open_issue_count: value })).toThrow("open issues");
    },
  );

  it("requires explicit scheduler and rollout booleans", () => {
    expect(() => parseAccessHealth({ ...healthy(), scheduler: { active: true } })).toThrow();
    expect(() => parseAccessHealth({ ...healthy(), rollout: { is_enabled: "true", cohort: "all", configuration_valid: true } })).toThrow();
  });

  it("rejects impossible coverage, unknown statuses and invalid dates", () => {
    const value = healthy();
    expect(() => parseAccessHealth({ ...value, latest_scan: { ...value.latest_scan, checked_accounts: 121 } })).toThrow("coverage");
    expect(() => parseAccessHealth({ ...value, latest_scan: { ...value.latest_scan, status: "unknown" } })).toThrow("scan status");
    expect(() => parseAccessHealth({ ...value, generated_at: "not-a-date" })).toThrow("generation time");
    expect(() => parseAccessHealth({ ...value, latest_scan: { ...value.latest_scan, completed_at: "2026-10-21T09:00:00Z" } })).toThrow("scan completion");
  });

  it("preserves the absence of a scan without inventing healthy counts", () => {
    const value = healthy();
    value.latest_scan = null;
    value.scheduler.last_success_at = null;
    expect(parseAccessHealth(value).latest_scan).toBeNull();
    expect(accessHealthSummary(value).label).toBe("Awaiting full scan");
    expect(() => parseAccessHealth({ ...value, latest_scan: undefined })).toThrow();
  });

  it("ignores extra server fields and never includes their payload in errors", () => {
    const payload = { ...healthy(), private_details: "private@example.test" };
    expect(parseAccessHealth(payload)).not.toHaveProperty("private_details");
    expect(() => parseAccessHealth({ ...payload, rollout: "private@example.test" })).toThrow("invalid rollout");
    try { parseAccessHealth({ ...payload, rollout: "private@example.test" }); }
    catch (error) { expect(String(error)).not.toContain("private@example.test"); }
  });
});

describe("access health presentation", () => {
  it.each(["running", "partial", "failed"] as const)("never labels a %s scan healthy", (status) => {
    const value = healthy();
    value.latest_scan!.status = status;
    expect(accessHealthSummary(value).tone).not.toBe("healthy");
  });

  it("requires completed full coverage even if a scan reports success", () => {
    const value = healthy();
    value.latest_scan!.checked_accounts = 119;
    expect(accessHealthSummary(value).label).toBe("Scan incomplete");
    value.latest_scan!.checked_accounts = 120;
    value.latest_scan!.completed_at = null;
    expect(accessHealthSummary(value).label).toBe("Scan incomplete");
  });

  it("shows intentional rollout and automation pauses", () => {
    const value = healthy();
    value.rollout.is_enabled = false;
    expect(accessHealthSummary(value).label).toBe("Rollout paused");
    value.rollout.is_enabled = true;
    value.scheduler.active = false;
    expect(accessHealthSummary(value).label).toBe("Automation paused");
  });

  it("requires valid full rollout and a current successful schedule", () => {
    const value = healthy();
    value.rollout.configuration_valid = false;
    expect(accessHealthSummary(value).label).toBe("Configuration issue");
    value.rollout.configuration_valid = true;
    value.rollout.cohort = "allowlist";
    expect(accessHealthSummary(value).label).toBe("Limited rollout");
    value.rollout.cohort = "all";
    value.scheduler.overdue = true;
    expect(accessHealthSummary(value).label).toBe("Scan overdue");
    value.scheduler.overdue = false;
    value.scheduler.last_success_at = null;
    expect(accessHealthSummary(value).label).toBe("Awaiting full scan");
  });

  it("keeps missing mobile telemetry separate from otherwise healthy automation", () => {
    const value = healthy();
    value.latest_scan!.unknown_client_accounts = 12;
    const summary = accessHealthSummary(value);
    expect(summary.label).toBe("Automation healthy");
    expect(summary.tone).toBe("healthy");
    expect(summary.description).toContain("no access mismatches");
    expect(summary.description).not.toMatch(/blocked|denied/);
  });

  it("escalates actual mismatches, open issues and scan errors", () => {
    const value = healthy();
    value.latest_scan!.mismatch_count = 1;
    expect(accessHealthSummary(value).label).toBe("Needs attention");
    value.latest_scan!.mismatch_count = 0;
    value.open_issue_count = 1;
    expect(accessHealthSummary(value).label).toBe("Needs attention");
    value.latest_scan!.error_count = 1;
    expect(accessHealthSummary(value).tone).toBe("critical");
  });
});
