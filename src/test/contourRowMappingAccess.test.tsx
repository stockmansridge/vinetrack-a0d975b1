import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const loadDraft = vi.fn();
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: false, loading: false }) }));
vi.mock("@/lib/contourRows/draftApi", () => ({ loadDraft: (...a: any[]) => loadDraft(...a) }));
vi.mock("@/lib/queries", () => ({ fetchOne: vi.fn() }));
vi.mock("@/pages/NotFound", () => ({ default: () => <div>not-found</div> }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v1" }) }));

import ContourRowMappingPage from "@/pages/setup/ContourRowMappingPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

describe("Contour Row Mapping access", () => {
  it("non-admin deep link shows not found and never fetches the draft", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/setup/paddocks/p1/contour-rows"]}>
          <Routes><Route path="/setup/paddocks/:id/contour-rows" element={<ContourRowMappingPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("not-found")).toBeTruthy();
    expect(loadDraft).not.toHaveBeenCalled();
  });
});
