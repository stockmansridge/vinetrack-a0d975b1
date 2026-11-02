import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MaitControllerCard } from '@/components/mait/MaitControllerCard';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
import { maitDateWindow } from '@/lib/maitIntelliwebQuery';

const m = vi.hoisted(() => ({ role: 'owner', vineyard: 'v', manage: true, controllers: [] as Record<string, any>[], mappings: [] as Record<string, any>[], proxy: vi.fn(), blocks: [] as Record<string, any>[], allocationOk: true, blockError: false }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ currentRole: m.role, selectedVineyardId: m.vineyard, loading: false }) }));
vi.mock('@/components/mait/MaitWeatherCard', async importOriginal => {
  const original = await importOriginal<typeof import('@/components/mait/MaitWeatherCard')>();
  return { ...original, useMait: () => ({ access: { data: { manage: m.manage }, isPending: false }, configuration: {}, config: { controllerModules: m.controllers, connection: { network_id: 'network', configured: true } }, connected: true, timezone: 'Australia/Sydney' }) };
});
vi.mock('@/components/mait/MaitAutomationPilot', () => ({ MaitAutomationPilot: () => null }));
vi.mock('@/lib/maitIntelliwebQuery', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/maitIntelliwebQuery')>(), maitProxy: m.proxy, maitRpc: vi.fn(async () => m.mappings) }));
vi.mock('@/lib/irrigationQuery', () => ({
  useIrrigationSystems: () => ({ data: [{ id: 'system', name: 'Test system', is_active: true, vineyard_id: m.vineyard }] }),
  useIrrigationValves: () => ({ data: [{ id: 'valve', name: 'Test valve', is_active: true, vineyard_id: m.vineyard, irrigation_system_id: 'system' }] }),
  useValveBlocks: () => ({ data: m.blocks, error: m.blockError ? new Error('unavailable') : null }),
  useSetupStatus: () => ({ data: { valves: [{ valve_id: 'valve', valve_name: 'Test valve', allocation_ok: m.allocationOk }] } }),
}));
function controller(module_id = 'one') { return { module_id, module_name: `Controller ${module_id}`, irrigation_system_id: 'system', is_active: true }; }
function mount(vineyardId = 'v') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  return render(<MaitControllerCard vineyardId={vineyardId} />, { wrapper });
}
async function choose(id = 'one') {
  fireEvent.click(await screen.findByRole('combobox', { name: 'Choose controller module' }));
  fireEvent.click(await screen.findByRole('option', { name: `${id} · Controller ${id}` }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled());
}
beforeEach(() => {
  vi.clearAllMocks(); m.role = 'owner'; m.vineyard = 'v'; m.manage = true; m.controllers = [controller(), controller('two')];
  m.mappings = [{ external_valve_number: 1, irrigation_valve_id: 'valve' }];
  m.blocks = [{ id: 'allocation', valve_id: 'valve', block_name: 'Test block', allocation_method: 'rows', row_count: 20, is_active: true }];
  m.allocationOk = true; m.blockError = false; readOnlyStore.setReadOnly(false);
  m.proxy.mockResolvedValue({ status: 200, partial: false, empty: false, data: { events: [{ output_number: 1, started_at: '2026-11-01T05:00:00Z', duration_minutes: 45, reported_volume_litres: 2500 }] } });
});
afterEach(() => { cleanup(); readOnlyStore.setReadOnly(false); });
describe('safe MAIT controller acceptance', () => {
  it('never previews on mount and handles no confirmed controller without misclassifying sensors', () => {
    m.controllers = []; mount();
    expect(screen.getByText(/No irrigation controller configured/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
    expect(m.proxy).not.toHaveBeenCalled();
  });
  it('reads available module names only on request and does not save a controller', async () => {
    m.controllers = []; m.proxy.mockResolvedValue({ data: { modules: [{ module_id: 'sensor', description: 'Soil moisture' }] } }); mount();
    fireEvent.click(screen.getByRole('button', { name: 'Load controller modules' }));
    await waitFor(() => expect(m.proxy).toHaveBeenCalledExactlyOnceWith('v', 'modules'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Choose controller module' }));
    expect(await screen.findByRole('option', { name: 'sensor · Soil moisture' })).toBeVisible();
  });
  it('previews only on click with the selected controller and three-day local window, converting litres to kL', async () => {
    mount(); await choose(); expect(m.proxy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' }));
    const preview = await screen.findByRole('region', { name: 'Read-only MAIT usage preview' });
    expect(within(preview).getByRole('cell', { name: '2.5' })).toBeVisible();
    expect(within(preview).getByRole('cell', { name: '45' })).toBeVisible();
    expect(m.proxy).toHaveBeenCalledExactlyOnceWith('v', 'usage', { moduleId: 'one', ...maitDateWindow('Australia/Sydney') });
  });
  it.each([204, 206])('handles status %s without claiming a complete preview or importing', async status => {
    m.proxy.mockResolvedValue({ status, partial: status === 206, empty: status === 204, data: { events: [] } });
    mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' }));
    const preview = await screen.findByRole('region', { name: 'Read-only MAIT usage preview' });
    expect(preview).toHaveTextContent(status === 204 ? 'No MAIT usage data returned (204)' : 'partial/truncated');
    expect(m.proxy.mock.calls.every(c => c[1] === 'usage')).toBe(true);
  });
  it('clears usage evidence when controller changes', async () => {
    mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' }));
    await screen.findByRole('region', { name: 'Read-only MAIT usage preview' }); await choose('two');
    expect(screen.queryByRole('region', { name: 'Read-only MAIT usage preview' })).not.toBeInTheDocument();
    expect(m.proxy).toHaveBeenCalledTimes(1);
  });
  it('ignores a late preview response from a previous controller', async () => {
    let resolve: (value: unknown) => void = () => {};
    m.proxy.mockImplementation(() => new Promise(r => { resolve = r; }));
    mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' }));
    await waitFor(() => expect(m.proxy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('combobox', { name: 'Choose controller module' })); fireEvent.click(await screen.findByRole('option', { name: 'two · Controller two' }));
    resolve({ data: { events: [{ output_number: 99 }] }, partial: false, empty: false });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' })).toBeEnabled());
    expect(screen.queryByRole('region', { name: 'Read-only MAIT usage preview' })).not.toBeInTheDocument();
  });
  it('resets selection and preview on vineyard change', async () => {
    const view = mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' })); await screen.findByRole('region', { name: 'Read-only MAIT usage preview' });
    m.vineyard = 'other'; view.rerender(<MaitControllerCard vineyardId="other" />);
    expect(screen.queryByRole('region', { name: 'Read-only MAIT usage preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });
  it('cancel makes no request; confirm sends exactly one scoped manual sync', async () => {
    mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('may immediately create irrigation records');
    expect(m.proxy).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(m.proxy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm & sync' }));
    await waitFor(() => expect(m.proxy).toHaveBeenCalledExactlyOnceWith('v', 'sync_usage', { moduleId: 'one', ...maitDateWindow('Australia/Sydney') }));
  });
  it.each(['worker', 'manage', 'wrong-vineyard'])('denies controller acceptance actions for %s', kind => {
    if (kind === 'worker') m.role = 'worker'; if (kind === 'manage') m.manage = false; if (kind === 'wrong-vineyard') m.vineyard = 'other';
    mount(); expect(screen.queryByRole('button', { name: 'Load controller modules' })).not.toBeInTheDocument(); expect(m.proxy).not.toHaveBeenCalled();
  });
  it('allows read-only preview but never sync for an expired trial', async () => {
    readOnlyStore.setReadOnly(true); mount();
    fireEvent.click(screen.getByRole('combobox', { name: 'Choose controller module' })); fireEvent.click(await screen.findByRole('option', { name: 'one · Controller one' }));
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' }));
    await screen.findByRole('region', { name: 'Read-only MAIT usage preview' }); expect(m.proxy.mock.calls[0][1]).toBe('usage');
  });
  it('uses authoritative allocation status and fails unverified allocation reads honestly', async () => {
    m.blockError = true; mount(); await choose(); expect(screen.getByText('Confirm in setup')).toBeVisible();
    expect(screen.getByText(/does not verify every controller output/)).toBeVisible();
  });
  it('shows preview failure without success evidence', async () => {
    m.proxy.mockRejectedValue(new Error('Read failed')); mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Preview MAIT usage (read-only)' }));
    expect(await screen.findByText('Read failed')).toBeVisible(); expect(screen.queryByRole('region', { name: 'Read-only MAIT usage preview' })).not.toBeInTheDocument();
  });
});