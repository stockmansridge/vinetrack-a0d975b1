// Soil Analysis release polish — back-navigation targets.
//
// The released landing page must return to the customer dashboard (never the
// System Admin dashboard), and the sample detail page must return to the
// released /soil-analysis route.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const SAMPLE = {
  id: "s-1",
  vineyard_id: "v1",
  vineyard_name: "Stockman's Ridge",
  sampled_at: "2025-04-10",
  received_at: null,
  reported_at: null,
  laboratory: "Test Lab",
  lab_code: null,
  order_number: null,
  lab_sample_id: "250410025",
  lab_paddock_name: "ROWS 30-69 EAST BOT",
  sample_scope: "unmapped",
  paddock_id: null,
  row_start: null,
  row_end: null,
  latitude: null,
  longitude: null,
  extraction_status: "review_required",
  extraction_confidence: null,
  notes: null,
  confirmed: false,
  verified_by: null,
  verified_at: null,
  created_at: "2025-04-10T00:00:00Z",
};

// Detail reads are replaced with a fixture; every pure helper (row selection,
// summaries, validation, error formatting) stays the real implementation.
vi.mock("@/lib/soilAnalysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/soilAnalysis")>();
  return {
    ...actual,
    getSoilSampleDetail: async () => ({
      sample: SAMPLE,
      documents: [],
      results: [],
      mappings: [],
    }),
    listAnalyteCatalogue: async () => [],
  };
});

// Any database read resolves empty through a chainable stub.
const chain: any = new Proxy(function () {}, {
  get: (_t, prop) => (prop === "then" ? (resolve: any) => resolve({ data: [], error: null }) : chain),
  apply: () => chain,
});

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => chain,
    storage: {
      from: () => ({
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed/x" }, error: null }),
      }),
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

import SoilAnalysisPage from "@/pages/admin/SoilAnalysisPage";
import SoilSampleDetailPage from "@/pages/admin/SoilSampleDetailPage";

function renderWithRouter(routePath: string, initialPath: string, element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="/dashboard" element={<div>dashboard landing</div>} />
          <Route path="/soil-analysis" element={<div>soil-analysis landing</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}


describe("Soil Analysis back navigation", () => {
  it("landing page header returns to the customer dashboard", async () => {
    const { container } = renderWithRouter("/soil-analysis", <SoilAnalysisPage />);
    const back = container.querySelector("button")!;
    fireEvent.click(back);
    expect(await screen.findByText("dashboard landing")).toBeTruthy();
    expect(screen.queryByText("admin landing")).toBeNull();
  });

  it("sample detail header returns to /soil-analysis", async () => {
    const { container } = renderWithRouter(
      "/soil-analysis/samples/s-1",
      <SoilSampleDetailPage />,
    );
    await screen.findByRole("heading", { name: "Review soil sample" });
    const back = container.querySelector("button")!;
    fireEvent.click(back);
    expect(await screen.findByText("soil-analysis landing")).toBeTruthy();
  });

  it("sample detail footer action returns to /soil-analysis", async () => {
    renderWithRouter("/soil-analysis/samples/s-1", <SoilSampleDetailPage />);
    await screen.findByRole("heading", { name: "Review soil sample" });
    fireEvent.click(screen.getByRole("button", { name: "Back to Soil Analysis" }));
    expect(await screen.findByText("soil-analysis landing")).toBeTruthy();
  });
});
