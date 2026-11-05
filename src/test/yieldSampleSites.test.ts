import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canConfirmYieldSites, confirmYieldSiteSet, copyYieldSites, createYieldDraft, deleteYieldDraftSite, listYieldSiteSets, nextYieldDraft, saveYieldSite, siteLocationError, validateYieldSite, type YieldSampleSite, type YieldSiteSet } from '@/lib/yieldSampleSites';
import { yieldCountMethodLabel } from '@/lib/yieldCountMethod';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';

const db = vi.hoisted(() => ({ sets: [] as any[], sites: [] as any[], calls: [] as any[], error: null as any, confirmed: true, rpc: vi.fn() }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: {
  rpc: (...args: any[]) => db.rpc(...args),
  from: (table: string) => {
    const filters: [string, unknown][] = []; let action = 'select'; let values: any;
    const chain: any = {
      select: () => chain, eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; }, order: () => chain,
      insert: (v: any) => { action = 'insert'; values = v; return chain; },
      update: (v: any) => { action = 'update'; values = v; return chain; }, delete: () => { action = 'delete'; return chain; },
      then: (resolve: any) => {
        db.calls.push({ table, action, values, filters });
        if (db.error) return resolve({ error: db.error, data: null });
        const rows = table === 'yield_sample_site_sets' ? db.sets : db.sites;
        const match = (r: any) => filters.every(([k, v]) => r[k] === v);
        if (action === 'insert') rows.push(values);
        if (action === 'update') rows.filter(match).forEach(r => Object.assign(r, values));
        if (action === 'delete') { const keep = rows.filter(r => !match(r)); rows.splice(0, rows.length, ...keep); }
        return resolve({ data: rows.filter(match).map(r => ({ ...r })), error: null });
      },
    }; return chain;
  },
} }));
const polygon = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 2, lng: 2 }, { lat: 2, lng: 0 }];
const draft: YieldSiteSet = { id: 'd', vineyard_id: 'v', paddock_id: 'b', set_key: 'key', version: 2, name: 'Sites', status: 'draft' };
const site: YieldSampleSite = { id: 's', site_set_id: 'd', vineyard_id: 'v', paddock_id: 'b', site_id: 'physical', site_number: 1, name: 'North', row_number: null, panel_number: null, latitude: 1, longitude: 1, notes: null };
beforeEach(() => {
  db.sets = [{ ...draft }]; db.sites = []; db.calls = []; db.error = null; db.confirmed = true;
  readOnlyStore.setReadOnly(false);
  db.rpc.mockReset().mockImplementation(async () => {
    if (db.confirmed) db.sets = db.sets.map(s => ({ ...s, status: s.id === 'd' ? 'confirmed' : 'archived', confirmed_at: '2026-11-05T00:00:00Z' }));
    return { error: null, data: null };
  });
});
describe('fixed yield sampling contract', () => {
  it.each(['owner', 'manager', 'supervisor'])('%s can confirm', role => expect(canConfirmYieldSites(role)).toBe(true));
  it.each(['operator', 'viewer', 'system_admin', null])('%s cannot confirm', role => expect(canConfirmYieldSites(role)).toBe(false));
  it('accepts inside and edge but rejects outside points', () => { expect(siteLocationError({ lat: 1, lng: 1 }, polygon, false)).toBeNull(); expect(siteLocationError({ lat: 0, lng: 1 }, polygon, false)).toBeNull(); expect(siteLocationError({ lat: 3, lng: 1 }, polygon, true)).toMatch(/outside/); });
  it('requires explicit block confirmation without geometry', () => { expect(siteLocationError({ lat: 1, lng: 1 }, [], false)).toMatch(/Explicitly/); expect(siteLocationError({ lat: 1, lng: 1 }, [], true)).toBeNull(); });
  it.each([NaN, Infinity, 91])('rejects invalid latitude %s', latitude => expect(() => validateYieldSite({ ...site, latitude }, polygon, true)).toThrow());
  it('rejects nonpositive row/panel and blank names', () => { expect(() => validateYieldSite({ ...site, row_number: 0 }, polygon, true)).toThrow(); expect(() => validateYieldSite({ ...site, panel_number: 1.2 }, polygon, true)).toThrow(); expect(() => validateYieldSite({ ...site, name: '' }, polygon, true)).toThrow(); });
  it('copies stable site IDs but regenerates row IDs and increments version', () => {
    const from = { ...draft, id: 'old', version: 1, status: 'confirmed' as const };
    const next = nextYieldDraft(from, [from, draft], 'v', 'b', 'u', 'Sites');
    expect(next.version).toBe(3); expect(next.set_key).toBe('key');
    const old = { ...site, site_set_id: 'old' }; const [copy] = copyYieldSites([old], from, next);
    expect(copy.site_id).toBe('physical'); expect(copy.id).not.toBe(old.id); expect(copy.site_set_id).toBe(next.id); expect(old.site_set_id).toBe('old');
  });
  it('rejects cross-vineyard revision copying', () => expect(() => nextYieldDraft({ ...draft, status: 'confirmed' }, [], 'other', 'b', 'u', 'Sites')).toThrow(/scope/));
  it('saves and reads back a draft site; same-ID retry does not duplicate', async () => {
    await saveYieldSite(draft, site, true, polygon, false, () => {}); await saveYieldSite(draft, site, true, polygon, false, () => {});
    expect(db.sites).toHaveLength(1); expect(db.sites[0].site_id).toBe('physical');
  });
  it('edits fields without changing physical identity', async () => {
    db.sites = [{ ...site }]; await saveYieldSite(draft, { ...site, name: 'South' }, false, polygon, false, () => {});
    expect(db.sites[0].name).toBe('South'); expect(db.sites[0].site_id).toBe('physical');
    await expect(saveYieldSite(draft, { ...site, site_id: 'different' }, false, polygon, false, () => {})).rejects.toThrow(/identity/);
  });
  it('never updates or deletes confirmed sites', async () => {
    db.sets[0].status = 'confirmed'; db.sites = [{ ...site }];
    await expect(saveYieldSite(draft, site, false, polygon, false, () => {})).rejects.toThrow(/confirmed/);
    await expect(deleteYieldDraftSite(draft, site, () => {})).rejects.toThrow(/confirmed/);
    expect(db.calls.some(c => ['update', 'delete'].includes(c.action))).toBe(false);
  });
  it('deletes draft only with scoped filters and readback', async () => { db.sites = [{ ...site }]; await deleteYieldDraftSite(draft, site, () => {}); expect(db.sites).toHaveLength(0); expect(db.calls.find(c => c.action === 'delete').filters).toContainEqual(['paddock_id', 'b']); });
  it('confirms one block through exact RPC arguments and verifies old archive', async () => {
    db.sites = [{ ...site }]; db.sets.push({ ...draft, id: 'old', status: 'confirmed', version: 1 });
    const result = await confirmYieldSiteSet(draft, 'supervisor', polygon, false, () => {});
    expect(db.rpc).toHaveBeenCalledWith('confirm_yield_sample_site_set', { p_set_id: 'd', p_expected_version: 2 }); expect(result.status).toBe('confirmed'); expect(db.sets.find(s => s.id === 'old').status).toBe('archived');
  });
  it('does not claim confirmation when readback remains draft', async () => { db.sites = [{ ...site }]; db.confirmed = false; await expect(confirmYieldSiteSet(draft, 'owner', polygon, false, () => {})).rejects.toThrow(/not verified/); });
  it('rejects empty confirmation and denied roles without RPC', async () => { await expect(confirmYieldSiteSet(draft, 'owner', polygon, true, () => {})).rejects.toThrow(/at least one/); await expect(confirmYieldSiteSet(draft, 'operator', polygon, true, () => {})).rejects.toThrow(/Only/); expect(db.rpc).not.toHaveBeenCalled(); });
  it('surfaces server errors', async () => { db.error = { message: 'permission denied' }; await expect(listYieldSiteSets('v', 'b')).rejects.toEqual(db.error); });
  it('preserves same draft and copied IDs on retries', async () => {
    const result = await createYieldDraft(draft, [site], () => {}); await createYieldDraft(draft, [site], () => {});
    expect(result.id).toBe('d'); expect(db.sets).toHaveLength(1); expect(db.sites).toHaveLength(1);
  });
  it('fails closed on scope switch before write', async () => { let calls = 0; await expect(saveYieldSite(draft, site, true, polygon, false, () => { if (++calls > 1) throw new Error('scope changed'); })).rejects.toThrow(/scope changed/); expect(db.sites).toHaveLength(0); });
  it('read-only mode blocks writes', async () => { readOnlyStore.setReadOnly(true); await expect(saveYieldSite(draft, site, true, polygon, false, () => {})).rejects.toThrow(/trial/); expect(db.calls).toHaveLength(0); });
  it('reports legacy and unknown methods distinctly', () => { expect(yieldCountMethodLabel({})).toBe('Bunches Per Vine Count (legacy)'); expect(yieldCountMethodLabel({ countMethod: 'bunchesPerVine' })).toBe('Bunches Per Vine Count'); expect(yieldCountMethodLabel({ countMethod: 'panelWeight' })).toBe('Count method: panelWeight'); expect(yieldCountMethodLabel('{')).toBe('Count method unavailable'); });
});