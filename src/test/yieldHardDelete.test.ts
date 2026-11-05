import { describe, it, expect, vi, beforeEach } from 'vitest';
const calls: any[] = [];
let deleteData: any = [{ id: 's1' }];
let receipt: any = null;
let rpcError: any = null;
vi.mock('@/lib/vineyardWriteAccess', () => ({ guardMutation: () => {} }));
vi.mock('@/integrations/ios-supabase/client', () => {
  const chain = (table: string) => {
    const q: any = { filters: [] as any[] };
    q.delete = () => { q.op = 'delete'; return q; };
    q.select = () => q;
    q.eq = (k: string, v: any) => { q.filters.push([k, v]); return q; };
    q.maybeSingle = async () => ({ data: receipt, error: null });
    q.then = (res: any) => { calls.push({ table, filters: q.filters, op: q.op }); return Promise.resolve({ data: deleteData, error: null }).then(res); };
    return q;
  };
  return { supabase: { from: chain, rpc: async (n: string, a: any) => { calls.push({ rpc: n, a }); return { error: rpcError }; } } };
});
import { canHardDeleteYieldSite, canHardDeleteYieldSession, hardDeleteYieldSite, hardDeleteYieldSession } from '@/lib/yieldHardDelete';

const set = (status: any) => ({ id: 'set', vineyard_id: 'v', paddock_id: 'b', set_key: 'k', version: 1, name: 'n', status });
const site: any = { id: 's1', site_id: 'phys', site_set_id: 'set', vineyard_id: 'v', paddock_id: 'b' };
beforeEach(() => { calls.length = 0; deleteData = [{ id: 's1' }]; receipt = null; rpcError = null; });

describe('yield hard delete permissions', () => {
  it('draft sites: all members; confirmed: leadership only; archived never', () => {
    for (const r of ['operator', 'supervisor', 'manager', 'owner']) expect(canHardDeleteYieldSite(r, 'draft')).toBe(true);
    expect(canHardDeleteYieldSite('operator', 'confirmed')).toBe(false);
    for (const r of ['supervisor', 'manager', 'owner']) expect(canHardDeleteYieldSite(r, 'confirmed')).toBe(true);
    expect(canHardDeleteYieldSite('owner', 'archived')).toBe(false);
    expect(canHardDeleteYieldSite(null, 'draft')).toBe(false);
  });
  it('sessions: operators before completion, leadership after', () => {
    expect(canHardDeleteYieldSession('operator', false)).toBe(true);
    expect(canHardDeleteYieldSession('operator', true)).toBe(false);
    expect(canHardDeleteYieldSession('supervisor', true)).toBe(true);
    expect(canHardDeleteYieldSession(null, false)).toBe(false);
  });
});

describe('hardDeleteYieldSite', () => {
  it('requires a matching receipt before success', async () => {
    receipt = { deleted_row_id: 's1', site_set_id: 'set', site_id: 'phys', vineyard_id: 'v', was_confirmed: true };
    await expect(hardDeleteYieldSite(set('confirmed') as any, site, 'manager', () => {})).resolves.toMatchObject({ was_confirmed: true });
    expect(calls[0].filters).toEqual([['id', 's1'], ['site_set_id', 'set'], ['vineyard_id', 'v']]);
  });
  it('fails when server deleted nothing', async () => {
    deleteData = [];
    await expect(hardDeleteYieldSite(set('draft') as any, site, 'operator', () => {})).rejects.toThrow(/did not delete/);
  });
  it('fails without receipt', async () => {
    await expect(hardDeleteYieldSite(set('draft') as any, site, 'operator', () => {})).rejects.toThrow(/receipt/);
  });
  it('blocks operator on confirmed before any request', async () => {
    await expect(hardDeleteYieldSite(set('confirmed') as any, site, 'operator', () => {})).rejects.toThrow(/Supervisor/);
    expect(calls).toHaveLength(0);
  });
});

describe('hardDeleteYieldSession', () => {
  it('calls RPC with expected completion and verifies receipt', async () => {
    receipt = { deleted_row_id: 'x' };
    await hardDeleteYieldSession('x', 'v', true);
    expect(calls[0]).toEqual({ rpc: 'hard_delete_yield_estimation_session', a: { p_id: 'x', p_vineyard_id: 'v', p_expected_completed: true } });
  });
  it('surfaces server errors and missing receipts', async () => {
    rpcError = { message: 'denied' };
    await expect(hardDeleteYieldSession('x', 'v', false)).rejects.toMatchObject({ message: 'denied' });
    rpcError = null;
    await expect(hardDeleteYieldSession('x', 'v', false)).rejects.toThrow(/receipt/);
  });
});
