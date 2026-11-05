import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPermanentOperation, createPermanentOperation, permanentItemsAllowed, permanentPhotoExtension, permanentPhotoPathAllowed, PermanentSaveSession, validPermanentLocation, type PermanentItem, type PermanentItemDraft } from '@/lib/permanentItems';
import { readOnlyStore } from '@/lib/vineyardWriteAccess';
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upload: vi.fn() }));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: m.rpc, from: m.from, storage: { from: () => ({ upload: m.upload }) } } }));
const draft: PermanentItemDraft = { name: 'Pump', item_type: 'pump', latitude: -34, longitude: 138, notes: null, paddock_id: null };
const row = (id: string, revision = 1): PermanentItem => ({ ...draft, id, vineyard_id: 'v', server_revision: revision, photo_path: null, archived_at: null, archived_by: null, created_by: 'u', created_at: 'now', updated_at: 'now' });
function readBack(value: unknown) { const chain: any = { select: vi.fn(() => chain), eq: vi.fn(() => chain), single: vi.fn(async () => ({ data: value, error: null })) }; m.from.mockReturnValue(chain); return chain; }
beforeEach(() => { vi.clearAllMocks(); readOnlyStore.setReadOnly(false); m.upload.mockResolvedValue({ error: null }); });
describe('Permanent Items pilot contract', () => {
  it.each([[false,true,true,'u','v'],[true,false,true,'u','v'],[true,true,false,'u','v'],[true,true,true,undefined,'v'],[true,true,true,'u',null]])('fails closed for missing gate %j', (admin, flag, member, user, vineyard) => {
    expect(permanentItemsAllowed(admin as boolean, flag as boolean, user as string | undefined, vineyard as string | null, member as boolean)).toBe(false);
  });
  it('permits only all verified gates', () => expect(permanentItemsAllowed(true,true,'u','v',true)).toBe(true));
  it.each([[NaN,1],[91,1],[1,181],[Infinity,1]])('rejects invalid coordinates %j', (lat,lng) => expect(validPermanentLocation(lat,lng)).toBe(false));
  it('requires name and uses exact CAS for update/archive and null for create', () => {
    expect(() => createPermanentOperation('v', { ...draft, name: '' },null,'create')).toThrow();
    expect(createPermanentOperation('v',draft,null,'create').p_expected_revision).toBeNull();
    expect(createPermanentOperation('v',draft,row('i',4),'update').p_expected_revision).toBe(4);
    expect(createPermanentOperation('v',draft,row('i',4),'archive').p_expected_revision).toBe(4);
    expect(() => createPermanentOperation('other',draft,row('i'),'update')).toThrow();
  });
  it('retries the same operation after uncertain response and verifies exact id/revision', async () => {
    const op = createPermanentOperation('v',draft,null,'create'); const saved = row(op.p_item_id,3);
    m.rpc.mockRejectedValueOnce(new Error('Network uncertain')).mockResolvedValue({ data: saved, error: null }); const read = readBack(saved);
    const session = new PermanentSaveSession(op); await expect(session.run(() => {})).rejects.toThrow('Network');
    await expect(session.run(() => {})).resolves.toEqual(saved);
    expect(m.rpc.mock.calls[0][1]).toBe(op); expect(m.rpc.mock.calls[1][1]).toBe(op);
    expect(read.eq).toHaveBeenCalledWith('id',op.p_item_id); expect(read.eq).toHaveBeenCalledWith('server_revision',3);
  });
  it('does not accept unverified receipt or mismatched read-back', async () => {
    const op = createPermanentOperation('v',draft,null,'create');
    m.rpc.mockResolvedValue({ data: true, error: null }); await expect(applyPermanentOperation(op,() => {})).rejects.toThrow('receipt'); expect(m.from).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue({ data: row(op.p_item_id), error: null }); readBack({ ...row(op.p_item_id), name: 'Other' });
    await expect(applyPermanentOperation(op,() => {})).rejects.toThrow('differs');
  });
  it('refuses writes and uploads when access or read-only denies', async () => {
    const session = new PermanentSaveSession(createPermanentOperation('v',draft,null,'create'));
    await expect(session.run(() => { throw new Error('denied'); })).rejects.toThrow('denied'); expect(m.rpc).not.toHaveBeenCalled();
    readOnlyStore.setReadOnly(true); await expect(session.run(() => {})).rejects.toThrow('trial'); expect(m.rpc).not.toHaveBeenCalled(); readOnlyStore.setReadOnly(false);
  });
  it('coalesces duplicate clicks', async () => {
    const op = createPermanentOperation('v',draft,null,'create'); m.rpc.mockResolvedValue({ data: row(op.p_item_id), error: null }); readBack(row(op.p_item_id));
    const session = new PermanentSaveSession(op); await Promise.all([session.run(() => {}),session.run(() => {})]); expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it('uploads only after create read-back and retries photo update with its original operation and revision', async () => {
    const op = createPermanentOperation('v',draft,null,'create');
    const chain: any = { select: () => chain, eq: () => chain, single: async () => ({ data: m.rpc.mock.calls.length === 1 ? row(op.p_item_id,1) : { ...row(op.p_item_id,2), photo_path: m.rpc.mock.calls.at(-1)?.[1].p_photo_path }, error: null }) }; m.from.mockReturnValue(chain);
    m.rpc.mockResolvedValueOnce({ data: row(op.p_item_id), error: null }).mockRejectedValueOnce(new Error('uncertain photo')).mockResolvedValue({ data: row(op.p_item_id,2), error: null });
    const session = new PermanentSaveSession(op,new File(['x'],'x.jpg',{ type:'image/jpeg' }));
    await expect(session.run(() => {})).rejects.toThrow('uncertain photo'); await session.run(() => {});
    expect(m.rpc.mock.calls[1][1]).toBe(m.rpc.mock.calls[2][1]); expect(m.rpc.mock.calls[1][1].p_expected_revision).toBe(1);
    expect(m.upload).toHaveBeenCalledTimes(1); expect(m.upload.mock.invocationCallOrder[0]).toBeGreaterThan(m.rpc.mock.invocationCallOrder[0]);
    expect(permanentPhotoPathAllowed(m.upload.mock.calls[0][0],'v',op.p_item_id)).toBe(true);
  });
  it('refuses invalid/private cross-item photo paths and files', () => {
    expect(permanentPhotoPathAllowed('other/i/x.jpg','v','i')).toBe(false); expect(permanentPhotoPathAllowed('https://host/photo.jpg','v','i')).toBe(false);
    expect(() => permanentPhotoExtension(new File(['x'],'x.svg',{ type:'image/svg+xml' }))).toThrow();
    expect(() => permanentPhotoExtension(new File([''],'x.jpg',{ type:'image/jpeg' }))).toThrow();
  });
});