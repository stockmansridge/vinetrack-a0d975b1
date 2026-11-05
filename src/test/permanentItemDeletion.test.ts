import { beforeEach, expect, it, vi } from 'vitest';
import { createPermanentDeleteIntent, getPermanentPermissions, invokePermanentHardDelete, loadPermanentDeleteIntent,
  pendingPermanentDeleteItems, permanentDeleteKey, persistPermanentDeleteIntent } from '@/lib/permanentItemDeletion';
import type { PermanentItem } from '@/lib/permanentItems';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
const m = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: m.rpc, functions: { invoke: m.invoke } } }));
const item = { id:'item', vineyard_id:'v', name:'Pump', server_revision:4, archived_at:null } as PermanentItem;
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); readOnlyStore.setReadOnly(false); });
it.each([
  ['owner',true,true,true], ['manager',true,true,true], ['admin-only',true,true,false],
  ['operator',true,true,false], ['supervisor',true,true,true], ['member',true,true,false], ['wrong vineyard',false,false,false], ['no membership',false,false,false],
])('uses authoritative %s permissions without client role assumptions',async(_role,read,manage,del)=>{
  m.rpc.mockResolvedValue({data:[{can_read:read,can_manage:manage,can_hard_delete:del}],error:null});
  expect(await getPermanentPermissions('v')).toEqual({can_read:read,can_manage:manage,can_hard_delete:del});
  expect(m.rpc).toHaveBeenCalledWith('permanent_item_permissions_v1',{p_vineyard_id:'v'});
});
it.each([null,{},[],[{can_read:true,can_manage:true}], [{can_read:true,can_manage:true,can_hard_delete:'true'}]])('rejects malformed permissions %j',async data=>{
  m.rpc.mockResolvedValue({data,error:null});await expect(getPermanentPermissions('v')).rejects.toThrow('verified');
});
it('rejects wrong vineyard before creating an intent',()=>{
  expect(()=>createPermanentDeleteIntent('u','other',item)).toThrow('selected vineyard');
});
it('recovers the same operation and revision after reopen, even if the row is gone',async()=>{
  const intent=createPermanentDeleteIntent('u','v',item);const key=permanentDeleteKey('u','v','item');persistPermanentDeleteIntent(key,intent);
  expect(pendingPermanentDeleteItems('u','v')).toEqual([item]);expect(pendingPermanentDeleteItems('other','v')).toEqual([]);
  const recovered=loadPermanentDeleteIntent(key,{...item,server_revision:8});expect(recovered?.payload).toEqual(intent.payload);
  m.invoke.mockRejectedValueOnce(new Error('Network')).mockResolvedValue({data:{deleted:true,photo_cleanup_pending:false,item_id:'item',operation_id:intent.payload.p_operation_id},error:null});
  await expect(invokePermanentHardDelete(intent,()=>{})).rejects.toThrow('Network');
  if(!recovered)throw new Error('Missing intent');await invokePermanentHardDelete(recovered,()=>{});
  expect(m.invoke.mock.calls[0][1].body).toEqual(m.invoke.mock.calls[1][1].body);
  expect(m.invoke.mock.calls[1][1].body.p_expected_revision).toBe(4);
});
it.each([409,403])('surfaces definitive HTTP %s without replacing revision',async status=>{
  const intent=createPermanentDeleteIntent('u','v',item);
  m.invoke.mockResolvedValue({data:null,error:{context:new Response('{}',{status})}});
  await expect(invokePermanentHardDelete(intent,()=>{})).rejects.toMatchObject({status});expect(intent.payload.p_expected_revision).toBe(4);
});
it('recognises deletion with pending cleanup from an exact 503 receipt',async()=>{
  const intent=createPermanentDeleteIntent('u','v',item);
  m.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({deleted:true,photo_cleanup_pending:true,item_id:'item',operation_id:intent.payload.p_operation_id}),{status:503})}});
  await expect(invokePermanentHardDelete(intent,()=>{})).rejects.toMatchObject({status:503,cleanupPending:true});
});
it.each([{deleted:true,photo_cleanup_pending:false,item_id:'wrong'},{deleted:true,item_id:'item'},{deleted:false,photo_cleanup_pending:false,item_id:'item'}])('never accepts incomplete/wrong deletion receipt %j',async body=>{
  const intent=createPermanentDeleteIntent('u','v',item);m.invoke.mockResolvedValue({data:{...body,operation_id:intent.payload.p_operation_id},error:null});
  await expect(invokePermanentHardDelete(intent,()=>{})).rejects.toThrow('could not be confirmed');
});
it('requires permission and the central write guard before invoking',async()=>{
  const intent=createPermanentDeleteIntent('u','v',item);
  await expect(invokePermanentHardDelete(intent,()=>{throw new Error('revoked');})).rejects.toThrow('revoked');
  readOnlyStore.setReadOnly(true);await expect(invokePermanentHardDelete(intent,()=>{})).rejects.toThrow();readOnlyStore.setReadOnly(false);
  expect(m.invoke).not.toHaveBeenCalled();
});