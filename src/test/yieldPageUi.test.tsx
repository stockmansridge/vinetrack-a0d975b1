// Targeted UI checks for the Yields page: Overview quick view, Vintage
// terminology + default, block/variety context, tab styling and role gating.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import YieldReportsPage from "@/pages/setup/YieldReportsPage";

const BLOCK = "11111111-1111-1111-1111-111111111111";

let role = "owner";
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: "v1", currentRole: role }),
}));

vi.mock("@/lib/useVintage", () => ({
  useVintage: () => ({ vintage: 2026, seasonStartMonth: 7, seasonStartDay: 1 }),
}));
vi.mock("@/lib/varietyResolver", async () => {
  const actual = await vi.importActual<any>("@/lib/varietyResolver");
  return { ...actual, useGrapeVarieties: () => ({ data: [] }) };
});

vi.mock("@/lib/yieldReportsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/yieldReportsQuery");
  return {
    ...actual,
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
      historical: [
        {
          id: "h1",
          vineyard_id: "v1",
          year: 2026,
          season: "2025/26",
          archived_at: "2026-03-01T00:00:00Z",
          total_yield_tonnes: 4,
          total_area_hectares: 2,
          block_results: [
            {
              paddockId: BLOCK,
              paddockName: "Block A — Shiraz",
              blockName: "Block A",
              variety: "Shiraz",
              areaHectares: 2,
              yieldTonnes: 4,
              actualYieldTonnes: 4,
            },
          ],
        },
      ],
      sessionCount: 1,
      historicalCount: 1,
      source: "test",
    })),
    fetchYieldBlocks: vi.fn(async () => [
      {
        id: BLOCK,
        name: "Block A",
        areaHa: 2,
        vineCount: 1000,
        varietyAllocations: [{ variety: "Shiraz", percent: 100 }],
      },
    ]),
    softDeleteYieldEstimationSession: vi.fn(async () => undefined),
    softDeleteHistoricalYieldRecord: vi.fn(async () => undefined),
  };
});

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

const openEstimations = async () => {
  const tab = await screen.findByRole("tab", { name: /Estimations/ });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  await waitFor(() => expect(tab.getAttribute("data-state")).toBe("active"));
};

describe("Yields page", () => {
  beforeEach(() => {
    role = "owner";
  });

  it("uses Vintage terminology instead of Season / year", async () => {
    renderPage();
    await screen.findByLabelText("Vintage");
    expect(screen.queryByText(/season \/ year/i)).toBeNull();
  });

  it("defaults the Vintage filter to the current vintage", async () => {
    renderPage();
    const trigger = await screen.findByLabelText("Vintage");
    await waitFor(() => expect(trigger.textContent).toContain("2026"));
  });

  it("shows Overview cards with block, variety and estimated tonnes", async () => {
    renderPage();
    // 1000 vines x 25 bunches/vine x 0.2 kg = 5 t estimated for the sole variety.
    await waitFor(() => expect(screen.getByText("Block A")).toBeInTheDocument());
    expect(screen.getByText("Shiraz")).toBeInTheDocument();
    expect(screen.getByText(/Estimated: 5 t/)).toBeInTheDocument();
  });

  it("shows actual tonnes on the Overview where recorded", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Actual: 4 t/)).toBeInTheDocument());
  });

  it("marks the active tab and renders inactive tabs distinctly", async () => {
    renderPage();
    const overview = await screen.findByRole("tab", { name: "Overview" });
    const estimations = screen.getByRole("tab", { name: /Estimations/ });
    expect(overview.getAttribute("data-state")).toBe("active");
    expect(estimations.getAttribute("data-state")).toBe("inactive");
    expect(overview.className).toContain("data-[state=active]:bg-background");
  });

  it("shows estimated tonnes, area, block and variety in the records table", async () => {
    renderPage();
    await openEstimations();
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText(/2(\.00)?\s*ha/i)).toBeInTheDocument();
    expect(screen.getAllByText("Block A").length).toBeGreaterThan(0);
  });

  it("shows the delete action to owners and managers", async () => {
    renderPage();
    await openEstimations();
    const row = await screen.findByText("Estimation");
    fireEvent.click(row);
    expect(await screen.findByRole("button", { name: /delete session/i })).toBeInTheDocument();
  });

  it("hides the delete action from members who cannot manage yields", async () => {
    role = "member";
    renderPage();
    await openEstimations();
    const row = await screen.findByText("Estimation");
    fireEvent.click(row);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
