// Focused tests for the System Admin MAIT iNTELLiWeb API diagnostic card.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  maitProxy: vi.fn(),
  saveMaitConnection: vi.fn(),
  vineyardId: "v1" as string | null,
  isAdmin: true,
}));

vi.mock("@/lib/maitIntelliwebQuery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/maitIntelliwebQuery")>();
  return {
    ...actual,
    maitProxy: mocks.maitProxy,
    saveMaitConnection: mocks.saveMaitConnection,
  };
});
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: mocks.vineyardId }),
}));
vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: mocks.isAdmin, loading: false }),
  useIsSystemAdminRaw: () => ({ isAdmin: mocks.isAdmin, loading: false }),
  useFeatureFlags: () => ({ data: [] }),
  useFeatureFlag: () => false,
}));
vi.mock("@/lib/adminIntegrationsQuery", () => ({
  RETENTION_NOTICE: "retention",
  formatNumber: (n: unknown) => String(n ?? "—"),
  useAdminApiMetrics: () => ({ data: null }),
  useAdminIntegrations: () => ({ data: [] }),
  useAdminWebhookMetrics: () => ({ data: null }),
}));
vi.mock("@/components/admin/integrations/AdminIntegrationDirectory", () => ({
  AdminIntegrationDirectory: () => null,
}));
vi.mock("@/components/admin/integrations/AdminApiMetricsPanel", () => ({
  AdminApiMetricsPanel: () => null,
}));
vi.mock("@/components/admin/integrations/AdminApiRequestsPanel", () => ({
  AdminApiRequestsPanel: () => null,
}));
vi.mock("@/components/admin/integrations/AdminWebhooksPanel", () => ({
  AdminWebhooksTab: () => null,
}));
vi.mock("@/components/admin/integrations/AdminIntegrationAuditPanel", () => ({
  AdminIntegrationAuditPanel: () => null,
}));
vi.mock("@/components/BetaAdminBanner", () => ({ BetaAdminBanner: () => null }));

import { MaitApiDiagnosticCard } from "@/components/admin/integrations/MaitApiDiagnosticCard";
import AdminIntegrationsPage from "@/pages/admin/AdminIntegrationsPage";

const PASS_RESULT = {
  data: {
    success: true,
    network_id: "1001",
    network_name: "MAIT Trial Network",
    modules: [
      { module_id: "52", description: "Weather station" },
      { module_id: "7", description: "Irrigation controller" },
    ],
  },
  status: 200,
  partial: false,
  empty: false,
};

function mountCard() {
  return render(
    <MemoryRouter>
      <MaitApiDiagnosticCard />
    </MemoryRouter>,
  );
}

async function runAndSettle() {
  fireEvent.click(screen.getByRole("button", { name: "Run MAIT trial test" }));
  await screen.findByTestId("mait-trial-result");
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.vineyardId = "v1";
  mocks.isAdmin = true;
  mocks.maitProxy.mockResolvedValue(PASS_RESULT);
});

describe("MAIT iNTELLiWeb API diagnostic card", () => {
  it("disables the run button without a selected vineyard", () => {
    mocks.vineyardId = null;
    mountCard();
    expect(screen.getByRole("button", { name: "Run MAIT trial test" })).toBeDisabled();
    expect(
      screen.getByText("Select a vineyard to provide the authenticated test context."),
    ).toBeVisible();
    expect(mocks.maitProxy).not.toHaveBeenCalled();
  });

  it("sends the exact documented trial payload through the existing MAIT proxy helper", async () => {
    mountCard();
    await runAndSettle();
    expect(mocks.maitProxy).toHaveBeenCalledTimes(1);
    expect(mocks.maitProxy).toHaveBeenCalledWith("v1", "test", {
      username: "getdata",
      password: "trial",
      networkId: "1001",
    });
  });

  it("never calls save/configuration RPCs", async () => {
    mountCard();
    await runAndSettle();
    expect(mocks.saveMaitConnection).not.toHaveBeenCalled();
  });

  it("shows PASS with the module list and network name on a healthy response", async () => {
    mountCard();
    await runAndSettle();
    expect(screen.getByText("PASS")).toBeVisible();
    expect(screen.getByText("MAIT Trial Network")).toBeVisible();
    expect(screen.getByText("52")).toBeVisible();
    expect(screen.getByText("Weather station")).toBeVisible();
    expect(screen.getByText("Irrigation controller")).toBeVisible();
    expect(
      screen.getByText(/Documented sample module 52 detected/),
    ).toBeVisible();
  });

  it("treats HTTP 206 as PARTIAL, never a full pass", async () => {
    mocks.maitProxy.mockResolvedValue({ ...PASS_RESULT, status: 206, partial: true });
    mountCard();
    await runAndSettle();
    expect(screen.getByText("PARTIAL")).toBeVisible();
    expect(screen.getByText(/MAIT truncated the response/)).toBeVisible();
    expect(screen.queryByText("PASS")).not.toBeInTheDocument();
  });

  it("maps 401 to the MAIT authentication failure message", async () => {
    mocks.maitProxy.mockRejectedValue(
      new Error("Your session has expired. Sign in again to use MAIT."),
    );
    mountCard();
    await runAndSettle();
    expect(screen.getByText("FAIL")).toBeVisible();
    expect(
      screen.getByText(
        "MAIT authentication failed — the documented trial credentials were not accepted.",
      ),
    ).toBeVisible();
  });

  it("reports no module data for a 204 / empty response", async () => {
    mocks.maitProxy.mockResolvedValue({ data: {}, status: 204, partial: false, empty: true });
    mountCard();
    await runAndSettle();
    expect(screen.getByText("FAIL")).toBeVisible();
    expect(
      screen.getByText("MAIT accepted the request but returned no module data."),
    ).toBeVisible();
  });

  it("explains a 403 as an unauthorised account/vineyard context", async () => {
    mocks.maitProxy.mockRejectedValue(
      new Error("You do not have permission to use this MAIT action for this vineyard."),
    );
    mountCard();
    await runAndSettle();
    expect(
      screen.getByText(
        "The signed-in account or selected vineyard context is not authorised to run this diagnostic.",
      ),
    ).toBeVisible();
  });

  it("distinguishes a VineTrack proxy network failure from a MAIT upstream failure", async () => {
    mocks.maitProxy.mockRejectedValueOnce(
      new Error("MAIT could not be reached. Check your connection and retry."),
    );
    const { unmount } = mountCard();
    await runAndSettle();
    expect(screen.getByText(/VineTrack MAIT proxy could not be reached/)).toBeVisible();
    unmount();

    mocks.maitProxy.mockRejectedValueOnce(new Error("MAIT upstream exploded"));
    mountCard();
    await runAndSettle();
    expect(screen.getByText(/The VineTrack proxy or MAIT upstream failed/)).toBeVisible();
  });

  it("never renders the trial password in result or error output", async () => {
    mountCard();
    await runAndSettle();
    // The password constant must never appear as a rendered credential value.
    expect(screen.queryByText(/^trial$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();

    cleanup();
    mocks.maitProxy.mockRejectedValue(new Error("MAIT upstream exploded"));
    mountCard();
    await runAndSettle();
    expect(screen.queryByText(/^trial$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
  });
});

describe("System Admin API section placement", () => {
  it("exposes the diagnostic on the admin Integrations API tab for system admins only", async () => {
    render(
      <MemoryRouter>
        <AdminIntegrationsPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "API activity" }));
    expect(await screen.findByText("MAIT iNTELLiWeb API")).toBeVisible();
  });

  it("hides the whole admin page from non-system-admins", async () => {
    mocks.isAdmin = false;
    render(
      <MemoryRouter>
        <AdminIntegrationsPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.queryByText("MAIT iNTELLiWeb API")).not.toBeInTheDocument(),
    );
  });
});
