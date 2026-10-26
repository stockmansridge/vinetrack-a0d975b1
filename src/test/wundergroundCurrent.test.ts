import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshWundergroundObservations, getWundergroundConfig } from '@/lib/wundergroundProxy';
import { mapLiveWeatherRow } from '@/lib/weatherStatusQuery';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), fetch: vi.fn() }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession } } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-session' } } });
  vi.stubGlobal('fetch', mocks.fetch);
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('WU current observation transport', () => {
  it('sends current and vineyard only to the authenticated proxy, leaving station resolution server-side', async () => {
    mocks.fetch.mockResolvedValue(response({ success: true }));
    expect(await refreshWundergroundObservations('v')).toMatchObject({ ok: true });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/wunderground-proxy$/);
    expect(JSON.parse(init.body)).toEqual({ action: 'current', vineyardId: 'v' });
    expect(init.headers.Authorization).toBe('Bearer test-session');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not issue a WU request without a signed-in session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    expect(await refreshWundergroundObservations('v')).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('preserves explicit proxy failure code and data for callers without inventing a station diagnosis', async () => {
    // Generic documented helper envelope, not a claimed live WU error code.
    const body = { success: false, code: 'fixture_failure', message: 'Fixture provider failure' };
    mocks.fetch.mockResolvedValue(response(body, 502));
    expect(await refreshWundergroundObservations('v')).toMatchObject({ ok: false, code: 'fixture_failure', message: body.message, data: body });
  });
  it('reads the configured station from the WU configuration RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ station_id: 'TESTSTATION', station_name: 'Fixture', is_active: true }] });
    expect(await getWundergroundConfig('v')).toMatchObject({ configured: true, station_id: 'TESTSTATION', is_active: true });
    expect(mocks.rpc).toHaveBeenCalledWith('get_vineyard_wunderground_config', { p_vineyard_id: 'v' });
  });
});

describe('WU normalized timestamp and freshness contract', () => {
  it('preserves timestamp/source and server stale=true even for a recent timestamp', () => {
    const observed = new Date().toISOString();
    expect(mapLiveWeatherRow({ status: 'ok', source: 'wunderground_pws', observed_at: observed, temperature_c: 18, is_stale: true })).toMatchObject({
      available: true, stale: true, reading: { source: 'wunderground_pws', observed_at: observed },
    });
  });
  it('does not apply a separate client age threshold when server stale=false', () => {
    expect(mapLiveWeatherRow({ status: 'ok', source: 'wunderground_pws', observed_at: '2000-01-01T00:00:00Z', temperature_c: 18, is_stale: false })).toMatchObject({ available: true, stale: false });
  });
  it('keeps no cached data distinct from a cached stale observation', () => {
    expect(mapLiveWeatherRow({ status: 'no_data' })).toMatchObject({ available: false, reason: 'no_data' });
    expect(mapLiveWeatherRow({ status: 'ok', source: 'wunderground_pws', temperature_c: 18, is_stale: true })).toMatchObject({ available: true, stale: true });
  });
});