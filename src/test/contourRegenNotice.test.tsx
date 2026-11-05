import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let member = true, selected = 'v', user: string | null = 'u1';
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: user ? { id: user } : null, loading: false }) }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ selectedVineyardId: selected, loading: false, memberships: member ? [{ vineyard_id: selected, role: 'operator' }] : [] }) }));
const loadDraft = vi.fn(async () => ({ status: "loaded", draft: { draftId: "d", revision: 1, payload: {} } }));
vi.mock("@/lib/contourRows/draftApi", async (o) => ({ ...(await o<any>()), loadDraft: (...a: any[]) => (loadDraft as any)(...a) }));

import { ContourDraftRegenNotice } from "@/pages/setup/PaddockDetailPage";

const mount = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ContourDraftRegenNotice paddockId="p" vineyardId="v" /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { cleanup(); loadDraft.mockClear(); member = true; selected = 'v'; user = 'u1'; });

describe("straight-row regeneration notice (F4)", () => {
  it("shows for members when a saved draft exists", async () => {
    mount();
    expect(await screen.findByTestId("contour-regen-notice")).toBeTruthy();
  });
  it.each(['non-member', 'anonymous', 'wrong vineyard'])("hidden and no draft read for %s", reason => {
    if (reason === 'non-member') member = false;
    if (reason === 'anonymous') user = null;
    if (reason === 'wrong vineyard') selected = 'other';
    mount();
    expect(screen.queryByTestId("contour-regen-notice")).toBeNull();
    expect(loadDraft).not.toHaveBeenCalled();
  });
  it("hidden when no draft is saved", async () => {
    loadDraft.mockResolvedValueOnce({ status: "empty", revision: 2 } as any); mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("contour-regen-notice")).toBeNull();
  });
});
