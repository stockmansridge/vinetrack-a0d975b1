import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MaitSyncResult } from '@/components/mait/MaitControllerCard';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession } }, IOS_SUPABASE_URL: 'https://example.test', IOS_SUPABASE_ANON_KEY: 'public' }));
import { maitAccess, saveMaitConnection, maitConversion, maitDateWindow, maitHttpResult, maitProxy, maitModules, maitChannels, maitOutputs, maitDailyRainConfirmed, irrigationSessionSourceLabel, MAIT_PARTIAL_WARNING } from '@/lib/maitIntelliwebQuery';
import { mapBackendObservationProvider, resolveLocalObservationProvider, refreshObservationProvider } from '@/lib/localObservationProvider';

beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.rpc.mockResolvedValue({ data: true, error: null }); mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-session' } } }); });
describe('MAIT access and credentials', () => {
  it('uses both backend access RPCs without role inference', async () => { expect(await maitAccess('v')).toEqual({ manage: true, view: true }); expect(mocks.rpc).toHaveBeenCalledWith('has_mait_intelliweb_manage_access', { p_vineyard_id: 'v' }); expect(mocks.rpc).toHaveBeenCalledWith('has_mait_intelliweb_view_access', { p_vineyard_id: 'v' }); });
  it('fails closed for absent access values', async () => { mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await maitAccess('v')).toEqual({ manage: false, view: false }); });
  it('preserves saved password by sending null', async () => { await saveMaitConnection('v', { username: 'u', password: '', networkId: 'n', timezone: 'Australia/Sydney' }); expect(mocks.rpc).toHaveBeenCalledWith('save_mait_intelliweb_connection', expect.objectContaining({ p_password: null, p_timezone: 'Australia/Sydney' })); });
  it('sends an explicitly supplied replacement password', async () => { await saveMaitConnection('v', { username: 'u', password: 'replacement', networkId: 'n', timezone: 'Australia/Sydney' }); expect(mocks.rpc).toHaveBeenCalledWith('save_mait_intelliweb_connection', expect.objectContaining({ p_password: 'replacement' })); });
  it('typed test only calls the proxy, never a save RPC', async () => { const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })); vi.stubGlobal('fetch', fetcher); await maitProxy('v', 'test', { username: 'u', password: 'typed', networkId: 'n' }); expect(mocks.rpc).not.toHaveBeenCalled(); expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ vineyardId: 'v', action: 'test', username: 'u', password: 'typed', networkId: 'n' }); });
});
describe('MAIT provider and channel mapping', () => {
  it('maps explicit MAIT selection', () => expect(mapBackendObservationProvider('mait_intelliweb')).toBe('mait_intelliweb'));
  it('does not add MAIT to legacy fallback', () => expect(resolveLocalObservationProvider({ observationSource: 'mait_intelliweb' })).toBe('none'));
  it('refreshes MAIT current before later weather reads', async () => { const fetcher = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetcher); expect(await refreshObservationProvider('v', 'mait_intelliweb')).toMatchObject({ ok: true, attempted: true }); expect(JSON.parse(fetcher.mock.calls[0][1].body).action).toBe('current'); });
  it.each([['°F', 'temperature_c', 5/9, -32*5/9], ['m/s', 'wind_speed_kmh', 3.6, 0], ['mph', 'wind_gust_kmh', 1.609344, 0], ['cm', 'rainfall_mm', 10, 0], ['inches', 'rainfall_mm', 25.4, 0], ['°C', 'temperature_c', 1, 0], ['kph', 'wind_speed_kmh', 1, 0], ['%', 'humidity_pct', 1, 0], ['deg', 'wind_direction_deg', 1, 0]])('converts %s for %s', (u,m,a,b) => expect(maitConversion(u,m)).toEqual({ multiplier:a, offset:b }));
  it('does not guess unknown or dimensionally incorrect units', () => { expect(maitConversion('unknown', 'temperature_c')).toBeNull(); expect(maitConversion('mph','rainfall_mm')).toBeNull(); });
  it('only allows active explicitly daily cumulative rainfall', () => { expect(maitDailyRainConfirmed([{ canonical_metric:'rainfall_mm', semantics:'daily_cumulative', is_active:true }])).toBe(true); expect(maitDailyRainConfirmed([{ canonical_metric:'rainfall_mm', semantics:'interval', is_active:true }])).toBe(false); expect(maitDailyRainConfirmed([{ canonical_metric:'rainfall_mm', semantics:'daily_cumulative', is_active:false }])).toBe(false); });
  it('normalises module and channel identities without universal numbers', () => { expect(maitModules({ modules:[{ module_id:'99', description:'Weather' }] })).toMatchObject([{ id:'99',name:'Weather' }]); expect(maitChannels({ channels:[{ channel_number:43,label:'Custom',unit:'?',value:7 }] })).toMatchObject([{key:'43', number:43,label:'Custom',value:7}]); });
});
describe('MAIT controller imports', () => {
  it('requests three local days with exclusive end tomorrow across vintage boundary', () => expect(maitDateWindow('Australia/Sydney', new Date('2026-06-30T22:00:00Z'))).toEqual({ startDate:'2026-06-29', endDate:'2026-07-02' }));
  it('discovers unique outputs without deduplicating irrigation events', () => expect(maitOutputs({ events:[{channel_number:2,channel_name:'A'},{channel_number:2,channel_name:'A'},{channel_number:7,channel_name:'B'}] })).toEqual([{number:2,name:'A'},{number:7,name:'B'}]));
  it('flags HTTP 206 even without partial body', () => expect(maitHttpResult(206, {})).toMatchObject({partial:true}));
  it('flags partial=true on HTTP 200', () => expect(maitHttpResult(200, {partial:true})).toMatchObject({partial:true}));
  it('handles 204 without inventing counts', () => expect(maitHttpResult(204, {})).toMatchObject({empty:true}));
  it.each([401,403,400,500])('rejects HTTP %s', s => expect(() => maitHttpResult(s,{})).toThrow());
  it('shows partial warning and backend result counters', () => { render(<MaitSyncResult result={maitHttpResult(206,{received:10,committed:4,already_existing:2,needs_mapping:1,needs_review:2,possible_changed_event:1})} />); expect(screen.getByRole('status')).toHaveTextContent(MAIT_PARTIAL_WARNING); expect(screen.getByRole('status')).toHaveTextContent('Committed4'); expect(screen.getByRole('status')).toHaveTextContent('Already existing2'); });
  it('labels canonical imported records without changing them', () => { const s = {source_type:'controller_api',configuration_snapshot:{import:{provider:'mait_intelliweb'}}}; expect(irrigationSessionSourceLabel(s)).toBe('MAIT iNTELLiWeb'); expect(s.source_type).toBe('controller_api'); });
});
