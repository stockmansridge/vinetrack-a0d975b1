import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PermanentItemEditor from '@/components/permanent-items/PermanentItemEditor';
import PermanentItemsPanel from '@/components/permanent-items/PermanentItemsPanel';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
import { permanentDeleteKey, createPermanentDeleteIntent, persistPermanentDeleteIntent } from '@/lib/permanentItemDeletion';
import type { PermanentItem } from '@/lib/permanentItems';
const m=vi.hoisted(()=>({read:true,manage:false,del:true,user:'u',vineyard:'v',rpc:vi.fn(),invoke:vi.fn(),from:vi.fn()}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:{id:m.user},loading:false})}));
vi.mock('@/context/VineyardContext',()=>({useVineyard:()=>({selectedVineyardId:m.vineyard,loading:false})}));
vi.mock('@/integrations/ios-supabase/client',()=>({supabase:{rpc:m.rpc,from:m.from,functions:{invoke:m.invoke}}}));
vi.mock('@/lib/queries',()=>({fetchList:async()=>[]}));
vi.mock('@/components/manual-issues/ManualIssuesAppleMap',()=>({default:()=> <div>Location map</div>}));
const item={id:'i',vineyard_id:'v',name:'Pump',item_type:'pump',latitude:-34,longitude:138,notes:null,paddock_id:null,photo_path:null,server_revision:4,archived_at:null} as PermanentItem;
function mount(row:PermanentItem|null=item){const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const close=vi.fn();const view=render(<QueryClientProvider client={qc}><PermanentItemEditor item={row} onClose={close}/></QueryClientProvider>);return {...view,qc,close};}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();readOnlyStore.setReadOnly(false);m.read=true;m.manage=false;m.del=true;m.user='u';m.vineyard='v';
  m.rpc.mockImplementation(async()=>({data:[{can_read:m.read,can_manage:m.manage,can_hard_delete:m.del}],error:null}));
  const chain:any={select:()=>chain,eq:()=>chain,order:async()=>({data:[],error:null})};m.from.mockReturnValue(chain);
  m.invoke.mockImplementation(async(_:string,{body}:any)=>({data:{deleted:true,photo_cleanup_pending:false,item_id:body.p_item_id,operation_id:body.p_operation_id},error:null}));
});
afterEach(()=>cleanup());
async function confirm(){fireEvent.click(await screen.findByRole('button',{name:'Hard Delete'}));fireEvent.click(screen.getByRole('button',{name:'Continue to final confirmation'}));
  const button=screen.getByRole('button',{name:'Permanently delete item and all photos'});expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Type DELETE to permanently remove Pump'),{target:{value:'DELETE'}});fireEvent.click(button);}
it.each(['owner','manager','supervisor'])('%s can manage and hard-delete under server GA permissions',async()=>{
  m.manage=true;mount();await screen.findByRole('button',{name:'Hard Delete'});
  expect(screen.getByLabelText('Name')).toBeEnabled();
  expect(screen.getByRole('button',{name:'Archive'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Save changes / move marker'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Add Vineyard Type'})).toBeEnabled();
});
it.each(['operator','member','System Admin without a delete vineyard role'])('%s can manage but never sees hard deletion',async()=>{
  m.manage=true;m.del=false;mount();await screen.findByRole('button',{name:'Save changes / move marker'});
  expect(screen.queryByRole('button',{name:'Hard Delete'})).not.toBeInTheDocument();
});
it.each(['no membership','off-vineyard'])('%s cannot enter details or list',async()=>{
  m.read=false;m.manage=false;m.del=false;mount();await waitFor(()=>expect(m.rpc).toHaveBeenCalled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(m.from).not.toHaveBeenCalled();
});
it('server read-only permission does not allow creation',async()=>{mount(null);await waitFor(()=>expect(m.rpc).toHaveBeenCalled());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();});
it.each([null,'archived'])('requires two confirmations and deletes active/archived %s with exact revision; invalidates only Permanent Items',async archived=>{
  const {qc,close}=mount({...item,archived_at:archived});const invalidate=vi.spyOn(qc,'invalidateQueries');await confirm();
  await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(m.invoke).toHaveBeenCalledWith('permanent-item-hard-delete-v1',{body:expect.objectContaining({p_item_id:'i',p_vineyard_id:'v',p_expected_revision:4})});
  expect(invalidate).toHaveBeenCalledWith({queryKey:['permanent-items','v','u']});expect(localStorage.length).toBe(0);
});
it('recovers uncertain deletion after close and resends identical payload',async()=>{
  m.invoke.mockRejectedValue(new Error('Network uncertain'));const first=mount();await confirm();await screen.findByRole('button',{name:'Retry same deletion operation'});
  const payload=m.invoke.mock.calls[0][1].body;first.unmount();mount();fireEvent.click(await screen.findByRole('button',{name:'Retry same deletion operation'}));
  await waitFor(()=>expect(m.invoke).toHaveBeenCalledTimes(2));expect(m.invoke.mock.calls[1][1].body).toEqual(payload);
});
it('503 cleanup remains pending, no success/close or list invalidation until full receipt',async()=>{
  m.invoke.mockImplementation(async(_:string,{body}:any)=>({data:null,error:{context:new Response(JSON.stringify({deleted:true,photo_cleanup_pending:true,item_id:'i',operation_id:body.p_operation_id}),{status:503})}}));
  const {qc,close}=mount();const invalidate=vi.spyOn(qc,'invalidateQueries');await confirm();await screen.findByText('Item deletion happened; ALL photo cleanup is not yet confirmed.');
  expect(close).not.toHaveBeenCalled();expect(invalidate).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
});
it('409 stops retries and requires explicit reload before a fresh confirmation',async()=>{
  m.invoke.mockResolvedValue({data:null,error:{context:new Response('{}',{status:409})}});mount();await confirm();await screen.findByRole('button',{name:'Reload list and review'});
  expect(screen.queryByRole('button',{name:'Retry same deletion operation'})).not.toBeInTheDocument();expect(m.invoke).toHaveBeenCalledTimes(1);
});
it('403 revokes permission and sends no additional request',async()=>{
  m.invoke.mockImplementation(async()=>{m.read=false;m.del=false;return {data:null,error:{context:new Response('{}',{status:403})}};});const {qc}=mount();const invalidate=vi.spyOn(qc,'invalidateQueries');await confirm();
  await waitFor(()=>expect(invalidate).toHaveBeenCalledWith({queryKey:['permanent-item-permissions','u','v']}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(m.invoke).toHaveBeenCalledTimes(1);
});
it('wrong vineyard details shut immediately and never invoke',async()=>{
  const view=mount();await screen.findByRole('dialog');m.vineyard='other';view.rerender(<QueryClientProvider client={view.qc}><PermanentItemEditor item={item} onClose={view.close}/></QueryClientProvider>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(m.invoke).not.toHaveBeenCalled();
});
it('offers pending cleanup recovery even when no row remains in list',async()=>{
  persistPermanentDeleteIntent(permanentDeleteKey('u','v','i'),createPermanentDeleteIntent('u','v',item));const qc=new QueryClient();const select=vi.fn();
  render(<QueryClientProvider client={qc}><PermanentItemsPanel onSelect={select}/></QueryClientProvider>);fireEvent.click(await screen.findByRole('button',{name:'Review pending deletion: Pump'}));expect(select).toHaveBeenCalledWith(item);
});