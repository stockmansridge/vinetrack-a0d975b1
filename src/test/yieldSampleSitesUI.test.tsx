import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import YieldSampleSitesPanel from '@/components/yield/YieldSampleSitesPanel';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';

const state = vi.hoisted(() => ({ role: 'supervisor', vineyard: 'v', user: 'u', demo: false,
  sets: [] as any[], sites: [] as any[], confirm: vi.fn(), save: vi.fn(), create: vi.fn(), list: vi.fn(), polygon: true }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: state.user }, loading: false }) }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ selectedVineyardId: state.vineyard, memberships: state.role ? [{ vineyard_id: state.vineyard, role: state.role }] : [], loading: false }) }));
vi.mock('@/context/DemoModeContext', () => ({ useDemoMode: () => ({ demoMode: state.demo }) }));
vi.mock('@/lib/yieldReportsQuery', () => ({ fetchYieldBlocks: async () => [{ id: 'b', name: 'North', boundary: state.polygon ? [[0, 0], [0, 2], [2, 2], [2, 0]] : [] }] }));
vi.mock('@/lib/yieldSampleSites', async () => {
  const actual = await vi.importActual<any>('@/lib/yieldSampleSites');
  return { ...actual, listYieldSiteSets: (...args: any[]) => state.list(...args), listYieldSites: async () => state.sites,
    confirmYieldSiteSet: (...args: any[]) => state.confirm(...args), saveYieldSite: (...args: any[]) => state.save(...args), createYieldDraft: (...args: any[]) => state.create(...args) };
});
vi.mock('@/components/manual-issues/ManualIssuesAppleMap', () => ({ default: ({ onPick, onSelect, markers }: any) => <div><button onClick={() => onPick?.(1, 1)}>Test map inside</button><button onClick={() => onPick?.(3, 3)}>Test map outside</button>{markers.map((m: any) => <button key={m.id} onClick={() => onSelect(m.id)}>Map {m.title}</button>)}</div> }));
// Native controls isolate the workflow from portalled selector mechanics.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => <select aria-label="Selector" value={value} disabled={disabled} onChange={e => onValueChange(e.target.value)}><option value="">Select</option>{children}</select>,
  SelectContent: ({ children }: any) => <>{children}</>, SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>, SelectTrigger: () => null, SelectValue: () => null,
}));
const draft = { id: 'd', vineyard_id: 'v', paddock_id: 'b', set_key: 'key', version: 1, name: 'Sites', status: 'draft' };
const sample = { id: 's', site_set_id: 'd', vineyard_id: 'v', paddock_id: 'b', site_id: 'physical', site_number: 1, name: 'North site', row_number: null, panel_number: null, latitude: 1, longitude: 1, notes: null };
beforeEach(() => {
  state.role = 'supervisor'; state.vineyard = 'v'; state.user = 'u'; state.demo = false; state.polygon = true;
  state.sets = [{ ...draft }]; state.sites = [{ ...sample }];
  state.list.mockReset().mockImplementation(async () => state.sets);
  state.confirm.mockReset().mockImplementation(async () => { state.sets = [{ ...draft, status: 'confirmed', confirmed_at: '2026-11-05T00:00:00Z' }]; return state.sets[0]; });
  state.save.mockReset().mockImplementation(async (_set, site) => { state.sites = [...state.sites.filter(s => s.id !== site.id), site]; return site; });
  state.create.mockReset(); readOnlyStore.setReadOnly(false);
});
function mount() { const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); const wrapper = ({ children }: any) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>; return { qc, ...render(<YieldSampleSitesPanel />, { wrapper }) }; }
async function block() { await waitFor(() => expect(screen.getByRole('option', { name: 'North' })).toBeInTheDocument()); fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'b' } }); await screen.findByRole('button', { name: 'Add site coordinates' }); await waitFor(() => expect(screen.getByRole('button', { name: 'Add site coordinates' })).toBeEnabled()); }
describe('yield sample manager', () => {
  it('saves alphanumeric row and panel references as trimmed text', async () => {
    mount(); await block(); fireEvent.click(screen.getByRole('button', { name: /^1\. North site/ }));
    fireEvent.change(screen.getByLabelText('Row (optional)'), { target: { value: ' 12A ' } });
    fireEvent.change(screen.getByLabelText('Panel (optional)'), { target: { value: ' E-4 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(state.save.mock.calls[0][1]).toMatchObject({ row_number: '12A', panel_number: 'E-4' });
  });
  it('supervisor explicitly confirms one block and refetches authoritative state', async () => {
    const { qc } = mount(); const invalidate = vi.spyOn(qc, 'invalidateQueries'); await block();
    fireEvent.click(screen.getByRole('button', { name: 'Review & confirm block' })); expect(state.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm this block' })); await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
    expect(state.confirm.mock.calls[0][1]).toBe('supervisor'); await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['yield-sample-sites', 'v', 'u', 'b'] }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add site coordinates' })).not.toBeInTheDocument());
  });
  it('operator may edit drafts but cannot confirm', async () => { state.role = 'operator'; mount(); await block(); expect(screen.queryByRole('button', { name: 'Review & confirm block' })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: /^1\. North site/ })); expect(screen.getByRole('button', { name: 'Save site' })).toBeEnabled(); });
  it('confirmed locations have no edit/delete actions', async () => { state.sets = [{ ...draft, status: 'confirmed' }]; mount(); await waitFor(() => expect(screen.getByRole('option', { name: 'North' })).toBeInTheDocument()); fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'b' } }); fireEvent.click(await screen.findByRole('button', { name: /^1\. North site/ })); expect(screen.queryByRole('button', { name: 'Save site' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Delete draft site' })).not.toBeInTheDocument(); });
  it('map placement rejects outside points and saves inside coordinates', async () => {
    mount(); await block(); fireEvent.click(screen.getByRole('button', { name: 'Place site on map' })); fireEvent.click(screen.getByRole('button', { name: 'Test map outside' })); expect(screen.getByRole('alert')).toHaveTextContent(/outside/); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test map inside' })); expect(screen.getByLabelText('Latitude')).toHaveValue(1); fireEvent.click(screen.getByRole('button', { name: 'Save site' })); await waitFor(() => expect(state.save).toHaveBeenCalledOnce()); expect(state.save.mock.calls[0][1].latitude).toBe(1); expect(state.save.mock.calls[0][1].site_id).not.toBe('physical');
  });
  it('missing geometry requires explicit block confirmation', async () => { state.polygon = false; mount(); await block(); expect(screen.getByRole('button', { name: 'Review & confirm block' })).toBeDisabled(); fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByRole('button', { name: 'Review & confirm block' })).toBeEnabled(); });
  it('save errors preserve form without false success', async () => { state.save.mockRejectedValue(new Error('Server rejected site')); mount(); await block(); fireEvent.click(screen.getByRole('button', { name: /^1\. North site/ })); fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Changed name' } }); fireEvent.click(screen.getByRole('button', { name: 'Save site' })); expect(await screen.findByRole('alert')).toHaveTextContent('Server rejected site'); expect(screen.getByLabelText('Name')).toHaveValue('Changed name'); });
  it('demo mode and missing membership never read site sets', () => { state.demo = true; const result = mount(); expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); expect(state.list).not.toHaveBeenCalled(); state.demo = false; state.role = ''; result.rerender(<YieldSampleSitesPanel />); expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); });
  it('account/vineyard changes reset selected block and close editors', async () => { const result = mount(); await block(); fireEvent.click(screen.getByRole('button', { name: /^1\. North site/ })); state.user = 'u2'; state.vineyard = 'v2'; result.rerender(<YieldSampleSitesPanel />); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add site coordinates' })).not.toBeInTheDocument(); });
  it('read-only mode disables draft actions', async () => { mount(); await block(); readOnlyStore.setReadOnly(true); await waitFor(() => expect(screen.getByRole('button', { name: 'Add site coordinates' })).toBeDisabled()); });
});