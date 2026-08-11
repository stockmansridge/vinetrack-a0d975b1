// Targeted UI checks for the Yields page: the delete action is role-aware and
// estimation rows show tonnes/area from the shared session parser.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import YieldReportsPage from "@/pages/setup/YieldReportsPage";

const BLOCK = "11111111-1111-1111-1111-111111111111";

let role = "owner";
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: "v1", currentRole: role }),
}));

vi.mock("@/lib/yieldReportsQuery", () => ({
  fetchYieldReportsForVineyard: vi.fn(async () => ({
    sessions: [
      {
        id: "s1",
        vineyard_id: "v1",
        is_completed: true,
        created_at: "2026-01-05T00:00:00Z",
        updated_at: "2026-01-05T00:00:00Z",
        session_created_at: "2026-01-05T00:00:00Z",
        completed_at: "2026-01-05T00:00:00Z",
        payload: {
          selectedPaddockIds: [BLOCK],
          blockBunchWeightsKg: { [BLOCK]: 0.2 },
          sampleSites: [
            { paddockId: BLOCK, siteIndex: 1, bunchCountEntry: { bunchesPerVine: 20 } },
            { paddockId: BLOCK, siteIndex: 2, bunchCountEntry: { bunchesPerVine: 30 } },
          ],
        },
      },
    ],
    historical: [],
    sessionCount: 1,
    historicalCount: 0,
    source: "test",
  })),
  fetchYieldBlocks: vi.fn(async () => [
    { id: BLOCK, name: "Block A", areaHa: 2, vineCount: 1000 },
  ]),
  softDeleteYieldEstimationSession: vi.fn(async () => undefined),
  softDeleteHistoricalYieldRecord: vi.fn(async () => undefined),
}));

vi.mock("@/components/YieldDamageAdjustmentPanel", () => ({ default: () => null }));
vi.mock("@/components/yield/RecordActualYieldDialog", () => ({ default: () => null }));
vi.mock("@/lib/userTablePreferencesQuery", () => ({
  useColumnOrder: (_id: string, cols: string[]) => ({
    order: cols,
    moveColumn: () => {},
    reset: () => {},
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <YieldReportsPage />
    </QueryClientProvider>,
  );
}

describe("Yields page", () => {
  beforeEach(() => {
    role = "owner";
  });

  it("shows estimated tonnes and area for estimation sessions in the table", async () => {
    renderPage();
    // 1000 vines x 25 bunches/vine x 0.2 kg = 5,000 kg = 5 t across 2 ha.
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText(/2(\.00)?\s*ha/i)).toBeInTheDocument();
  });

  it("shows the delete action to owners and managers", async () => {
    renderPage();
    const row = await screen.findByText("Estimation");
    fireEvent.click(row);
    expect(await screen.findByRole("button", { name: /delete session/i })).toBeInTheDocument();
  });

  it("hides the delete action from members who cannot manage yields", async () => {
    role = "member";
    renderPage();
    const row = await screen.findByText("Estimation");
    fireEvent.click(row);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
