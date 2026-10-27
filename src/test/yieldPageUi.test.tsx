// Targeted UI checks for the Yields page: Overview quick view, Vintage
// terminology + default, block/variety context, tab styling and role gating.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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

// Current trip tonnes use the master bunch weight (no payload/0.15 kg fallback).
vi.mock("@/lib/yieldBunchWeights", async () => {
  const actual = await vi.importActual<any>("@/lib/yieldBunchWeights");
  return {
    ...actual,
    useYieldBunchWeights: () => ({
      data: [
        { id: "bw1", vineyard_id: "v1", paddock_id: null, variety_key: "shiraz", variety_name: "Shiraz", bunch_weight_grams: 200, updated_at: null },
      ],
      isLoading: false,
      error: null,
    }),
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

function renderPage(initialEntries: string[] = ["/yield"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <YieldReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const openEstimations = async () => {
  const tab = await screen.findByRole("tab", { name: /Yield Estimate Trips/ });
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

  it("shows Overview cards with block, variety and the estimate as comparison", async () => {
    renderPage();
    // 1000 vines x 25 bunches/vine x 0.2 kg = 5 t estimated for the sole variety.
    await waitFor(() => expect(screen.getByText("Block A")).toBeInTheDocument());
    expect(screen.getByText("Shiraz")).toBeInTheDocument();
    // Actual supersedes the estimate, which stays as secondary comparison text.
    expect(screen.getAllByText(/Estimate 5 t/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Estimated: —/)).toBeNull();
  });

  it("leads with actual tonnes on the Overview where recorded", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("4 t").length).toBeGreaterThan(0));
    expect(screen.getAllByText("ACTUAL").length).toBeGreaterThan(0);
  });


  it("marks the active tab and renders inactive tabs distinctly", async () => {
    renderPage();
    const overview = await screen.findByRole("tab", { name: "Overview" });
    const estimations = screen.getByRole("tab", { name: /Yield Estimate Trips/ });
    expect(overview.getAttribute("data-state")).toBe("active");
    expect(estimations.getAttribute("data-state")).toBe("inactive");
    expect(overview.className).toContain("data-[state=active]:bg-primary");
  });

  it("shows estimated tonnes and block detail in the Yield Estimate Trips history", async () => {
    renderPage();
    await openEstimations();
    const row = await screen.findByTestId("trip-row-s1");
    expect(row.textContent).toContain("5");
    expect(screen.getAllByText("CURRENT ESTIMATE").length).toBeGreaterThan(0);
    fireEvent.click(row);
    await waitFor(() => expect(screen.getAllByText(/Block A/).length).toBeGreaterThan(0));
  });

  it("shows the delete action to owners and managers", async () => {
    renderPage();
    await openEstimations();
    fireEvent.click(await screen.findByTestId("trip-row-s1"));
    fireEvent.click(await screen.findByRole("button", { name: /^view full trip detail$/i }));
    expect(await screen.findByRole("button", { name: /delete session/i })).toBeInTheDocument();
  });

  it("hides the delete action from members who cannot manage yields", async () => {
    role = "member";
    renderPage();
    await openEstimations();
    fireEvent.click(await screen.findByTestId("trip-row-s1"));
    fireEvent.click(await screen.findByRole("button", { name: /^view full trip detail$/i }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});

describe("Yields page deep links", () => {
  it("opens the Grape Allocation tab when the link carries ?tab=allocation", async () => {
    renderPage(["/yield?tab=allocation"]);
    const allocation = await screen.findByRole("tab", {
      name: "Grape Allocation",
    });
    expect(allocation.getAttribute("data-state")).toBe("active");
    expect(
      screen.getByRole("tab", { name: "Overview" }).getAttribute("data-state"),
    ).toBe("inactive");
  });

  it("still opens Overview when no tab is requested", async () => {
    renderPage();
    const overview = await screen.findByRole("tab", { name: "Overview" });
    expect(overview.getAttribute("data-state")).toBe("active");
  });

  it("ignores an unknown tab value and opens Overview", async () => {
    renderPage(["/yield?tab=bogus"]);
    const overview = await screen.findByRole("tab", { name: "Overview" });
    expect(overview.getAttribute("data-state")).toBe("active");
  });
});
