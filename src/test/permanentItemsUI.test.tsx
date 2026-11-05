import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PermanentItemEditor from '@/components/permanent-items/PermanentItemEditor';
import PermanentItemsPanel from '@/components/permanent-items/PermanentItemsPanel';
import { usePermanentItemsAccess } from '@/components/permanent-items/usePermanentItems';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
const m = vi.hoisted(() => ({ admin:true, flag:true, member:true, vineyard:'v', rpc:vi.fn(), from:vi.fn(), rows:[] as any[] }));
vi.mock('@/lib/systemAdmin', () => ({ useIsSystemAdmin: () => ({ isAdmin:m.admin,loading:false }), useFeatureFlag: (key:string) => key === 'permanent_items_admin_preview' && m.flag }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user:{ id:'u' },loading:false }) }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ selectedVineyardId:m.vineyard,memberships:m.member ? [{ vineyard_id:m.vineyard }] : [],loading:false }) }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase:{ rpc:m.rpc,from:m.from } }));
vi.mock('@/lib/queries', () => ({ fetchList:async () => [] }));
vi.mock('@/components/manual-issues/ManualIssuesAppleMap', () => ({ default: ({ onPick }:any) => <button onClick={() => onPick?.(-34,138)}>Choose map location</button> }));
function mount(ui:React.ReactNode) { const qc = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}); return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); m.admin=true;m.flag=true;m.member=true;m.vineyard='v';m.rows=[];readOnlyStore.setReadOnly(false);
  const chain:any = {select:()=>chain,eq:()=>chain,order:async()=>({ data:m.rows,error:null }),single:async()=>({ data:m.rows[0],error:null })};m.from.mockReturnValue(chain);
});
afterEach(() => { cleanup();readOnlyStore.setReadOnly(false); });
it.each(['flag off','normal user','nonmember'])('direct editor and list are gated for %s', kind => {
  if(kind==='flag off')m.flag=false;if(kind==='normal user')m.admin=false;if(kind==='nonmember')m.member=false;
  mount(<><PermanentItemEditor item={null} onClose={() => {}} /><PermanentItemsPanel onSelect={() => {}} /></>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(m.from).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});
it('honours disabled flag in the action gate', () => {
  function Gate(){ const {allowed}=usePermanentItemsAccess();return allowed ? <button>Permanent Item</button> : null; }
  m.flag=false;mount(<Gate/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('creates with explicit map coordinates and shows Synced only after read-back',async()=>{
  m.rpc.mockImplementation(async (_:string,op:any)=> {m.rows=[{ id:op.p_item_id,vineyard_id:'v',name:op.p_name,item_type:op.p_item_type,latitude:op.p_latitude,longitude:op.p_longitude,notes:null,paddock_id:null,photo_path:null,server_revision:1,archived_at:null }];return {data:m.rows[0],error:null};});
  mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Pump'}});fireEvent.click(screen.getByText('Choose map location'));fireEvent.click(screen.getByRole('button',{name:'Create item'}));
  expect(await screen.findByText('Synced · revision 1')).toBeInTheDocument();expect(m.rpc).toHaveBeenCalledWith('apply_permanent_item_v1',expect.objectContaining({p_expected_revision:null,p_latitude:-34,p_longitude:138}));
});
it('blocks read-only saves and stale vineyard access',async()=>{
  readOnlyStore.setReadOnly(true);mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);expect(screen.getByRole('button',{name:'Create item'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Create item'}));expect(m.rpc).not.toHaveBeenCalled();
});
it('keeps retries on immutable intent after a network failure',async()=>{
  m.rpc.mockRejectedValue(new Error('Network uncertain'));mount(<PermanentItemEditor item={null} onClose={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Pump'}});fireEvent.click(screen.getByText('Choose map location'));fireEvent.click(screen.getByRole('button',{name:'Create item'}));
  await screen.findByText('Network uncertain');fireEvent.click(screen.getByRole('button',{name:'Retry same operation'}));await waitFor(()=>expect(m.rpc).toHaveBeenCalledTimes(2));expect(m.rpc.mock.calls[0][1]).toBe(m.rpc.mock.calls[1][1]);expect(screen.getByLabelText('Name')).toBeDisabled();
});
it('filters separate items by search without querying pins',async()=>{
  m.rows=[{id:'i',name:'Pump',item_type:'pump',latitude:-34,longitude:138,server_revision:1,archived_at:null}];mount(<PermanentItemsPanel onSelect={()=>{}}/>);
  await screen.findByRole('button',{name:/Pump/});fireEvent.change(screen.getByLabelText('Search Permanent Items'),{target:{value:'gate'}});expect(screen.queryByRole('button',{name:/Pump/})).not.toBeInTheDocument();expect(m.from).toHaveBeenCalledWith('permanent_items');expect(m.from).not.toHaveBeenCalledWith('pins');
});
it('revokes an open editor when vineyard changes and never submits old scope',()=>{
  const editor=<PermanentItemEditor item={null} onClose={()=>{}}/>;const view=mount(editor);expect(screen.getByRole('dialog')).toBeInTheDocument();
  m.vineyard='other';view.rerender(<QueryClientProvider client={new QueryClient()}>{editor}</QueryClientProvider>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(m.rpc).not.toHaveBeenCalled();
});
it('requires archive confirmation and preserves current revision',async()=>{
  const item:any={id:'i',vineyard_id:'v',name:'Pump',item_type:'pump',latitude:-34,longitude:138,notes:null,paddock_id:null,photo_path:null,server_revision:4,archived_at:null};
  m.rpc.mockImplementation(async()=>{m.rows=[{...item,server_revision:5,archived_at:'now'}];return {data:m.rows[0],error:null};});
  mount(<PermanentItemEditor item={item} onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Archive'}));expect(m.rpc).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm archive'}));
  await screen.findByText('Synced · revision 5 · Archived');expect(m.rpc).toHaveBeenCalledWith('apply_permanent_item_v1',expect.objectContaining({p_action:'archive',p_item_id:'i',p_expected_revision:4}));
});