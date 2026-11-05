import { beforeEach, expect, it, vi } from 'vitest';
import { createPermanentType, listPermanentTypes, PERMANENT_ITEM_TYPE_COLORS, PERMANENT_ITEM_TYPES, permanentItemTypeColor, permanentItemTypeLabel, permanentTypesKey, validatePermanentDraft, validatePermanentTypeInput } from '@/lib/permanentItems';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), eq: vi.fn(), order: vi.fn() }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: m.rpc, from: m.from } }));
const key = `custom_${'a'.repeat(32)}` as const;
const row = { id: 'type-id', vineyard_id: 'v', type_key: key, name: 'Weather station', color_hex: '#2478C4' };
beforeEach(() => { vi.clearAllMocks(); readOnlyStore.setReadOnly(false); m.rpc.mockResolvedValue({data:[row],error:null});
  const chain = { select: () => chain, eq: m.eq.mockImplementation(() => chain), order: m.order.mockResolvedValue({data:[row,row],error:null}) }; m.from.mockReturnValue(chain);
});
it('saves trimmed name and exact vineyard/colour through the shared RPC', async () => {
  expect(await createPermanentType('v',' Weather station ', '#2478C4', () => {})).toEqual(row);
  expect(m.rpc).toHaveBeenCalledWith('create_permanent_item_type_v1', {p_vineyard_id:'v',p_name:'Weather station',p_color_hex:'#2478C4'});
});
it.each(['Duplicate name','Standard name collision','Permission denied'])('surfaces server error %s without accepting a type', async message => {
  m.rpc.mockResolvedValue({data:null,error:new Error(message)}); await expect(createPermanentType('v',row.name,row.color_hex,()=>{})).rejects.toThrow(message);
});
it.each([[],[row,row], {...row}, [{...row,vineyard_id:'other'}], [{...row,type_key:'custom_bad'}], [{...row,name:'Other name'}], [{...row,color_hex:'#000000'}]])('rejects unverifiable receipt %j', async data => {
  m.rpc.mockResolvedValue({data,error:null});await expect(createPermanentType('v',row.name,row.color_hex,()=>{})).rejects.toThrow();
});
it('fails closed when account/vineyard access changes while saving', async () => {
  let valid=true;m.rpc.mockImplementation(async()=>{valid=false;return {data:[row],error:null};});
  await expect(createPermanentType('v',row.name,row.color_hex,()=>{if(!valid)throw new Error('Access changed');})).rejects.toThrow('Access changed');
});
it('guards revoked and read-only access before sending',async()=>{
  await expect(createPermanentType('v',row.name,row.color_hex,()=>{throw new Error('Denied');})).rejects.toThrow('Denied');
  readOnlyStore.setReadOnly(true);await expect(createPermanentType('v',row.name,row.color_hex,()=>{})).rejects.toThrow();readOnlyStore.setReadOnly(false);expect(m.rpc).not.toHaveBeenCalled();
});
it('reads shared per-vineyard options, deduplicates and resolves custom names',async()=>{
  expect(await listPermanentTypes('v')).toEqual([row]);expect(m.from).toHaveBeenCalledWith('permanent_item_types');expect(m.eq).toHaveBeenCalledWith('vineyard_id','v');
  expect(permanentItemTypeLabel(key,[row])).toBe('Weather station');expect(permanentItemTypeLabel(key)).not.toBe('Other');
  expect(permanentTypesKey('v','u')).not.toEqual(permanentTypesKey('other','u'));expect(permanentTypesKey('v','u')).not.toEqual(permanentTypesKey('v','other-user'));
});
it('rejects wrong-vineyard catalogue rows',async()=>{m.order.mockResolvedValue({data:[{...row,vineyard_id:'other'}],error:null});await expect(listPermanentTypes('v')).rejects.toThrow('verified');});
it.each(['', ' '.repeat(3), 'a'.repeat(61)])('rejects invalid type name %j',name=>{expect(()=>validatePermanentTypeInput(name,'#2478C4')).toThrow();});
it.each(['red','#123','#12345678','#GGGGGG'])('rejects invalid colour %s',color=>{expect(()=>validatePermanentTypeInput('Station',color)).toThrow();});
it('accepts exactly 1 to 60 characters and valid hex colour',()=>{expect(()=>validatePermanentTypeInput('a','#abcdef')).not.toThrow();expect(()=>validatePermanentTypeInput('a'.repeat(60),'#ABCDEF')).not.toThrow();});
it('accepts strict custom keys without weakening location/name validation',()=>{
  const draft={name:'Station',item_type:key,latitude:-34,longitude:138,notes:null,paddock_id:null};
  expect(()=>validatePermanentDraft(draft)).not.toThrow();expect(()=>validatePermanentDraft({...draft,name:''})).toThrow();expect(()=>validatePermanentDraft({...draft,latitude:NaN})).toThrow();
});
it.each(['custom_a',`custom_${'A'.repeat(32)}`,`custom_${'a'.repeat(33)}`,'invalid'])('rejects malformed type %s',item_type=>{expect(()=>validatePermanentDraft({name:'Station',item_type:item_type as any,latitude:-34,longitude:138,notes:null,paddock_id:null})).toThrow('valid item type');});