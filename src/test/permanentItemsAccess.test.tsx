import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePermanentItems, usePermanentItemTypes } from '@/components/permanent-items/usePermanentItems';
const m = vi.hoisted(() => ({ user: 'u' as string | null, vineyard: 'v' as string | null,
  demo: false, authLoading: false, membershipsLoading: false, rpc: vi.fn(), from: vi.fn() }));
// Any accidental dependency on the removed admin/flag hooks fails these tests.
vi.mock('@/lib/systemAdmin', () => ({ useIsSystemAdmin: () => { throw new Error('Admin gate forbidden'); }, useFeatureFlag: () => { throw new Error('Flag gate forbidden'); } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: m.user ? { id: m.user } : null, loading: m.authLoading }) }));
vi.mock('@/context/VineyardContext', () => ({ useVineyard: () => ({ selectedVineyardId: m.vineyard, loading: m.membershipsLoading }) }));
vi.mock('@/context/DemoModeContext', () => ({ useDemoMode: () => ({ demoMode: m.demo }) }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: m.rpc, from: m.from } }));
const type = { id: 't', vineyard_id: 'v', type_key: `custom_${'a'.repeat(32)}`, name: 'Station', color_hex: '#2478C4' };
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(() => { const access = usePermanentItems(); return { access, catalogue: usePermanentItemTypes(access) }; },
    { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
  return { ...view, qc };
}
beforeEach(() => {
  vi.clearAllMocks(); m.user='u'; m.vineyard='v'; m.demo=false; m.authLoading=false; m.membershipsLoading=false;
  m.rpc.mockResolvedValue({ data: [{ can_read: true, can_manage: true, can_hard_delete: false }], error: null });
  m.from.mockImplementation((table: string) => { let vineyard: string; const chain = { select: () => chain,
    eq: (_: string, v: string) => { vineyard=v; return chain; },
    order: async () => ({ data: table === 'permanent_item_types' ? [{ ...type, vineyard_id: vineyard }] : [{ id: vineyard, vineyard_id: vineyard }], error: null }) }; return chain; });
});
afterEach(cleanup);
it.each(['owner','manager','supervisor','operator','member'])('%s reads shared types/colours and receives manage/delete only from the server', async role => {
  const del = ['owner','manager','supervisor'].includes(role);
  m.rpc.mockResolvedValue({ data: [{ can_read:true, can_manage:true, can_hard_delete:del }], error:null });
  const { result } = mount();
  await waitFor(() => expect(result.current.catalogue.types).toEqual([type]));
  expect(result.current.access).toMatchObject({ allowed:true, canManage:true, canHardDelete:del });
  expect(m.rpc).toHaveBeenCalledWith('permanent_item_permissions_v1', { p_vineyard_id:'v' });
  expect(m.from).not.toHaveBeenCalledWith('pins');
});
it.each(['anonymous','no vineyard','demo','auth loading','memberships loading'])('denies %s before permission or data reads', async kind => {
  if(kind==='anonymous')m.user=null; if(kind==='no vineyard')m.vineyard=null;
  if(kind==='demo')m.demo=true; if(kind==='auth loading')m.authLoading=true; if(kind==='memberships loading')m.membershipsLoading=true;
  const { result }=mount();
  expect(result.current.access).toMatchObject({ allowed:false, canManage:false, canHardDelete:false, items:[] });
  expect(result.current.catalogue.types).toEqual([]); expect(m.rpc).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
});
it.each(['no membership','off-vineyard','permission error'])('fails closed for server %s denial', async kind => {
  m.rpc.mockResolvedValue({ data: kind==='permission error' ? null : [{ can_read:false,can_manage:false,can_hard_delete:false }], error:kind==='permission error' ? new Error('Denied') : null });
  const { result }=mount(); await waitFor(()=>expect(m.rpc).toHaveBeenCalled());
  expect(result.current.access.allowed).toBe(false); expect(result.current.catalogue.types).toEqual([]); expect(m.from).not.toHaveBeenCalled();
});
it.each(['account','vineyard'])('refreshes access and never exposes previous cached types/items on %s change', async kind => {
  const { result, rerender, qc }=mount(); await waitFor(()=>expect(result.current.catalogue.types).toEqual([type]));
  let resolve: (value: unknown)=>void=()=>{};
  m.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  if(kind==='account')m.user='other'; else m.vineyard='other'; rerender();
  expect(result.current.access).toMatchObject({ allowed:false, canManage:false, canHardDelete:false, items:[] });
  expect(result.current.catalogue.types).toEqual([]);
  await waitFor(()=>expect(m.rpc).toHaveBeenCalledTimes(2));
  resolve({ data:[{can_read:true,can_manage:true,can_hard_delete:false}],error:null });
  await waitFor(()=>expect(result.current.catalogue.types).toHaveLength(1));
  expect(qc.getQueryData(['permanent-item-types',m.vineyard,m.user])).toEqual([{...type,vineyard_id:m.vineyard}]);
  expect(qc.getQueryData(['permanent-item-types','v','u'])).toEqual([type]);
});
it('Demo Mode immediately hides previously cached permitted items and types', async()=>{
  const {result,rerender}=mount(); await waitFor(()=>expect(result.current.catalogue.types).toEqual([type]));
  m.demo=true;rerender();expect(result.current.access).toMatchObject({allowed:false,canManage:false,canHardDelete:false,items:[]});
  expect(result.current.catalogue.types).toEqual([]);expect(m.rpc).toHaveBeenCalledTimes(1);
});