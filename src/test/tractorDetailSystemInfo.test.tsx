// Tractor detail: internal identifiers stay hidden until "System info" is opened.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TractorDetailPage from "@/pages/setup/TractorDetailPage";

const RECORD_ID = "8a8286ae-52a5-4db3-8267-0da82fd288db";
const VINEYARD_ID = "fe952afe-437f-4be7-8cbf-fdd8e630411c";

vi.mock("@/lib/queries", () => ({
  fetchOne: vi.fn(async () => ({
    id: RECORD_ID,
    vineyard_id: VINEYARD_ID,
    name: "Kubota 7580",
    brand: "Kubota",
    model: "7580",
    model_year: 1996,
    created_at: "2026-05-05T03:00:00Z",
    updated_at: "2026-10-01T03:00:00Z",
  })),
}));

vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ selectedVineyardId: VINEYARD_ID, currentRole: "owner" }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/setup/tractors/${RECORD_ID}`]}>
        <Routes>
          <Route path="/setup/tractors/:id" element={<TractorDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("tractor detail system info", () => {
  it("hides internal identifiers by default", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Kubota 7580" })).toBeInTheDocument();
    expect(screen.queryByText("Record ID")).toBeNull();
    expect(screen.queryByText(VINEYARD_ID)).toBeNull();
    expect(screen.queryByText(RECORD_ID)).toBeNull();
  });

  it("shows record and vineyard identifiers after opening System info", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /system info/i }));
    expect(screen.getByText("Record ID")).toBeInTheDocument();
    expect(screen.getByText("Vineyard ID")).toBeInTheDocument();
    expect(screen.getByText(RECORD_ID)).toBeInTheDocument();
    expect(screen.getByText(VINEYARD_ID)).toBeInTheDocument();
    expect(screen.getByText(/safe to share with VineTrack support/i)).toBeInTheDocument();
  });

  it("hides the identifiers again when System info is closed", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", { name: /system info/i });
    fireEvent.click(toggle);
    expect(screen.getByText(RECORD_ID)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText(RECORD_ID)).toBeNull();
  });
});
