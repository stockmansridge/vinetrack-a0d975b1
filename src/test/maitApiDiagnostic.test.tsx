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
import {
  maitHttpResult,
  MAIT_AUTH_FAILED_MESSAGE,
  MAIT_NO_DATA_MESSAGE,
  MAIT_BAD_REQUEST_MESSAGE,
} from "@/lib/maitIntelliwebQuery";

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

  it("maps a MAIT upstream 401 to the authentication failure message (auth accepted = No)", async () => {
    mocks.maitProxy.mockRejectedValue(new Error(MAIT_AUTH_FAILED_MESSAGE));
    mountCard();
    await runAndSettle();
    expect(screen.getByText("FAIL")).toBeVisible();
    expect(
      screen.getByText(
        "MAIT authentication failed — the documented trial credentials were not accepted.",
      ),
    ).toBeVisible();
    const authRow = screen.getByText("MAIT authentication accepted").closest("div")!;
    expect(authRow.textContent).toContain("No");
  });

  it("maps a VineTrack session-expired 401 separately (auth accepted = Unknown)", async () => {
    mocks.maitProxy.mockRejectedValue(
      new Error("Your session has expired. Sign in again to use MAIT."),
    );
    mountCard();
    await runAndSettle();
    expect(screen.getByText("FAIL")).toBeVisible();
    expect(
      screen.getByText(
        "Your VineTrack session has expired. Sign in again before running the MAIT diagnostic.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/documented trial credentials were not accepted/),
    ).not.toBeInTheDocument();
    const authRow = screen.getByText("MAIT authentication accepted").closest("div")!;
    expect(authRow.textContent).toContain("Unknown");
  });

  it("proves the live mait_no_data 404 envelope throws the stable no-data error", () => {
    // Live proxy: MAIT upstream 204 -> action=test returns HTTP 404 mait_no_data.
    expect(() => maitHttpResult(404, { error: "mait_no_data" })).toThrow(MAIT_NO_DATA_MESSAGE);
    // And a MAIT upstream 401 / 400 stay distinct from a VineTrack session 401.
    expect(() => maitHttpResult(401, { error: "mait_authentication_failed" })).toThrow(
      MAIT_AUTH_FAILED_MESSAGE,
    );
    expect(() => maitHttpResult(400, { error: "mait_bad_request" })).toThrow(
      MAIT_BAD_REQUEST_MESSAGE,
    );
    expect(() => maitHttpResult(401, {})).toThrow(/session has expired/);
  });

  it("shows the no-module-data result for the live mait_no_data envelope", async () => {
    mocks.maitProxy.mockRejectedValue(new Error(MAIT_NO_DATA_MESSAGE));
    mountCard();
    await runAndSettle();
    expect(screen.getByText("FAIL")).toBeVisible();
    expect(
      screen.getByText("MAIT accepted the request but returned no module data."),
    ).toBeVisible();
    const authRow = screen.getByText("MAIT authentication accepted").closest("div")!;
    expect(authRow.textContent).toContain("Yes");
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

// Live trial_deep_test response contract (backend-owned trial credentials).
const DEEP_PASS_RESULT = {
  data: {
    success: true,
    diagnostic: "trial_deep_test",
    overall: "pass",
    partial: false,
    read_only: true,
    writes_performed: 0,
    network: {
      network_id: "1001",
      network_name: "MAIT Trial Network",
      modules_returned: 3,
      module_52_present: true,
    },
    module: {
      module_id: "52",
      module_name: "St Andrews Tank House",
      record_count: 120,
      latest_datetime: "2019-02-10 08:00",
      columns: [
        {
          channel_key: "c1",
          channel_number: 1,
          label: "Tank Level",
          unit: "m",
          latest_value: "1.42",
        },
        {
          channel_key: "c2",
          channel_number: 2,
          label: "Pressure",
          unit: "kPa",
          latest_value: "210",
        },
      ],
    },
    usage: {
      module_id: "52",
      start_date: "2019-02-01",
      end_date: "2019-02-10",
      outputs: [
        {
          channel_number: 1,
          channel_name: "Tank Fill Pump",
          has_duration: true,
          has_volume: true,
          duration_key: "d1",
          volume_key: "v1",
        },
      ],
      events: [
        {
          datetime_raw: "02/02/2019 21:00",
          channel_number: 1,
          channel_name: "Tank Fill Pump",
          duration_minutes: 45,
          duration_source: "d",
          volume_kl: 222.8,
          volume_litres: 222800,
          volume_source: "v",
        },
      ],
    },
    checks: [
      { key: "module_list", status: "pass", message: "Module list returned." },
      { key: "module_52", status: "pass", message: "Module 52 present." },
      { key: "duration_parser", status: "pass", message: "Duration parsed." },
      { key: "documented_sample", status: "info", message: "Sample may change." },
    ],
  },
  status: 200,
  partial: false,
  empty: false,
};

async function runDeepAndSettle() {
  fireEvent.click(screen.getByRole("button", { name: "Run full MAIT data test" }));
  await screen.findByTestId("mait-deep-result");
}

describe("Full MAIT data diagnostic (trial_deep_test)", () => {
  beforeEach(() => {
    mocks.maitProxy.mockResolvedValue(DEEP_PASS_RESULT);
  });

  it("calls maitProxy with trial_deep_test and no credentials or arguments", async () => {
    mountCard();
    await runDeepAndSettle();
    expect(mocks.maitProxy).toHaveBeenCalledTimes(1);
    expect(mocks.maitProxy).toHaveBeenCalledWith("v1", "trial_deep_test", {});
    const args = mocks.maitProxy.mock.calls[0][2] as Record<string, unknown>;
    const serialised = JSON.stringify(args).toLowerCase();
    expect(serialised).not.toContain("getdata");
    expect(serialised).not.toContain("trial");
    expect(serialised).not.toContain("password");
    expect(serialised).not.toContain("username");
  });

  it("never calls save/configuration RPCs", async () => {
    mountCard();
    await runDeepAndSettle();
    expect(mocks.saveMaitConnection).not.toHaveBeenCalled();
  });

  it("renders PASS with module columns, outputs, events and checks", async () => {
    mountCard();
    await runDeepAndSettle();
    expect(screen.getByText("Full data diagnostic")).toBeVisible();
    expect(screen.getByText("PASS")).toBeVisible();
    // Read-only / writes visibility
    const readOnlyRow = screen.getByText("Read-only").closest("div")!;
    expect(readOnlyRow.textContent).toContain("Yes");
    const writesRow = screen.getByText("Writes performed").closest("div")!;
    expect(writesRow.textContent).toContain("0");
    // Network summary
    expect(screen.getByText("MAIT Trial Network")).toBeVisible();
    // Module 52 parser section
    expect(screen.getByText("Module 52 — current data parser")).toBeVisible();
    expect(screen.getByText("St Andrews Tank House")).toBeVisible();
    expect(screen.getByText("Tank Level")).toBeVisible();
    expect(screen.getByText("1.42")).toBeVisible();
    // Usage parser section
    expect(screen.getByText("Module 52 — irrigation usage parser")).toBeVisible();
    expect(screen.getByText(/2019-02-01/)).toBeVisible();
    expect(screen.getAllByText("Tank Fill Pump").length).toBeGreaterThan(0);
    expect(screen.getByText("02/02/2019 21:00")).toBeVisible();
    expect(screen.getByText("222.8")).toBeVisible();
    // Parser checks
    expect(screen.getByText("Parser checks")).toBeVisible();
    expect(screen.getByText(/duration_parser/)).toBeVisible();
    expect(screen.getByText(/documented_sample/)).toBeVisible();
  });

  it("renders detailed checks even when backend overall is fail with HTTP 200", async () => {
    mocks.maitProxy.mockResolvedValue({
      ...DEEP_PASS_RESULT,
      data: {
        ...DEEP_PASS_RESULT.data,
        overall: "fail",
        checks: [
          { key: "module_list", status: "pass", message: "Module list returned." },
          { key: "volume_parser", status: "fail", message: "No volume columns found." },
        ],
      },
    });
    mountCard();
    await runDeepAndSettle();
    expect(screen.getByText("FAIL")).toBeVisible();
    // Detailed sections/checks are preserved, not thrown away.
    expect(screen.getByText("Parser checks")).toBeVisible();
    expect(screen.getByText(/volume_parser/)).toBeVisible();
    expect(screen.getByText(/No volume columns found/)).toBeVisible();
    expect(screen.getByText("St Andrews Tank House")).toBeVisible();
  });

  it("renders PARTIAL prominently for HTTP 206 truncated data", async () => {
    mocks.maitProxy.mockResolvedValue({ ...DEEP_PASS_RESULT, status: 206, partial: true });
    mountCard();
    await runDeepAndSettle();
    expect(screen.getByText("PARTIAL")).toBeVisible();
    expect(screen.getByText(/truncated the response \(HTTP 206\)/)).toBeVisible();
    expect(screen.queryByText("PASS")).not.toBeInTheDocument();
  });

  it("reuses the typed error handling for permission failures", async () => {
    mocks.maitProxy.mockRejectedValue(
      new Error("You do not have permission to use this MAIT action for this vineyard."),
    );
    mountCard();
    await runDeepAndSettle();
    expect(screen.getByText("FAIL")).toBeVisible();
    expect(
      screen.getByText(
        "The signed-in account or selected vineyard context is not authorised to run this diagnostic.",
      ),
    ).toBeVisible();
    // Read-only guarantee still visible on error results.
    const readOnlyRow = screen.getByText("Read-only").closest("div")!;
    expect(readOnlyRow.textContent).toContain("Yes");
  });

  it("disables the deep-test button without a selected vineyard", () => {
    mocks.vineyardId = null;
    mountCard();
    expect(screen.getByRole("button", { name: "Run full MAIT data test" })).toBeDisabled();
    expect(mocks.maitProxy).not.toHaveBeenCalled();
  });
});

describe("System Admin API section placement", () => {
  it("exposes the diagnostic on the admin Integrations API tab for system admins only", async () => {
    render(
      <MemoryRouter>
        <AdminIntegrationsPage />
      </MemoryRouter>,
    );
    const tab = await screen.findByRole("tab", { name: "API activity" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
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
