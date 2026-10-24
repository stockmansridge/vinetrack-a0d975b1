import { maitConfigurationFixture, maitInspectFixture, maitIntegrationStatusFixture, maitSyncFixture, maitSyncStatusFixture } from './fixtures/maitLiveContract';
import { MAIT_METRICS } from '@/lib/maitIntelliwebQuery';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MaitWeatherCard } from '@/components/mait/MaitWeatherCard';
import { MaitControllerCard } from '@/components/mait/MaitControllerCard';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), manage: true, connected: false, conflict: false, config: {} as ReturnType<typeof maitConfigurationFixture> }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: async () => ({data:{session:{access_token:'fixture'}}}) } }, IOS_SUPABASE_URL:'https://example.test', IOS_SUPABASE_ANON_KEY:'public' }));
vi.mock('@/lib/vineyardSettingsQuery', () => ({ fetchVineyard: async () => ({timezone:'Australia/Sydney'}) }));
vi.mock('@/lib/irrigationQuery', () => ({ useIrrigationSystems: () => ({ data:[{id:'system',name:'East system'}] }), useIrrigationValves: () => ({data:[{id:'valve',name:'East valve',irrigation_system_id:'system'}]}) }));
function mount(ui: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>); }
beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.manage=true; mocks.connected=false; mocks.conflict=false; mocks.config=maitConfigurationFixture(); mocks.rpc.mockImplementation(async (name:string,args:any) => {
  if (name === 'has_mait_intelliweb_manage_access') return {data:mocks.manage};
  if (name === 'has_mait_intelliweb_view_access') return {data:true};
  if (name === 'get_vineyard_weather_integration') return {data:mocks.connected ? [maitIntegrationStatusFixture] : []};
  if (name === 'get_mait_intelliweb_configuration') return {data:mocks.connected ? mocks.config : {}};
  if (name === 'set_mait_intelliweb_controller_module') mocks.config.modules.push({id:'new-row',module_id:args.p_module_id,module_name:args.p_module_name,module_role:'irrigation_controller',irrigation_system_id:args.p_irrigation_system_id,is_active:true,metadata:{},updated_at:null});
  if (name === 'set_mait_intelliweb_weather_module') { mocks.config.modules = mocks.config.modules.filter(m=>m.module_role!=='weather'); mocks.config.modules.push({id:'new-weather',module_id:args.p_module_id,module_name:args.p_module_name,module_role:'weather',irrigation_system_id:null,is_active:true,metadata:{},updated_at:null}); }
  if (name === 'get_mait_intelliweb_controller_mappings') return {data:[{external_valve_number:2,external_valve_name:'Output two',irrigation_valve_id:'old-valve',irrigation_valve_name:'Old valve'}]};
  if (name === 'set_irrigation_controller_valve_mapping' && mocks.conflict && !args.p_confirm_change) return {error:{message:'mapping_conflict: Old valve → East valve'}};
  return {data:true};
}); vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url,init) => { const b=JSON.parse(init.body); if(b.action==='inspect_module') return new Response(JSON.stringify(maitInspectFixture)); return new Response(JSON.stringify({ok:true,network_name:'Farm network',modules:[{module_id:'weather',description:'Weather'},{module_id:'new-module',description:'New module'}]})); })); });
describe('MAIT setup actions', () => {
  it('hides credential management from view-only members', async () => { mocks.manage=false; mount(<MaitWeatherCard vineyardId="v" />); await screen.findByText('Your vineyard owner or manager manages this MAIT connection.'); expect(screen.queryByRole('button',{name:'Connect MAIT'})).not.toBeInTheDocument(); expect(mocks.rpc.mock.calls.some(c=>c[0]==='get_mait_intelliweb_configuration')).toBe(false); });
  it('requires successful test before save and keeps typed password out of RPC until save', async () => {
    mount(<MaitWeatherCard vineyardId="v" />); fireEvent.click(await screen.findByRole('button',{name:'Connect MAIT'}));
    fireEvent.change(screen.getByLabelText('Username'),{target:{value:'user'}}); fireEvent.change(screen.getByLabelText('Password'),{target:{value:'typed'}}); fireEvent.change(screen.getByLabelText('Network ID'),{target:{value:'network'}});
    expect(screen.getByRole('button',{name:'Save & continue'})).toBeDisabled(); fireEvent.click(screen.getByRole('button',{name:'Test connection'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save & continue'})).toBeEnabled());
    expect(mocks.rpc.mock.calls.some(c=>c[0]==='save_mait_intelliweb_connection')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Save & continue'}));
    await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('save_mait_intelliweb_connection',expect.objectContaining({p_password:'typed',p_timezone:'Australia/Sydney'})));
  });
  it('leaves saved password empty on edit and sends null after saved test', async () => {
    mocks.connected=true; mount(<MaitWeatherCard vineyardId="v" />); fireEvent.click(await screen.findByRole('button',{name:'Change credentials'}));
    expect(screen.getByLabelText('Password')).toHaveValue(''); fireEvent.click(screen.getByRole('button',{name:'Test connection'})); await waitFor(()=>expect(screen.getByRole('button',{name:'Save & continue'})).toBeEnabled()); fireEvent.click(screen.getByRole('button',{name:'Save & continue'})); await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('save_mait_intelliweb_connection',expect.objectContaining({p_password:null})));
  });
  it('never saves inspected channels automatically', async () => {
    mocks.connected=true; mount(<MaitWeatherCard vineyardId="v" />); fireEvent.click(await screen.findByRole('button',{name:'Inspect weather channels'})); await screen.findByRole('button',{name:'Confirm mapping'}); expect(mocks.rpc.mock.calls.some(c=>c[0]==='save_mait_intelliweb_channel_mapping')).toBe(false); expect(screen.getByRole('switch')).toBeDisabled();
  });
  it('does not expose controller management for view-only members', async () => { mocks.manage=false; mount(<MaitControllerCard vineyardId="v" />); await screen.findByText('Your vineyard owner or manager manages controller setup and imports.'); expect(screen.queryByRole('button',{name:'Sync now'})).not.toBeInTheDocument(); });
  it('links controller connection to shared Weather setup', async () => { mount(<MaitControllerCard vineyardId="v" />); expect(await screen.findByRole('link',{name:'Connect MAIT in Weather setup'})).toHaveAttribute('href','/setup/weather#mait'); });
  it('requires explicit conflict confirmation before retrying a valve mapping', async () => {
    mocks.connected=true; mocks.conflict=true; mount(<MaitControllerCard vineyardId="v" />);
    const chooser = await screen.findByRole('combobox',{name:'Choose controller module'}); fireEvent.click(chooser); fireEvent.click(await screen.findByRole('option',{name:'controller · Pump'}));
    const target = await screen.findByRole('combobox',{name:'Valve for MAIT output 2'}); fireEvent.click(target); fireEvent.click(await screen.findByRole('option',{name:'East valve'})); fireEvent.click(screen.getByRole('button',{name:'Save mapping'}));
    await screen.findByRole('dialog'); expect(mocks.rpc).toHaveBeenCalledWith('set_irrigation_controller_valve_mapping',expect.objectContaining({p_confirm_change:false,p_provider:'mait_intelliweb',p_external_controller_key:'network:controller',p_external_valve_number:2,p_irrigation_valve_id:'valve'}));
    expect(mocks.rpc.mock.calls.some(c=>c[1]?.p_confirm_change===true)).toBe(false); fireEvent.click(screen.getByRole('button',{name:'Confirm change'})); await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('set_irrigation_controller_valve_mapping',expect.objectContaining({p_confirm_change:true})));
  });
});

 describe('live configuration setup flows', () => {
  it('recognises a saved connection without a weather module and prefills nested credentials', async () => {
    mocks.connected=true; mocks.config.modules=[];
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button',{name:'Change credentials'}));
    expect(screen.getByLabelText('Username')).toHaveValue('user');
    expect(screen.getByLabelText('Network ID')).toHaveValue('network');
  });
  it('does not substitute station_id for a missing network_id', async () => {
    mocks.connected=true; (mocks.config.connection as any).network_id=null;
    const original=mocks.rpc.getMockImplementation();
    mocks.rpc.mockImplementation(async(name,args)=>name==='get_vineyard_weather_integration'?{data:[{...maitIntegrationStatusFixture,station_id:'MODULE_NOT_NETWORK'}]}:original?.(name,args));
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button',{name:'Change credentials'}));
    expect(screen.getByLabelText('Network ID')).toHaveValue('');
  });
  it('preselects saved weather module and inspects it using columns/latest', async () => {
    mocks.connected=true; mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByRole('combobox',{name:'Weather module'})).toHaveTextContent('weather · Weather');
    fireEvent.click(screen.getByRole('button',{name:'Inspect weather channels'}));
    await screen.findByRole('button',{name:'Confirm mapping'});
    const calls=(fetch as any).mock.calls.map((c:any)=>JSON.parse(c[1].body));
    expect(calls).toContainEqual({vineyardId:'v',action:'inspect_module',moduleId:'weather',scope:'existing'});
  });
  it.each(MAIT_METRICS)('saves exact backend metric %s', async (metric,label) => {
    mocks.connected=true; mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button',{name:'Inspect weather channels'}));
    const chooser=await screen.findByRole('combobox',{name:'Use channel Rain as'});
    if(metric!=='none') { fireEvent.click(chooser); fireEvent.click(await screen.findByRole('option',{name:label})); }
    if(metric==='rainfall') {fireEvent.click(screen.getByRole('combobox',{name:'Rainfall meaning'})); fireEvent.click(await screen.findByRole('option',{name:'Daily cumulative rainfall'}));}
    if(screen.queryByRole('button',{name:'Confirm conversion'})) fireEvent.click(screen.getByRole('button',{name:'Confirm conversion'}));
    fireEvent.click(screen.getByRole('button',{name:'Confirm mapping'}));
    await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('save_mait_intelliweb_channel_mapping',expect.objectContaining({p_module_id:'weather',p_channel_key:'Rain',p_channel_number:8,p_canonical_metric:metric,p_is_active:metric!=='none'})));
  });
  it('filters rainfall mappings by active saved module and disallows interval publication', async () => {
    mocks.connected=true;
    mocks.config.weather_mappings=[{module_id:'other',canonical_metric:'rainfall',semantics:'daily_cumulative',is_active:true},{module_id:'weather',canonical_metric:'rainfall',semantics:'interval',is_active:true}];
    mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByRole('switch')).toBeDisabled();
  });
  it('enables explicitly confirmed daily rainfall from weather_mappings', async () => {
    mocks.connected=true; mocks.config.weather_mappings=[{module_id:'weather',canonical_metric:'rainfall',semantics:'daily_cumulative',is_active:true}];
    mocks.config.connection.rainfall_publish_enabled=true;
    mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByRole('switch')).toBeEnabled(); expect(screen.getByRole('switch')).toBeChecked();
  });
  it('refreshes a newly saved controller from modules without remounting', async () => {
    mocks.connected=true; mocks.config.modules=mocks.config.modules.filter(m=>m.module_role!=='irrigation_controller');
    mount(<MaitControllerCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button',{name:'Load controller modules'}));
    fireEvent.click(screen.getByRole('combobox',{name:'Choose controller module'})); fireEvent.click(await screen.findByRole('option',{name:'new-module · New module'}));
    fireEvent.click(screen.getByRole('combobox',{name:'VineTrack Irrigation System'})); fireEvent.click(await screen.findByRole('option',{name:'East system'}));
    fireEvent.click(screen.getByRole('button',{name:'Save controller module'}));
    expect(await screen.findByRole('button',{name:'Discover recent outputs'})).toBeEnabled();
    await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('get_mait_intelliweb_controller_mappings',{p_vineyard_id:'v',p_module_id:'new-module'}));
  });
  it('warns on weather module change and inspects newly saved active module', async () => {
    mocks.connected=true; mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button',{name:'Load modules'}));
    fireEvent.click(screen.getByRole('combobox',{name:'Weather module'})); fireEvent.click(await screen.findByRole('option',{name:'new-module · New module'}));
    expect(screen.getByText('Changing the weather module requires reviewing its channel mappings.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Save weather module'}));
    await waitFor(()=>expect(screen.queryByText('Changing the weather module requires reviewing its channel mappings.')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Inspect weather channels'}));
    await screen.findByRole('button',{name:'Confirm mapping'});
    expect((fetch as any).mock.calls.map((c:any)=>JSON.parse(c[1].body))).toContainEqual({vineyardId:'v',action:'inspect_module',moduleId:'new-module',scope:'existing'});
  });
 });

 describe('final MAIT live status flows', () => {
  it('shows active raw integration to view-only users without network details', async () => {
    mocks.manage=false; mocks.connected=true; mount(<MaitWeatherCard vineyardId="v" />);
    await screen.findByText('Connected');
    expect(screen.getByText('Weather station')).toBeInTheDocument();
    expect(screen.queryByText(/Network ID/)).not.toBeInTheDocument();
    expect(mocks.rpc.mock.calls.some(c=>c[0]==='get_mait_intelliweb_configuration')).toBe(false);
  });
  it('does not mark inactive integration connected for view-only members', async () => {
    mocks.manage=false; const original=mocks.rpc.getMockImplementation();
    mocks.rpc.mockImplementation(async(name,args)=>name==='get_vineyard_weather_integration'?{data:[{...maitIntegrationStatusFixture,is_active:false}]}:original?.(name,args));
    mount(<MaitWeatherCard vineyardId="v" />);
    await screen.findByText('Your vineyard owner or manager manages this MAIT connection.');
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByText(/Network ID/)).not.toBeInTheDocument();
  });
  it('renders real sync_status envelope after checking selected controller', async () => {
    mocks.connected=true;
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(maitSyncStatusFixture))));
    mount(<MaitControllerCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('combobox',{name:'Choose controller module'}));
    fireEvent.click(await screen.findByRole('option',{name:'controller · Pump'}));
    fireEvent.click(await screen.findByRole('button',{name:'Check sync status'}));
    await screen.findByText('Last attempt');
    expect(screen.getByRole('status')).toHaveTextContent('Created / staged4');
    expect(screen.getByRole('status')).toHaveTextContent('Already existing2');
    expect(screen.queryByText('Committed')).not.toBeInTheDocument();
    expect((fetch as any).mock.calls.map((c:any)=>JSON.parse(c[1].body))).toContainEqual({vineyardId:'v',action:'sync_status'});
  });
  it('renders partial sync_usage success false through the manual sync flow', async () => {
    mocks.connected=true; const original=mocks.rpc.getMockImplementation();
    mocks.rpc.mockImplementation(async(name,args)=>name==='get_mait_intelliweb_controller_mappings'?{data:[{external_valve_number:2,irrigation_valve_id:'valve'}]}:original?.(name,args));
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(maitSyncFixture),{status:206})));
    mount(<MaitControllerCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('combobox',{name:'Choose controller module'}));
    fireEvent.click(await screen.findByRole('option',{name:'controller · Pump'}));
    const sync=await screen.findByRole('button',{name:'Sync now'}); await waitFor(()=>expect(sync).toBeEnabled());
    fireEvent.click(sync);
    await screen.findByText('Committed');
    expect(screen.getByRole('status')).toHaveTextContent('Committed4');
    expect(screen.getByRole('status')).toHaveTextContent('partial/truncated');
  });
 });
