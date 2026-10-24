import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MaitWeatherCard } from '@/components/mait/MaitWeatherCard';
import { MaitControllerCard } from '@/components/mait/MaitControllerCard';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), manage: true, connected: false, conflict: false }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: async () => ({data:{session:{access_token:'fixture'}}}) } }, IOS_SUPABASE_URL:'https://example.test', IOS_SUPABASE_ANON_KEY:'public' }));
vi.mock('@/lib/vineyardSettingsQuery', () => ({ fetchVineyard: async () => ({timezone:'Australia/Sydney'}) }));
vi.mock('@/lib/irrigationQuery', () => ({ useIrrigationSystems: () => ({ data:[{id:'system',name:'East system'}] }), useIrrigationValves: () => ({data:[{id:'valve',name:'East valve',irrigation_system_id:'system'}]}) }));
function mount(ui: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>); }
beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.manage=true; mocks.connected=false; mocks.conflict=false; mocks.rpc.mockImplementation(async (name:string,args:any) => {
  if (name === 'has_mait_intelliweb_manage_access') return {data:mocks.manage};
  if (name === 'has_mait_intelliweb_view_access') return {data:true};
  if (name === 'get_vineyard_weather_integration') return {data:{configured:mocks.connected}};
  if (name === 'get_mait_intelliweb_configuration') return {data:mocks.connected ? {configured:true,username:'user',network_id:'network',network_name:'Farm network',timezone:'Australia/Sydney',weather_module_id:'weather',channel_mappings:[],controller_modules:[{module_id:'controller',module_name:'Pump',irrigation_system_id:'system'}]} : {}};
  if (name === 'get_mait_intelliweb_controller_mappings') return {data:[{external_valve_number:2,external_valve_name:'Output two',irrigation_valve_id:'old-valve',irrigation_valve_name:'Old valve'}]};
  if (name === 'set_irrigation_controller_valve_mapping' && mocks.conflict && !args.p_confirm_change) return {error:{message:'mapping_conflict: Old valve → East valve'}};
  return {data:true};
}); vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url,init) => { const b=JSON.parse(init.body); if(b.action==='inspect_module') return new Response(JSON.stringify({channels:[{channel_number:8,label:'Rain',unit:'mm',value:3}]})); return new Response(JSON.stringify({ok:true,network_name:'Farm network',modules:[{module_id:'weather',description:'Weather'}]})); })); });
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
