import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PermanentItemEditor from '@/components/permanent-items/PermanentItemEditor';
import PermanentItemsPanel from '@/components/permanent-items/PermanentItemsPanel';
import { usePermanentItemsAccess } from '@/components/permanent-items/usePermanentItems';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
const m = vi.hoisted(() => ({ admin:true, flag:true, member:true, vineyard:'v', user:'u', rpc:vi.fn(), from:vi.fn(), rows:[] as any[], types:[] as any[], manage:true, hardDelete:false, demo:false }));
vi.mock('@/lib/systemAdmin', () => ({ useIsSystemAdmin: () => ({ isAdmin:m.admin,loading:false }), useFeatureFlag: (key:string) => key === 'permanent_items_admin_preview' && m.flag }));
vi.mock('@/context/DemoModeContext', () => ({ useDemoMode: () => ({ demoMode:m.demo, setDemoMode:()=>{}, toggleDemoMode:()=>{} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user:{ id:m.user },loading:false }) }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ selectedVineyardId:m.vineyard,memberships:m.member ? [{ vineyard_id:m.vineyard }] : [],loading:false }) }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase:{ rpc:m.rpc,from:m.from } }));
vi.mock('@/lib/queries', () => ({ fetchList:async () => [] }));
vi.mock('@/components/manual-issues/ManualIssuesAppleMap', () => ({ default: ({ onPick }:any) => <button onClick={() => onPick?.(-34,138)}>Choose map location</button> }));
function mount(ui:React.ReactNode) { const qc = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}); return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); m.admin=true;m.flag=true;m.member=true;m.vineyard='v';m.user='u';m.rows=[];m.types=[];m.manage=true;m.hardDelete=false;m.demo=false;readOnlyStore.setReadOnly(false);
  m.rpc.mockImplementation(async () => ({data:[{can_read:m.flag && m.member && (m.admin || m.hardDelete),can_manage:m.flag && m.member && m.admin && m.manage,can_hard_delete:m.flag && m.member && m.hardDelete}],error:null}));
  m.from.mockImplementation((table:string)=>{const chain:any = {select:()=>chain,eq:()=>chain,order:async()=>({ data:table==='permanent_item_types'?m.types:m.rows,error:null }),single:async()=>({ data:m.rows[0],error:null })};return chain;});
});
afterEach(() => { cleanup();readOnlyStore.setReadOnly(false); });
it.each(['flag off','normal user','nonmember'])('direct editor and list are gated for %s', async kind => {
  if(kind==='flag off')m.flag=false;if(kind==='normal user')m.admin=false;if(kind==='nonmember')m.member=false;
  mount(<><PermanentItemEditor item={null} onClose={() => {}} /><PermanentItemsPanel onSelect={() => {}} /></>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(m.from).not.toHaveBeenCalled();
  if(kind==='nonmember')await waitFor(()=>expect(m.rpc).toHaveBeenCalledWith('permanent_item_permissions_v1',{p_vineyard_id:'v'}));else expect(m.rpc).not.toHaveBeenCalled();
});
it('fails closed in Demo Mode: no permissions RPC, no list query, no editor, no delete', async () => {
  m.demo=true;m.hardDelete=true;
  function Gate(){ const a=usePermanentItemsAccess();return a.allowed ? <button>Permanent Item</button> : <span>hidden</span>; }
  mount(<><Gate/><PermanentItemEditor item={null} onClose={() => {}} /><PermanentItemsPanel onSelect={() => {}} /></>);
  expect(screen.getByText('hidden')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Permanent Item'})).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await new Promise(r=>setTimeout(r,50));
  expect(m.rpc).not.toHaveBeenCalled();expect(m.from).not.toHaveBeenCalled();
});
it('recovers access when Demo Mode is turned off', async () => {
  m.demo=true;
  function Gate(){ const {allowed}=usePermanentItemsAccess();return allowed ? <button>Permanent Item</button> : null; }
  const view=mount(<Gate/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();
  m.demo=false;view.rerender(<QueryClientProvider client={new QueryClient()}><Gate/></QueryClientProvider>);
  expect(await screen.findByRole('button',{name:'Permanent Item'})).toBeInTheDocument();
});
it('honours disabled flag in the action gate', () => {
  function Gate(){ const {allowed}=usePermanentItemsAccess();return allowed ? <button>Permanent Item</button> : null; }
  m.flag=false;mount(<Gate/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('creates with explicit map coordinates and shows Synced only after read-back',async()=>{
  m.rpc.mockImplementation(async (rpc:string,op:any)=> {if(rpc==='permanent_item_permissions_v1')return {data:[{can_read:true,can_manage:true,can_hard_delete:false}],error:null};m.rows=[{ id:op.p_item_id,vineyard_id:'v',name:op.p_name,item_type:op.p_item_type,latitude:op.p_latitude,longitude:op.p_longitude,notes:null,paddock_id:null,photo_path:null,server_revision:1,archived_at:null }];return {data:[{ item_id:op.p_item_id,server_revision:1,archived_at:null,operation_id:op.p_operation_id }],error:null};});
  mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);
  fireEvent.change(await screen.findByLabelText('Name'),{target:{value:'Pump'}});fireEvent.click(screen.getByText('Choose map location'));fireEvent.click(screen.getByRole('button',{name:'Create item'}));
  expect(await screen.findByText('Synced · revision 1')).toBeInTheDocument();expect(m.rpc).toHaveBeenCalledWith('apply_permanent_item_v1',expect.objectContaining({p_expected_revision:null,p_latitude:-34,p_longitude:138}));
});
it('blocks read-only saves and stale vineyard access',async()=>{
  readOnlyStore.setReadOnly(true);mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);expect(await screen.findByRole('button',{name:'Create item'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Create item'}));expect(m.rpc).not.toHaveBeenCalledWith('apply_permanent_item_v1',expect.anything());
});
it('keeps retries on immutable intent after a network failure',async()=>{
  m.rpc.mockImplementation(async (rpc:string) => { if(rpc==='permanent_item_permissions_v1')return {data:[{can_read:true,can_manage:true,can_hard_delete:false}],error:null};throw new Error('Network uncertain'); });mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);
  fireEvent.change(await screen.findByLabelText('Name'),{target:{value:'Pump'}});fireEvent.click(screen.getByText('Choose map location'));fireEvent.click(screen.getByRole('button',{name:'Create item'}));
  await screen.findByText('Network uncertain');fireEvent.click(screen.getByRole('button',{name:'Retry same operation'}));await waitFor(()=>expect(m.rpc.mock.calls.filter(c=>c[0]==='apply_permanent_item_v1')).toHaveLength(2));const calls=m.rpc.mock.calls.filter(c=>c[0]==='apply_permanent_item_v1');expect(calls[0][1]).toBe(calls[1][1]);expect(screen.getByLabelText('Name')).toBeDisabled();
});
it('filters separate items by search without querying pins',async()=>{
  m.rows=[{id:'i',name:'Pump',item_type:'pump',latitude:-34,longitude:138,server_revision:1,archived_at:null}];mount(<PermanentItemsPanel onSelect={()=>{}}/>);
  await screen.findByRole('button',{name:/Pump/});fireEvent.change(screen.getByLabelText('Search Permanent Items'),{target:{value:'gate'}});expect(screen.queryByRole('button',{name:/Pump/})).not.toBeInTheDocument();expect(m.from).toHaveBeenCalledWith('permanent_items');expect(m.from).not.toHaveBeenCalledWith('pins');
});
it('revokes an open editor when vineyard changes and never submits old scope',async()=>{
  const editor=<PermanentItemEditor item={null} onClose={()=>{}}/>;const view=mount(editor);expect(await screen.findByRole('dialog')).toBeInTheDocument();
  m.vineyard='other';view.rerender(<QueryClientProvider client={new QueryClient()}>{editor}</QueryClientProvider>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(m.rpc).not.toHaveBeenCalledWith('apply_permanent_item_v1',expect.anything());
});
it('requires archive confirmation and preserves current revision',async()=>{
  const item:any={id:'i',vineyard_id:'v',name:'Pump',item_type:'pump',latitude:-34,longitude:138,notes:null,paddock_id:null,photo_path:null,server_revision:4,archived_at:null};
  m.rpc.mockImplementation(async(rpc:string,op:any)=>{if(rpc==='permanent_item_permissions_v1')return {data:[{can_read:true,can_manage:true,can_hard_delete:false}],error:null};m.rows=[{...item,server_revision:5,archived_at:'now'}];return {data:[{ item_id:'i',server_revision:5,archived_at:'now',operation_id:op.p_operation_id }],error:null};});
  mount(<PermanentItemEditor item={item} onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'Archive'}));expect(m.rpc).not.toHaveBeenCalledWith('apply_permanent_item_v1',expect.anything());fireEvent.click(screen.getByRole('button',{name:'Confirm archive'}));
  await screen.findByText('Synced · revision 5 · Archived');expect(m.rpc).toHaveBeenCalledWith('apply_permanent_item_v1',expect.objectContaining({p_action:'archive',p_item_id:'i',p_expected_revision:4}));
});
const custom={id:'type-id',vineyard_id:'v',type_key:`custom_${'a'.repeat(32)}`,name:'Weather station',color_hex:'#2478C4'};
it('adds a vineyard type once and selects it only after verified save',async()=>{
  const permission={data:[{can_read:true,can_manage:true,can_hard_delete:false}],error:null};
  let resolve: (value:any)=>void=()=>{};
  m.rpc.mockImplementation((rpc:string)=>rpc==='permanent_item_permissions_v1'?Promise.resolve(permission):new Promise(r=>{resolve=r;}));
  mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Add Vineyard Type'}));
  fireEvent.change(screen.getByLabelText('Type name'),{target:{value:' Weather station '}});
  fireEvent.change(screen.getByLabelText('Colour hex'),{target:{value:'#2478C4'}});
  fireEvent.click(screen.getByRole('button',{name:'Add Type'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Adding…'})).toBeDisabled());
  expect(screen.getByLabelText('Type')).not.toHaveTextContent('Weather station');
  m.types=[custom];resolve({data:[custom],error:null});
  await waitFor(()=>expect(screen.getByLabelText('Type')).toHaveTextContent('Weather station'));
  expect(m.rpc.mock.calls.filter(c=>c[0]==='create_permanent_item_type_v1')).toHaveLength(1);
  expect(m.rpc).toHaveBeenCalledWith('create_permanent_item_type_v1',{p_vineyard_id:'v',p_name:'Weather station',p_color_hex:'#2478C4'});
});
it('shows duplicate type errors and does not change selection',async()=>{
  m.rpc.mockImplementation(async(rpc:string)=>rpc==='permanent_item_permissions_v1'?{data:[{can_read:true,can_manage:true,can_hard_delete:false}],error:null}:{data:null,error:{message:'Duplicate vineyard type'}});
  mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'Add Vineyard Type'}));
  fireEvent.change(screen.getByLabelText('Type name'),{target:{value:'Pump'}});fireEvent.click(screen.getByRole('button',{name:'Add Type'}));
  expect(await screen.findByText('Duplicate vineyard type')).toBeInTheDocument();expect(screen.getByLabelText('Type')).toHaveTextContent('Other');
});
it.each(['account','vineyard'])('fails closed on %s switch during custom type save',async kind=>{
  let resolve:(value:any)=>void=()=>{};
  m.rpc.mockImplementation((rpc:string)=>rpc==='permanent_item_permissions_v1'?Promise.resolve({data:[{can_read:true,can_manage:true,can_hard_delete:false}],error:null}):new Promise(r=>{resolve=r;}));
  const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={qc}><PermanentItemEditor item={null} onClose={()=>{}}/></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Add Vineyard Type'}));fireEvent.change(screen.getByLabelText('Type name'),{target:{value:'Weather station'}});fireEvent.click(screen.getByRole('button',{name:'Add Type'}));
  await waitFor(()=>expect(m.rpc).toHaveBeenCalledWith('create_permanent_item_type_v1',expect.anything()));
  if(kind==='account')m.user='other';else m.vineyard='other';
  view.rerender(<QueryClientProvider client={qc}><PermanentItemEditor item={null} onClose={()=>{}}/></QueryClientProvider>);
  resolve({data:[custom],error:null});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(qc.getQueryData(['permanent-item-types','v','u'])).not.toEqual([custom]);
});
it('looks up a shared custom type for list and existing pin editor',async()=>{
  m.types=[custom];const item:any={id:'i',vineyard_id:'v',name:'Hill sensor',item_type:custom.type_key,latitude:-34,longitude:138,server_revision:1,archived_at:null};m.rows=[item];
  mount(<><PermanentItemsPanel onSelect={()=>{}}/><PermanentItemEditor item={item} onClose={()=>{}}/></>);
  await waitFor(()=>expect(screen.getByLabelText('Permanent Items list')).toHaveTextContent('Weather station'));
  await waitFor(()=>expect(screen.getByLabelText('Type')).toHaveTextContent('Weather station'));expect(m.from).toHaveBeenCalledWith('permanent_item_types');expect(m.from).not.toHaveBeenCalledWith('pins');
});
it('retains temporary System Admin testing gate even when server returns Supervisor deletion permission',async()=>{
  m.admin=false;m.hardDelete=true;
  mount(<PermanentItemsPanel onSelect={()=>{}}/>);await new Promise(r=>setTimeout(r,25));expect(m.rpc).not.toHaveBeenCalled();expect(m.from).not.toHaveBeenCalled();
});