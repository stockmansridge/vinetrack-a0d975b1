import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AccessHealthPanel } from "./AccessHealthPanel";
import { useAccessHealth } from "@/lib/accessHealthQuery";
import type { AccessHealth } from "@/lib/accessHealth";

vi.mock("@/lib/accessHealthQuery", () => ({ useAccessHealth: vi.fn() }));
const query = vi.mocked(useAccessHealth);
const refetch = vi.fn();

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

function result(overrides: Record<string, unknown> = {}) {
  query.mockReturnValue({ data: healthy(), error: null, isLoading: false, isFetching: false, refetch, ...overrides } as ReturnType<typeof useAccessHealth>);
}

beforeEach(() => { vi.clearAllMocks(); result(); });

describe("AccessHealthPanel", () => {
  it("shows aggregate scan coverage, corrections, flags and a read-only refresh", () => {
    render(<AccessHealthPanel />);
    const panel = screen.getByRole("region", { name: "Access health" });
    expect(within(panel).getByText("Automation healthy")).toBeInTheDocument();
    expect(within(panel).getByText("120 of 120 accounts")).toBeInTheDocument();
    expect(within(panel).getByText("Stale states corrected").nextElementSibling).toHaveTextContent("4");
    expect(within(panel).getByText("Rollout: All users")).toBeInTheDocument();
    expect(within(panel).getByText("Schedule: Active")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh access health" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows loading instead of zero counts", () => {
    result({ data: undefined, isLoading: true, isFetching: true });
    render(<AccessHealthPanel />);
    expect(screen.getByRole("status", { name: "Loading access health" })).toBeInTheDocument();
    expect(screen.queryByText("Automation healthy")).not.toBeInTheDocument();
    expect(screen.queryByText("Access mismatches")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh access health" })).toBeDisabled();
  });

  it("hides a cached healthy result after refresh fails and keeps error payloads private", () => {
    result({ error: new Error("private@example.test: backend failure") });
    render(<AccessHealthPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("latest scan status could not be confirmed");
    expect(screen.queryByText("Automation healthy")).not.toBeInTheDocument();
    expect(screen.queryByText(/private@example/)).not.toBeInTheDocument();
  });

  it("shows a missing scan explicitly", () => {
    const data = healthy();
    data.latest_scan = null;
    data.scheduler.last_success_at = null;
    result({ data });
    render(<AccessHealthPanel />);
    expect(screen.getByText("Awaiting full scan")).toBeInTheDocument();
    expect(screen.getByText("No scan recorded")).toBeInTheDocument();
    expect(screen.getByText("Access mismatches").nextElementSibling).toHaveTextContent("—");
  });

  it("keeps unknown app versions separate from confirmed server access checks", () => {
    const data = healthy();
    data.latest_scan!.unknown_client_accounts = 9;
    result({ data });
    render(<AccessHealthPanel />);
    expect(screen.getByText("Automation healthy")).toBeInTheDocument();
    expect(screen.getByText(/Mobile coverage is unverified/)).toBeInTheDocument();
    expect(screen.getByText("No mobile version recorded").nextElementSibling).toHaveTextContent("9");
    expect(screen.queryByText(/blocked|denied/i)).not.toBeInTheDocument();
  });
});
