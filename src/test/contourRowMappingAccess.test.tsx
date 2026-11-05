import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const loadDraft = vi.fn();
const fetchOne = vi.fn();
let user: string | null = 'u1', vineyard = 'v1', role = 'operator', member = true, loading = false;
vi.mock("@/lib/contourRows/draftApi", async original => ({ ...await original<any>(), loadDraft: (...a: any[]) => loadDraft(...a) }));
vi.mock("@/lib/queries", () => ({ fetchOne: (...a: any[]) => fetchOne(...a) }));
vi.mock("@/pages/NotFound", () => ({ default: () => <div>not-found</div> }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: vineyard, loading, memberships: member ? [{ vineyard_id: vineyard, role }] : [], currentRole: role }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: user ? { id: user } : null, loading: false }) }));
vi.mock('@/components/paddocks/ContourAppleMap', () => ({ default: () => <div>map</div> }));

import ContourRowMappingPage from "@/pages/setup/ContourRowMappingPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleRoute } from '@/components/PermissionGate';

describe("Contour Row Mapping access", () => {
  beforeEach(() => {
    user = 'u1'; vineyard = 'v1'; role = 'operator'; member = true; loading = false;
    fetchOne.mockReset().mockResolvedValue({ id: 'p1', vineyard_id: 'v1', rows: [], polygon_points: [] });
    loadDraft.mockReset().mockResolvedValue({ status: 'empty', revision: 0 });
  });
  const mount = (qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => {
    const ui = () => <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/setup/paddocks/p1/contour-rows"]}>
          <Routes><Route element={<RoleRoute />}><Route path="/setup/paddocks/:id/contour-rows" element={<ContourRowMappingPage />} /></Route></Routes>
        </MemoryRouter>
      </QueryClientProvider>;
    const utils = render(ui());
    return { ...utils, refresh: () => utils.rerender(ui()), qc };
  };
  it.each(['operator', 'supervisor', 'manager', 'owner'])('%s can open an existing block draft', async r => {
    role = r; mount();
    expect(await screen.findByText('Add row group')).toBeTruthy();
    expect(loadDraft).toHaveBeenCalledWith({ vineyardId: 'v1', paddockId: 'p1' });
  });
  it.each(['anonymous', 'non-member'])('%s cannot fetch a draft', reason => {
    if (reason === 'anonymous') user = null; else member = false;
    mount();
    expect(screen.getByText("not-found")).toBeTruthy();
    expect(fetchOne).not.toHaveBeenCalled();
    expect(loadDraft).not.toHaveBeenCalled();
  });
  it.each([{ vineyard_id: 'v2' }, { deleted_at: '2026-11-05' }, { id: 'other' }])('rejects unavailable block %j', async patch => {
    fetchOne.mockResolvedValue({ id: 'p1', vineyard_id: 'v1', ...patch }); mount();
    expect(await screen.findByText('Block not available')).toBeTruthy();
    expect(loadDraft).not.toHaveBeenCalled();
  });
  it('does not reveal cached editor after membership removal', async () => {
    const u = mount(); await screen.findByText('Add row group'); member = false; u.refresh();
    expect(screen.getByText('not-found')).toBeTruthy(); expect(screen.queryByText('Add row group')).toBeNull();
  });
  it('refetches in separate account/vineyard cache scopes', async () => {
    const u = mount(); await screen.findByText('Add row group');
    user = 'u2'; u.refresh(); await waitFor(() => expect(loadDraft).toHaveBeenCalledTimes(2));
    vineyard = 'v2'; fetchOne.mockResolvedValue({ id: 'p1', vineyard_id: 'v2', rows: [], polygon_points: [] }); u.refresh();
    await waitFor(() => expect(loadDraft).toHaveBeenCalledWith({ vineyardId: 'v2', paddockId: 'p1' }));
    expect(u.qc.getQueryData(['contour-draft', 'u2', 'v2', 'p1'])).toEqual({ status: 'empty', revision: 0 });
  });
});
