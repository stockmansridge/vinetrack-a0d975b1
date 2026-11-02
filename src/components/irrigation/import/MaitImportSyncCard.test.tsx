import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import MaitImportSyncCard from './MaitImportSyncCard';
import IrrigationImportPage from '@/pages/tools/IrrigationImportPage';
import { maitHttpResult } from '@/lib/maitIntelliwebQuery';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
import { TooltipProvider } from '@/components/ui/tooltip';

const m = vi.hoisted(() => ({ vineyard: 'v' as string | null, role: 'owner', manage: true, connected: true, controllers: [] as Record<string, unknown>[], mappings: [] as Record<string, unknown>[], valves: [] as Record<string, unknown>[], rpc: vi.fn(), proxy: vi.fn(), error: false }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ selectedVineyardId: m.vineyard, currentRole: m.role, memberships: [], loading: false }) }));
vi.mock('@/components/mait/MaitWeatherCard', async importOriginal => {
  const original = await importOriginal<typeof import('@/components/mait/MaitWeatherCard')>();
  return { ...original, useMait: () => ({ access: { data: { manage: m.manage, view: true }, isPending: false, isFetching: false, error: m.error ? new Error('failed') : null }, configuration: { isPending: false, isFetching: false }, status: {}, config: { connection: { configured: m.connected, network_id: m.connected ? 'network' : null }, controllerModules: m.controllers }, connected: m.connected, timezone: 'Australia/Sydney' }) };
});
vi.mock('@/lib/maitIntelliwebQuery', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/maitIntelliwebQuery')>(), maitRpc: (...args: unknown[]) => m.rpc(...args), maitProxy: (...args: unknown[]) => m.proxy(...args) }));
vi.mock('@/lib/irrigationQuery', () => ({ useIrrigationSystems: () => ({ data: [{ id: 'system', vineyard_id: 'v', is_active: true }] }), useIrrigationValves: () => ({ data: m.valves }) }));
vi.mock('@/components/irrigation/import/ImportBatchHistory', () => ({ default: () => <div>File import history</div> }));
vi.mock('@/components/irrigation/import/ImportValveMappingStep', () => ({ default: () => null }));
vi.mock('@/components/irrigation/import/ImportRowReview', () => ({ default: () => null }));
vi.mock('@/components/support/SupportRequestSheet', () => ({ SupportRequestSheet: () => null }));
vi.mock('@/lib/irrigationImportQuery', () => ({
  useImportProviders: () => ({ data: [{ provider_id: 'galcon_gsi', display_name: 'Galcon GSI', supported_file_types: ['xlsx', 'csv'], max_file_size_bytes: 1048576 }] }),
  useParseImportFile: () => ({}), useValidateImport: () => ({}), useCommitImport: () => ({}), useImportProviderSettings: () => ({}), useImportPreview: () => ({}), useImportBatch: () => ({}), useImportValves: () => ({ data: [] }), useSaveImportProviderSettings: () => ({}), browserTimezone: () => 'Australia/Sydney', COMPARISON_LABEL: {}, litresToCubicLabel: () => '',
}));
function mount(page = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TooltipProvider><MemoryRouter>{page ? <IrrigationImportPage /> : <MaitImportSyncCard />}</MemoryRouter></TooltipProvider></QueryClientProvider>);
  return { ...view, client, redraw: () => view.rerender(<QueryClientProvider client={client}><MemoryRouter><MaitImportSyncCard /></MemoryRouter></QueryClientProvider>) };
}
async function choose(label = 'Pump · controller') {
  fireEvent.click(screen.getByRole('combobox', { name: 'MAIT irrigation controller' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })).toBeEnabled());
}
beforeEach(() => {
  vi.clearAllMocks(); m.vineyard = 'v'; m.role = 'owner'; m.manage = true; m.connected = true; m.error = false;
  m.controllers = [{ module_id: 'controller', module_name: 'Pump', irrigation_system_id: 'system', is_active: true }];
  m.valves = [{ id: 'valve', vineyard_id: 'v', irrigation_system_id: 'system', is_active: true }];
  m.mappings = [{ irrigation_valve_id: 'valve', external_valve_number: 2 }];
  m.rpc.mockImplementation(async () => m.mappings);
  m.proxy.mockResolvedValue(maitHttpResult(200, { summary: { received: 6, committed: 4, existing: 1, needs_mapping: 1, needs_review: 0 } }));
  readOnlyStore.setReadOnly(false);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-02T01:30:00Z'));
});
afterEach(() => { cleanup(); readOnlyStore.setReadOnly(false); vi.useRealTimers(); });
describe('manual MAIT irrigation import', () => {
  it('lays out the source step as a responsive three-card grid with all actions retained', () => {
    mount(true);
    const grid = screen.getByTestId('import-source-grid');
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('md:grid-cols-2');
    expect(grid.className).toContain('xl:grid-cols-3');
    expect(grid.className).toContain('gap-4');
    for (const child of Array.from(grid.children)) expect(child.className).toContain('min-w-0');
    expect(grid.children).toHaveLength(3);
    expect(screen.getByText('Import from a file')).toBeVisible();
    expect(screen.getByRole('button', { name: /Galcon GSI/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
    expect(screen.getByText('MAIT iNTELLiWeb — API sync')).toBeVisible();
    expect(screen.getByText(/No file upload needed/)).toBeVisible();
    expect(screen.getByText("Can't see your irrigation controller?")).toBeVisible();
    expect(screen.getByRole('button', { name: /Contact support/ })).toBeVisible();
    expect(screen.getByText('File import history')).toBeVisible();
    expect(m.proxy).not.toHaveBeenCalled();
  });
  it('keeps Galcon file selection and upload step separate, with MAIT on the source step only', async () => {
    mount(true);
    expect(screen.getByText(/No file upload needed/)).toBeVisible();
    expect(screen.getByText('File import history')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Galcon GSI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Upload.*Galcon GSI/i)).toBeVisible();
    expect(screen.queryByText('MAIT iNTELLiWeb — API sync')).not.toBeInTheDocument();
    expect(m.proxy).not.toHaveBeenCalled();
  });
  it('does not read MAIT or sync without a vineyard', () => { m.vineyard = null; mount(); expect(screen.getByText(/Select a vineyard to configure/)).toBeVisible(); expect(m.rpc).not.toHaveBeenCalled(); expect(m.proxy).not.toHaveBeenCalled(); });
  it('links an unconnected system to Weather setup', () => { m.connected = false; mount(); expect(screen.getByRole('link', { name: 'Connect MAIT in Weather setup' })).toHaveAttribute('href', '/setup/weather#mait'); expect(m.proxy).not.toHaveBeenCalled(); });
  it('links a connected system without controllers to irrigation setup', () => { m.controllers = []; mount(); expect(screen.getByRole('link', { name: 'Set up MAIT irrigation controller' })).toHaveAttribute('href', '/irrigation/setup#mait-controller'); expect(screen.queryByRole('button', { name: 'Sync MAIT irrigation now' })).not.toBeInTheDocument(); });
  it.each(['unmapped', 'inactive', 'cross-vineyard', 'wrong-system'])('does not sync with %s valves', async kind => {
    if (kind === 'unmapped') m.mappings = [];
    else m.valves = [{ ...m.valves[0], ...(kind === 'inactive' ? { is_active: false } : kind === 'cross-vineyard' ? { vineyard_id: 'other' } : { irrigation_system_id: 'other' }) }];
    mount(); fireEvent.click(screen.getByRole('combobox')); fireEvent.click(await screen.findByRole('option', { name: 'Pump · controller' }));
    expect(await screen.findByRole('link', { name: 'Configure MAIT valve mappings' })).toHaveAttribute('href', '/irrigation/setup#mait-controller'); expect(m.proxy).not.toHaveBeenCalled();
  });
  it('requires confirmation and makes exactly one correctly scoped three-day request', async () => {
    const { client } = mount(); const invalidate = vi.spyOn(client, 'invalidateQueries'); await choose(); expect(m.proxy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })); expect(screen.getByRole('dialog')).toHaveTextContent("today's saved valve-to-block configuration"); expect(m.proxy).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Confirm & sync' }); fireEvent.click(confirm); fireEvent.click(confirm);
    await screen.findByText('Latest MAIT sync result');
    expect(m.proxy).toHaveBeenCalledTimes(1); expect(m.proxy).toHaveBeenCalledWith('v', 'sync_usage', { moduleId: 'controller', startDate: '2026-10-31', endDate: '2026-11-03' });
    expect(screen.getByRole('status')).toHaveTextContent('Committed4'); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['irrigation-report'] });
  });
  it('cancels without a request', async () => { mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(m.proxy).not.toHaveBeenCalled(); });
  it.each(['view-only', 'role', 'trial', 'error'])('fails closed for %s access', kind => { if (kind === 'view-only') m.manage = false; if (kind === 'role') m.role = 'worker'; if (kind === 'trial') readOnlyStore.setReadOnly(true); if (kind === 'error') m.error = true; mount(); expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); expect(m.rpc).not.toHaveBeenCalled(); expect(m.proxy).not.toHaveBeenCalled(); });
  it('requires explicit multi-controller choice and clears results on controller and vineyard changes', async () => {
    m.controllers.push({ module_id: 'second', module_name: 'Second', irrigation_system_id: 'system', is_active: true });
    const view = mount(); expect(m.rpc).not.toHaveBeenCalled(); await choose('Second · second');
    fireEvent.click(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm & sync' })); await screen.findByText('Latest MAIT sync result');
    expect(m.proxy).toHaveBeenCalledWith('v', 'sync_usage', expect.objectContaining({ moduleId: 'second' })); await choose(); expect(screen.queryByText('Latest MAIT sync result')).not.toBeInTheDocument();
    m.vineyard = 'other'; view.redraw(); expect(screen.getByRole('combobox')).toHaveTextContent('MAIT irrigation controller'); expect(screen.queryByRole('button', { name: 'Sync MAIT irrigation now' })).not.toBeInTheDocument();
  });
  it('preserves partial 206 counts and warning', async () => { m.proxy.mockResolvedValue(maitHttpResult(206, { success: false, summary: { received: 9, committed: 3, existing: 2, needs_mapping: 1, needs_review: 3 } })); mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm & sync' })); await screen.findByText('Latest MAIT sync result'); expect(screen.getByRole('status')).toHaveTextContent('partial/truncated'); expect(screen.getByRole('status')).toHaveTextContent('Needs review3'); });
  it('shows failed sync separately from success', async () => { m.proxy.mockRejectedValue(new Error('MAIT could not be reached.')); mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm & sync' })); expect(await screen.findByRole('alert')).toHaveTextContent('MAIT could not be reached.'); expect(screen.queryByText('Latest MAIT sync result')).not.toBeInTheDocument(); });
  it('blocks offline sync before any request', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try { mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm & sync' })); expect(await screen.findByRole('alert')).toHaveTextContent('MAIT sync is unavailable'); expect(m.proxy).not.toHaveBeenCalled(); } finally { online.mockRestore(); }
  });
  it('blocks sync if the mapping read fails rather than treating it as empty', async () => {
    m.rpc.mockRejectedValue(new Error('permission denied')); mount(); fireEvent.click(screen.getByRole('combobox')); fireEvent.click(await screen.findByRole('option', { name: 'Pump · controller' })); expect(await screen.findByRole('alert')).toHaveTextContent('Could not verify saved irrigation systems'); expect(screen.queryByRole('button', { name: 'Sync MAIT irrigation now' })).not.toBeInTheDocument(); expect(m.proxy).not.toHaveBeenCalled();
  });
  it('ignores a late old-controller result after changing selection', async () => {
    let resolve: ((result: ReturnType<typeof maitHttpResult>) => void) | undefined;
    m.proxy.mockImplementation(() => new Promise(r => { resolve = r; }));
    m.controllers.push({ module_id: 'second', module_name: 'Second', irrigation_system_id: 'system', is_active: true });
    mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm & sync' })); await waitFor(() => expect(m.proxy).toHaveBeenCalledTimes(1));
    await choose('Second · second');
    if (!resolve) throw new Error('Expected a pending sync');
    resolve(maitHttpResult(200, { summary: { committed: 4 } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync MAIT irrigation now' })).toBeEnabled()); expect(screen.queryByText('Latest MAIT sync result')).not.toBeInTheDocument(); expect(m.proxy).toHaveBeenCalledTimes(1);
  });
});