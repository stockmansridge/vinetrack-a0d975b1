import { maitConfigurationFixture, maitInspectFixture, maitSyncFixture, maitSyncStatusFixture } from './fixtures/maitLiveContract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MaitSyncResult, MaitSyncStatus } from '@/components/mait/MaitControllerCard';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession } }, IOS_SUPABASE_URL: 'https://example.test', IOS_SUPABASE_ANON_KEY: 'public' }));
import { maitAccess, saveMaitConnection, maitConversion, maitDateWindow, maitHttpResult, maitProxy, maitModules, maitChannels, maitOutputs, maitDailyRainConfirmed, irrigationSessionSourceLabel, MAIT_PARTIAL_WARNING, MAIT_METRICS, maitConfiguration, maitWeatherReady, maitSyncCounts, maitControllerSyncState } from '@/lib/maitIntelliwebQuery';
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
  it.each([['°F', 'air_temperature', 5/9, -32*5/9], ['m/s', 'wind_speed', 3.6, 0], ['mph', 'wind_gust', 1.609344, 0], ['cm', 'rainfall', 10, 0], ['inches', 'rainfall', 25.4, 0], ['°C', 'air_temperature', 1, 0], ['kph', 'wind_speed', 1, 0], ['%', 'relative_humidity', 1, 0], ['deg', 'wind_direction', 1, 0]])('converts %s for %s', (u,m,a,b) => expect(maitConversion(u,m)).toEqual({ multiplier:a, offset:b }));
  it('does not guess unknown or dimensionally incorrect units', () => { expect(maitConversion('unknown', 'air_temperature')).toBeNull(); expect(maitConversion('mph','rainfall')).toBeNull(); });
  it('only allows active explicitly daily cumulative rainfall', () => { expect(maitDailyRainConfirmed([{ canonical_metric:'rainfall', semantics:'daily_cumulative', is_active:true }])).toBe(true); expect(maitDailyRainConfirmed([{ canonical_metric:'rainfall', semantics:'interval', is_active:true }])).toBe(false); expect(maitDailyRainConfirmed([{ canonical_metric:'rainfall', semantics:'daily_cumulative', is_active:false }])).toBe(false); });
  it('normalises module and channel identities without universal numbers', () => { expect(maitModules({ modules:[{ module_id:'99', description:'Weather' }] })).toMatchObject([{ id:'99',name:'Weather' }]); expect(maitChannels(maitInspectFixture)).toMatchObject([{key:'Rain', number:8,label:'Rain',unit:'mm',value:'3'}]); });
});
describe('MAIT controller imports', () => {
  it('requests three local days with exclusive end tomorrow across vintage boundary', () => expect(maitDateWindow('Australia/Sydney', new Date('2026-06-30T22:00:00Z'))).toEqual({ startDate:'2026-06-29', endDate:'2026-07-02' }));
  it('discovers unique outputs without deduplicating irrigation events', () => expect(maitOutputs({ events:[{channel_number:2,channel_name:'A'},{channel_number:2,channel_name:'A'},{channel_number:7,channel_name:'B'}] })).toEqual([{number:2,name:'A'},{number:7,name:'B'}]));
  it('flags HTTP 206 even without partial body', () => expect(maitHttpResult(206, {})).toMatchObject({partial:true}));
  it('flags partial=true on HTTP 200', () => expect(maitHttpResult(200, {partial:true})).toMatchObject({partial:true}));
  it('handles 204 without inventing counts', () => expect(maitHttpResult(204, {})).toMatchObject({empty:true}));
  it.each([401,403,400,500])('rejects HTTP %s', s => expect(() => maitHttpResult(s,{})).toThrow());
  it('shows partial warning and backend result counters', () => { render(<MaitSyncResult result={maitHttpResult(206,maitSyncFixture)} />); expect(screen.getByRole('status')).toHaveTextContent(MAIT_PARTIAL_WARNING); expect(screen.getByRole('status')).toHaveTextContent('Committed4'); expect(screen.getByRole('status')).toHaveTextContent('Already existing2'); });
  it('labels canonical imported records without changing them', () => { const s = {source_type:'controller_api',configuration_snapshot:{import:{provider:'mait_intelliweb'}}}; expect(irrigationSessionSourceLabel(s)).toBe('MAIT iNTELLiWeb'); expect(s.source_type).toBe('controller_api'); });
});

 describe('live MAIT configuration contract', () => {
  it('detects nested saved connection before module selection', () => {
    const fixture = maitConfigurationFixture(); fixture.modules = [];
    expect(maitConfiguration(fixture).connection).toMatchObject({configured:true, network_id:'network', username:'user'});
    expect(maitConfiguration(fixture).weatherModule).toBeUndefined();
  });
  it('selects only active weather/controller module roles and retains mappings/sync', () => {
    const fixture = maitConfigurationFixture();
    fixture.modules.unshift({...fixture.modules[0], module_id:'inactive', is_active:false});
    fixture.weather_mappings.push({module_id:'weather',canonical_metric:'rainfall'});
    const config = maitConfiguration(fixture);
    expect(config.weatherModule?.module_id).toBe('weather');
    expect(config.controllerModules.map(m=>m.module_id)).toEqual(['controller']);
    expect(config.weatherMappings).toEqual(fixture.weather_mappings);
    expect(config.sync).toEqual(fixture.sync);
  });
  it('never uses station_id as network identity or connection evidence', () => {
    expect(maitConfiguration({station_id:'weather'}).connection.network_id).toBeUndefined();
    expect(maitConfiguration({station_id:'weather'}).connection.configured).toBeUndefined();
  });
  it('offers exactly backend-constrained metrics including none', () => {
    expect(MAIT_METRICS.map(([id])=>id)).toEqual(['air_temperature','relative_humidity','wind_speed','wind_direction','wind_gust','rainfall','rain_rate','leaf_wetness','soil_moisture','soil_temperature','none']);
    expect(maitConversion('unknown','none')).toEqual({multiplier:1,offset:0});
  });
  it('ready state requires active canonical mapping for the saved weather module', () => {
    const fixture = maitConfigurationFixture();
    fixture.weather_mappings = [{module_id:'weather',is_active:true,canonical_metric:'air_temperature'}];
    expect(maitWeatherReady(maitConfiguration(fixture))).toBe(true);
    for (const mapping of [ {module_id:'other',is_active:true,canonical_metric:'air_temperature'}, {module_id:'weather',is_active:true,canonical_metric:'none'}, {module_id:'weather',is_active:false,canonical_metric:'air_temperature'}, {module_id:'weather',is_active:true,canonical_metric:'temperature_c'} ]) {
      fixture.weather_mappings=[mapping]; expect(maitWeatherReady(maitConfiguration(fixture))).toBe(false);
    }
  });
  it('requires rainfall, not output field names, for daily publication', () => {
    expect(maitDailyRainConfirmed([{canonical_metric:'rainfall_mm',semantics:'daily_cumulative',is_active:true}])).toBe(false);
  });
  it('keeps missing readings empty and zero readings visible', () => {
    expect(maitChannels({...maitInspectFixture, latest:{Rain:0}})[0].value).toBe(0);
    expect(maitChannels({...maitInspectFixture, latest:{}})[0].value).toBeNull();
  });
  it('uses existing count, never already_existing', () => {
    expect(maitSyncCounts({...maitSyncFixture,already_existing:99}).find(([label])=>label==='Already existing')?.[1]).toBe(2);
  });
  it('rejects live success:false result', () => expect(()=>maitHttpResult(200,{success:false})).toThrow());
 });

 describe('final MAIT contract guards', () => {
  it('accepts HTTP 206 success false as partial while retaining counters', () => {
    expect(maitHttpResult(206,{success:false,partial:true,received:10})).toEqual({data:{success:false,partial:true,received:10},status:206,partial:true,empty:false});
  });
  it('rejects explicit errors even on HTTP 206', () => expect(()=>maitHttpResult(206,{success:false,partial:true,error:'failed'})).toThrow());
  it.each(['DateTime','date time',' DATE TIME '])('excludes timestamp channel %s', key => {
    expect(maitChannels({...maitInspectFixture,columns:[{channel_key:key},maitInspectFixture.columns[1]]}).map(row=>row.key)).toEqual(['Rain']);
  });
  it('selects sync state by both module id and irrigation_usage kind', () => {
    const selected=maitSyncStatusFixture.sync[0];
    expect(maitControllerSyncState({sync:[{...selected,module_id:'other',records_received:99},{...selected,sync_kind:'weather',records_received:88},selected]},'controller')).toEqual(selected);
    expect(maitControllerSyncState(maitSyncStatusFixture,'missing')).toBeUndefined();
  });
  it('renders sync state counters separately and warns about incomplete range', () => {
    render(<MaitSyncStatus data={maitSyncStatusFixture} moduleId="controller" timezone="Australia/Sydney" />);
    expect(screen.getByRole('status')).toHaveTextContent(MAIT_PARTIAL_WARNING);
    expect(screen.getByRole('status')).toHaveTextContent('Received10');
    expect(screen.getByRole('status')).toHaveTextContent('Created / staged4');
    expect(screen.getByRole('status')).toHaveTextContent('Already existing2');
    expect(screen.getByRole('status')).toHaveTextContent('Needs mapping1');
    expect(screen.getByRole('status')).toHaveTextContent('Needs review3');
    expect(screen.getByRole('status')).toHaveTextContent('Last attempt');
    expect(screen.getByRole('status')).toHaveTextContent('Last success');
    expect(screen.getByRole('status')).not.toHaveTextContent('Committed');
  });
  it('complete sync state remains complete', () => {
    render(<MaitSyncStatus data={{sync:[{...maitSyncStatusFixture.sync[0],incomplete_range:false}]}} moduleId="controller" timezone="Australia/Sydney" />);
    expect(screen.queryByText(MAIT_PARTIAL_WARNING)).not.toBeInTheDocument();
  });
  it('has no fabricated counters when selected module has no state', () => {
    render(<MaitSyncStatus data={maitSyncStatusFixture} moduleId="missing" timezone="Australia/Sydney" />);
    expect(maitControllerSyncState(maitSyncStatusFixture,'missing')).toBeUndefined();
    expect(screen.getByRole('status')).not.toHaveTextContent('Received10');
  });
 });
