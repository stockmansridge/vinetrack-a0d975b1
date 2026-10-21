import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { UserAccessDrawer } from "./UserAccessDrawer";
import { useUserAccessDetail, type UserAccessDetail } from "@/lib/accessEntitlementsQuery";

vi.mock("./accessDialogs", () => ({
  AssignLicenceDialog: () => null, CreateGrantDialog: () => null, ExtendGrantDialog: () => null,
  RefreshEntitlementDialog: () => null, RemoveLicenceDialog: () => null, RevokeGrantDialog: () => null,
}));
vi.mock("@/lib/vineyardAccessQuery", () => ({
  useAdminExplainVineyardAccess: () => ({ data: null, isLoading: false, error: null }),
  vineyardAccessReasonLabel: (value: string) => value,
}));
vi.mock("@/lib/accessEntitlementsQuery", () => ({
  useUserAccessDetail: vi.fn(),
  useUserAccessHistory: () => ({ data: [], isLoading: false, error: null }),
  billingSourceLabel: (value: string) => value,
  fmtDateTime: (value: string) => value ?? "—",
  friendlyError: (value: Error) => value.message,
  grantTypeLabel: (value: string) => value,
  historyEventLabel: (value: string) => value,
  isTrialSource: (value: string) => value === "trial",
  platformsAllowed: () => "iOS, Portal",
  purchasePlatformLabel: (value: string) => value,
  resolvedReasonLabel: (value: { reason_code: string }) => value.reason_code,
}));

function detail(): UserAccessDetail {
  return {
    identity: { user_id: "test-user", full_name: "Test User", email: "user@example.test" },
    effective_access: {
      has_access: true, reason_code: "vineyard_entitlement", access_source: "vineyard",
      plan_code: "team", plan_name: "Team", vineyard_id: "test-vineyard",
      trial_end: "2026-09-01T00:00:00Z",
    },
    account_trial: {
      status: "active", is_currently_valid: false, is_persisted: true,
      trial_started_at: "2026-08-01T00:00:00Z", trial_ends_at: "2026-09-01T00:00:00Z",
      source_type: "trial", created_from: "legacy",
    },
    billing_sources: [], licences_held: [], memberships: { active: [], historical: [] },
    open_alerts: [], generated_at: "2026-10-21T10:00:00Z",
  } as UserAccessDetail;
}

function show(data: UserAccessDetail) {
  vi.mocked(useUserAccessDetail).mockReturnValue({ data, error: null, isLoading: false } as ReturnType<typeof useUserAccessDetail>);
  render(<UserAccessDrawer userId="test-user" onOpenChange={vi.fn()} />);
}

beforeEach(() => vi.clearAllMocks());

describe("effective access and original trial history", () => {
  it("keeps active vineyard access authoritative when the original trial expired", () => {
    show(detail());
    const current = within(screen.getByRole("region", { name: "Effective access" }));
    const trial = within(screen.getByRole("region", { name: "Original account trial" }));
    expect(current.getByText("Active")).toBeInTheDocument();
    expect(current.getByText("Current access is active through a vineyard entitlement.")).toBeInTheDocument();
    expect(current.getByText("Team")).toBeInTheDocument();
    expect(current.queryByText("Trial ends")).not.toBeInTheDocument();
    expect(trial.getByText("Expired")).toBeInTheDocument();
    expect(trial.getByText("Recorded status")).toBeInTheDocument();
    expect(trial.getByText(/retained as account history/)).toBeInTheDocument();
  });

  it("does not turn vineyard membership or old grant context into active access", () => {
    const data = detail();
    data.effective_access.has_access = false;
    data.memberships.active.push({ vineyard_id: "test-vineyard", vineyard_name: "Test Vineyard", role: "owner", status: "active", joined_at: null, removed_at: null });
    show(data);
    const current = within(screen.getByRole("region", { name: "Effective access" }));
    expect(current.getByText("No access")).toBeInTheDocument();
    expect(current.getByText("There is no current access entitlement.")).toBeInTheDocument();
    expect(current.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText(/Current access comes from the entitlement above/)).not.toBeInTheDocument();
  });

  it("still shows the expiry date when the current access really is a trial", () => {
    const data = detail();
    data.effective_access.access_source = "trial";
    data.effective_access.trial_end = "2026-11-21T00:00:00Z";
    data.account_trial!.is_currently_valid = true;
    data.account_trial!.trial_ends_at = "2026-11-21T00:00:00Z";
    show(data);
    const current = within(screen.getByRole("region", { name: "Effective access" }));
    expect(current.getByText("Trial ends")).toBeInTheDocument();
    expect(current.getByText("2026-11-21T00:00:00Z")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Original account trial" })).getAllByText("Active")).toHaveLength(2);
  });

  it("identifies a revoked historical trial without changing current vineyard access", () => {
    const data = detail();
    data.account_trial!.status = "revoked";
    show(data);
    expect(within(screen.getByRole("region", { name: "Original account trial" })).getAllByText("Revoked")).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "Effective access" })).getByText("Active")).toBeInTheDocument();
  });
});
