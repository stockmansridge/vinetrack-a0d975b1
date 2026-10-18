import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let admin = true;
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: admin, loading: false }) }));
const loadDraft = vi.fn(async () => ({ status: "loaded", draft: { draftId: "d", revision: 1, payload: {} } }));
vi.mock("@/lib/contourRows/draftApi", async (o) => ({ ...(await o<any>()), loadDraft: (...a: any[]) => (loadDraft as any)(...a) }));

import { ContourDraftRegenNotice } from "@/pages/setup/PaddockDetailPage";

const mount = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ContourDraftRegenNotice paddockId="p" vineyardId="v" /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { cleanup(); loadDraft.mockClear(); });

describe("straight-row regeneration notice (F4)", () => {
  it("shows for System Admins when a saved draft exists", async () => {
    admin = true; mount();
    expect(await screen.findByTestId("contour-regen-notice")).toBeTruthy();
  });
  it("hidden and no draft read for non-admins", () => {
    admin = false; mount();
    expect(screen.queryByTestId("contour-regen-notice")).toBeNull();
    expect(loadDraft).not.toHaveBeenCalled();
  });
  it("hidden when no draft is saved", async () => {
    admin = true; loadDraft.mockResolvedValueOnce({ status: "empty", revision: 2 } as any); mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("contour-regen-notice")).toBeNull();
  });
});
