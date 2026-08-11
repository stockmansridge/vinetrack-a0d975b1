// Smoke + behaviour checks for the Yield Analytics dashboard.
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import YieldAnalyticsPage from "@/pages/reports/YieldAnalyticsPage";

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? RO;

const BLOCK = "11111111-1111-1111-1111-111111111111";

vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: "v1", currentRole: "owner" }),
}));
vi.mock("@/lib/permissions", () => ({ useCanSeeCosts: () => true }));
vi.mock("@/lib/pruningActivityQuery", () => ({ usePruningActivity: () => ({ data: [] }) }));
vi.mock("@/lib/tripCostAllocationsQuery", () => ({
  fetchTripCostAllocationsForVineyard: vi.fn(async () => []),
}));

vi.mock("@/lib/yieldReportsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/yieldReportsQuery");
  return {
    ...actual,
    fetchYieldBlocks: vi.fn(async () => [
      { id: BLOCK, name: "Block A", areaHa: 10, vineCount: 100, varietyAllocations: null },
    ]),
    fetchYieldReportsForVineyard: vi.fn(async () => ({
      sessions: [],
      historical: [
        {
          id: "h1",
          vineyard_id: "v1",
          year: 2025,
          season: "2025",
          total_yield_tonnes: 40,
          total_area_hectares: 10,
          block_results: [
            {
              paddockId: BLOCK,
              blockName: "Block A",
              variety: "Shiraz",
              areaHectares: 10,
              actualYieldTonnes: 40,
            },
          ],
        },
      ],
      source: "vineyard_id",
    })),
  };
});

vi.mock("@/lib/pickingRecordsQuery", async () => {
  const actual = await vi.importActual<any>("@/lib/pickingRecordsQuery");
  return {
    ...actual,
    fetchPickingYieldTotals: vi.fn(async () => [
      {
        vineyard_id: "v1",
        vintage: 2026,
        paddock_id: BLOCK,
        paddock_name: "Block A",
        variety_name: "Shiraz",
        pick_count: 2,
        total_weight_kg: 50000,
        actual_yield_tonnes: 50,
        total_grape_value: 100000,
        first_picked_at: null,
        last_picked_at: null,
      },
    ]),
  };
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HelmetProvider>
        <MemoryRouter>
          <YieldAnalyticsPage />
        </MemoryRouter>
      </HelmetProvider>
    </QueryClientProvider>,
  );
};

describe("Yield Analytics page", () => {
  it("renders the dashboard with filters and KPI cards", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /Yield Analytics/i })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Total yield/i)).toBeTruthy());
    expect(screen.getByText(/Reset filters/i)).toBeTruthy();
    expect(screen.getAllByText(/Average price \/ tonne/i).length).toBeGreaterThan(0);
  });

  it("defaults to the latest vintage and shows its detailed picking totals", async () => {
    renderPage();
    // 2026 detailed pick = 50 t (2025 basic record is outside the vintage).
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/50(\.0+)?\s*t\b/),
    );
    // The 2025 basic record is outside the default vintage.
    expect(document.body.textContent).not.toMatch(/40(\.0+)?\s*t\b/);
  });
});
