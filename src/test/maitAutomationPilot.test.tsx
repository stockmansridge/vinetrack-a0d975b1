import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MaitAutomationPilot } from '@/components/mait/MaitAutomationPilot';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';

const m = vi.hoisted(() => ({ admin: true, adminLoading: false, member: true, rpc: vi.fn(), status: {} as Record<string, unknown> }));
vi.mock('@/lib/systemAdmin', () => ({ useIsSystemAdmin: () => ({ isAdmin: m.admin, loading: m.adminLoading }) }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ loading: false, memberships: m.member ? [{ vineyard_id: 'v', role: 'owner' }] : [] }) }));
vi.mock('@/lib/maitIntelliwebQuery', async original => ({ ...await original<typeof import('@/lib/maitIntelliwebQuery')>(), maitRpc: (...args: unknown[]) => m.rpc(...args) }));

function mount(moduleId = 'controller') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = (id: string) => <QueryClientProvider client={client}><MaitAutomationPilot vineyardId="v" moduleId={id} timezone="Australia/Sydney" /></QueryClientProvider>;
  const view = render(ui(moduleId));
  return { ...view, redraw: (id: string) => view.rerender(ui(id)) };
}
beforeEach(() => {
  vi.clearAllMocks(); m.admin = true; m.adminLoading = false; m.member = true;
  m.status = { scheduler_active: false, pilot_system_admin_only: true, modules: [{ module_id: 'controller', auto_sync_enabled: false, auto_commit_enabled: false, overlap_days: 3 }, { module_id: 'other', auto_sync_enabled: false, auto_commit_enabled: false, overlap_days: 3 }] };
  m.rpc.mockImplementation(async name => name === 'get_mait_irrigation_automation_status' ? m.status : true);
  readOnlyStore.setReadOnly(false);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); readOnlyStore.setReadOnly(false); vi.unstubAllGlobals(); });

describe('MAIT irrigation automation pilot', () => {
  it.each(['ordinary member', 'admin without membership', 'pending admin'])('never reads or saves pilot settings for %s', kind => {
    if (kind === 'ordinary member') m.admin = false;
    if (kind === 'admin without membership') m.member = false;
    if (kind === 'pending admin') m.adminLoading = true;
    mount();
    expect(screen.queryByRole('button', { name: 'Save pilot preferences' })).not.toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('loads inactive status without automatic sync or saving, with both preferences off and three-day overlap', async () => {
    mount();
    expect(await screen.findByRole('switch', { name: 'Automatic retrieval' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Overlap (days)' })).toHaveValue(3);
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith('get_mait_irrigation_automation_status', 'v');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saves only preferences for the explicit vineyard/controller and does not invoke MAIT', async () => {
    mount();
    fireEvent.click(await screen.findByRole('switch', { name: 'Automatic retrieval' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic record creation' }));
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).not.toBeChecked();
    expect(m.rpc.mock.calls.some(c => c[0] === 'set_mait_irrigation_automation_options')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm record creation' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pilot preferences' }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('set_mait_irrigation_automation_options', 'v', { p_module_id: 'controller', p_auto_sync_enabled: true, p_auto_commit_enabled: true, p_overlap_days: 7 }));
    expect(m.rpc.mock.calls.filter(c => c[0] === 'set_mait_irrigation_automation_options')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])('saves a default controller with no sync-state row and retrieval=%s', async retrieve => {
    m.status.modules = [{ module_id: 'controller', auto_sync_enabled: false, auto_commit_enabled: false, overlap_days: 3 }];
    mount(); const retrieval = await screen.findByRole('switch', { name: 'Automatic retrieval' });
    if (retrieve) fireEvent.click(retrieval);
    fireEvent.click(screen.getByRole('button', { name: 'Save pilot preferences' }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('set_mait_irrigation_automation_options', 'v', { p_module_id: 'controller', p_auto_sync_enabled: retrieve, p_auto_commit_enabled: false, p_overlap_days: 3 }));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels record creation without changing the preference or saving', async () => {
    mount(); fireEvent.click(await screen.findByRole('switch', { name: 'Automatic retrieval' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic record creation' }));
    expect(screen.getByRole('button', { name: 'Save pilot preferences' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).not.toBeChecked();
    expect(m.rpc.mock.calls.some(c => c[0] === 'set_mait_irrigation_automation_options')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save pilot preferences' }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('set_mait_irrigation_automation_options', 'v', expect.objectContaining({ p_auto_sync_enabled: true, p_auto_commit_enabled: false })));
  });
  it('turning retrieval off resets confirmed record creation and sends both off', async () => {
    mount(); const retrieval = await screen.findByRole('switch', { name: 'Automatic retrieval' });
    fireEvent.click(retrieval); fireEvent.click(screen.getByRole('switch', { name: 'Automatic record creation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm record creation' }));
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).toBeChecked();
    fireEvent.click(retrieval);
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save pilot preferences' }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('set_mait_irrigation_automation_options', 'v', expect.objectContaining({ p_auto_sync_enabled: false, p_auto_commit_enabled: false })));
  });
  it('does not accept record creation confirmation after the vineyard becomes read-only', async () => {
    mount(); fireEvent.click(await screen.findByRole('switch', { name: 'Automatic retrieval' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic record creation' }));
    readOnlyStore.setReadOnly(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm record creation' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm record creation' }));
    expect(screen.getByRole('switch', { name: 'Automatic record creation' })).not.toBeChecked();
    expect(m.rpc.mock.calls.some(c => c[0] === 'set_mait_irrigation_automation_options')).toBe(false);
  });
  it.each(['0', '15', '1.5', ''])('rejects overlap %s before a save request', async value => {
    mount(); await screen.findByRole('spinbutton');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value } });
    const save = screen.getByRole('button', { name: 'Save pilot preferences' });
    expect(save).toBeDisabled(); fireEvent.click(save);
    expect(m.rpc.mock.calls.some(c => c[0] === 'set_mait_irrigation_automation_options')).toBe(false);
  });
  it.each([1, 14])('accepts the overlap boundary %s', async days => {
    mount(); await screen.findByRole('spinbutton');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: String(days) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pilot preferences' }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('set_mait_irrigation_automation_options', 'v', expect.objectContaining({ p_overlap_days: days })));
  });
  it('blocks preference writes in read-only mode', async () => {
    readOnlyStore.setReadOnly(true); mount();
    const save = await screen.findByRole('button', { name: 'Save pilot preferences' });
    expect(save).toBeDisabled(); expect(screen.getByRole('switch', { name: 'Automatic retrieval' })).toBeDisabled();
    fireEvent.click(save);
    expect(m.rpc.mock.calls.some(c => c[0] === 'set_mait_irrigation_automation_options')).toBe(false);
  });
  it('fails closed on status errors or missing selected module', async () => {
    m.status = { scheduler_active: false, pilot_system_admin_only: true, modules: [] }; mount();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Save pilot preferences' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed on an unrecognised status envelope', async () => {
    m.status = {}; mount(); await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Save pilot preferences' })).not.toBeInTheDocument();
  });
  it('shows save failure without reporting success or running a sync', async () => {
    m.rpc.mockImplementation(async name => { if (name === 'set_mait_irrigation_automation_options') throw new Error('Pilot preferences could not be saved'); return m.status; });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Save pilot preferences' }));
    await screen.findByRole('alert', { name: '' });
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent?.includes('could not be saved'))).toBe(true));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('resets unsaved preferences on controller changes', async () => {
    const { redraw } = mount(); fireEvent.click(await screen.findByRole('switch', { name: 'Automatic retrieval' }));
    redraw('other');
    expect(await screen.findByRole('switch', { name: 'Automatic retrieval' })).not.toBeChecked();
    const save = screen.getByRole('button', { name: 'Save pilot preferences' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('set_mait_irrigation_automation_options', 'v', expect.objectContaining({ p_module_id: 'other', p_auto_sync_enabled: false })));
  });
});