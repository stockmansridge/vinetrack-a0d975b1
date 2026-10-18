import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { operationalLayoutFor } from "@/lib/rowLayoutMode";

let admin = true;
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: admin, loading: false }) }));
const loadDraft = vi.fn(async () => ({ status: "loaded", draft: { draftId: "d", revision: 4, payload: {} } }));
vi.mock("@/lib/contourRows/draftApi", async (o) => ({ ...(await o<any>()), loadDraft: (...a: any[]) => (loadDraft as any)(...a) }));
import { RowLayoutStatus } from "@/pages/setup/PaddockDetailPage";

const paddock = { id: "p", vineyard_id: "v", rows: [{ id: "r", number: 1, startPoint: { latitude: 1, longitude: 1 }, endPoint: { latitude: 1, longitude: 2 } }] };
const mount = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><RowLayoutStatus paddock={paddock} /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { cleanup(); loadDraft.mockClear(); });

describe("operational row layout", () => {
  it("is straight from block data only", () => {
    expect(operationalLayoutFor(paddock)).toEqual({ layout: "straight", rowCount: 1 });
    expect(operationalLayoutFor({ rows: [] }).layout).toBe("straight");
  });
  it("stays Straight even when a contour draft is saved (admin)", async () => {
    admin = true; mount();
    expect(await screen.findByText("Saved · revision 4 (not active)")).toBeTruthy();
    expect(screen.getByText("Straight (active)")).toBeTruthy();
  });
  it("non-admins see only the operational layout; no draft read", () => {
    admin = false; mount();
    expect(screen.getByText("Straight (active)")).toBeTruthy();
    expect(screen.queryByText(/Contour draft/)).toBeNull();
    expect(loadDraft).not.toHaveBeenCalled();
  });
});
