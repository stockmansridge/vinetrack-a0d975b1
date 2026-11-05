import { supabase } from '@/integrations/ios-supabase/client';
import { guardMutation } from '@/lib/vineyardWriteAccess';

export const PERMANENT_ITEM_TYPES = ['irrigation_valve', 'flush_valve', 'pump', 'filter', 'tank', 'gate', 'water_point', 'other'] as const;
export type PermanentItemType = typeof PERMANENT_ITEM_TYPES[number];
export const permanentItemTypeLabel = (type: PermanentItemType) => type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export interface PermanentItem {
  id: string; vineyard_id: string; paddock_id: string | null; name: string; item_type: PermanentItemType;
  latitude: number; longitude: number; notes: string | null; photo_path: string | null;
  created_by: string; created_at: string; updated_at: string; server_revision: number;
  archived_at: string | null; archived_by: string | null;
}
export type PermanentItemDraft = Pick<PermanentItem, 'name' | 'item_type' | 'latitude' | 'longitude' | 'paddock_id' | 'notes'>;
export function permanentItemsAllowed(admin: boolean, enabled: boolean, userId: string | undefined, vineyardId: string | null, member: boolean) {
  return admin === true && enabled === true && !!userId && !!vineyardId && member;
}
export function validPermanentLocation(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
export function validatePermanentDraft(draft: PermanentItemDraft) {
  if (!draft.name.trim()) throw new Error('Enter an item name.');
  if (!PERMANENT_ITEM_TYPES.includes(draft.item_type)) throw new Error('Choose a valid item type.');
  if (!validPermanentLocation(draft.latitude, draft.longitude)) throw new Error('Enter valid latitude and longitude.');
}
export const permanentItemsKey = (vineyardId: string | null, userId?: string) => ['permanent-items', vineyardId, userId] as const;
const db = supabase as any;
export async function listPermanentItems(vineyardId: string): Promise<PermanentItem[]> {
  const { data, error } = await db.from('permanent_items').select('*').eq('vineyard_id', vineyardId).order('name');
  if (error) throw error;
  return data ?? [];
}
export interface PermanentOperation {
  p_operation_id: string; p_action: 'create' | 'update' | 'archive'; p_item_id: string; p_vineyard_id: string;
  p_expected_revision: number | null; p_name: string; p_item_type: PermanentItemType;
  p_latitude: number; p_longitude: number; p_paddock_id: string | null; p_notes: string | null; p_photo_path: string | null;
}
export function createPermanentOperation(vineyardId: string, draft: PermanentItemDraft, item: PermanentItem | null, action: PermanentOperation['p_action']): PermanentOperation {
  validatePermanentDraft(draft);
  if (action !== 'create' && (!item || item.vineyard_id !== vineyardId || !Number.isSafeInteger(item.server_revision))) throw new Error('Reload this item before changing it.');
  return {
    p_operation_id: crypto.randomUUID(), p_action: action, p_item_id: item?.id ?? crypto.randomUUID(), p_vineyard_id: vineyardId,
    p_expected_revision: action === 'create' ? null : item?.server_revision ?? null,
    p_name: draft.name.trim(), p_item_type: draft.item_type, p_latitude: draft.latitude, p_longitude: draft.longitude,
    p_paddock_id: draft.paddock_id, p_notes: draft.notes?.trim() || null, p_photo_path: item?.photo_path ?? null,
  };
}
export async function applyPermanentOperation(operation: PermanentOperation, assertAccess: () => void): Promise<PermanentItem> {
  assertAccess(); guardMutation(undefined);
  const { data, error } = await db.rpc('apply_permanent_item_v1', operation);
  if (error) throw error;
  // The RPC returns a SETOF receipt with exact columns item_id, server_revision, archived_at, operation_id.
  // Accept only that shape and exact values; never infer a revision from a later read.
  const rows = Array.isArray(data) ? data : [];
  const receipt = rows.length === 1 ? rows[0] : null;
  const revision = receipt?.server_revision;
  if (receipt?.item_id !== operation.p_item_id || receipt?.operation_id !== operation.p_operation_id || !Number.isSafeInteger(revision)) {
    throw new Error('Save receipt could not be verified. Retry this same operation; do not create another item.');
  }
  assertAccess();
  const { data: row, error: readError } = await db.from('permanent_items').select('*')
    .eq('vineyard_id', operation.p_vineyard_id).eq('id', operation.p_item_id).eq('server_revision', revision).single();
  if (readError) throw readError;
  if (!row || row.id !== operation.p_item_id || row.vineyard_id !== operation.p_vineyard_id || row.server_revision !== revision ||
      row.name !== operation.p_name || row.item_type !== operation.p_item_type ||
      Number(row.latitude) !== operation.p_latitude || Number(row.longitude) !== operation.p_longitude ||
      row.paddock_id !== operation.p_paddock_id || row.notes !== operation.p_notes || row.photo_path !== operation.p_photo_path ||
      (operation.p_action === 'archive' ? !row.archived_at : !!row.archived_at)) {
    throw new Error('Saved item read-back differs. Reload and review before making another change.');
  }
  assertAccess();
  return row;
}
/** Shared bucket permanent-item-photos allows at most 5 MiB (5,242,880 bytes) per file. */
export const PERMANENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export function permanentPhotoExtension(file: File) {
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[file.type];
  if (!ext || file.size === 0 || file.size > PERMANENT_PHOTO_MAX_BYTES) throw new Error('Choose one JPG, PNG or WebP photo up to 5 MiB.');
  return ext;
}
export function permanentPhotoPathAllowed(path: string, vineyardId: string, itemId: string) {
  const parts = path.split('/');
  return parts.length === 3 && parts[0] === vineyardId && parts[1] === itemId && /^[\w-]+\.(jpg|png|webp)$/.test(parts[2]);
}
export async function getPermanentPhoto(item: PermanentItem): Promise<string | null> {
  if (!item.photo_path) return null;
  if (!permanentPhotoPathAllowed(item.photo_path, item.vineyard_id, item.id)) throw new Error('Photo path does not belong to this item.');
  const { data, error } = await supabase.storage.from('permanent-item-photos').download(item.photo_path);
  if (error) throw error;
  return URL.createObjectURL(data);
}
/** One immutable user intent. Both RPC ids and the upload path survive every uncertain retry. */
export class PermanentSaveSession {
  readonly operation: PermanentOperation;
  private base: PermanentItem | null = null;
  private photoOperation: PermanentOperation | null = null;
  private uploaded = false;
  private inFlight: Promise<PermanentItem> | null = null;
  private readonly photoPath: string | null;
  constructor(operation: PermanentOperation, private readonly photo: File | null = null) {
    this.operation = operation;
    this.photoPath = photo ? `${operation.p_vineyard_id}/${operation.p_item_id}/${crypto.randomUUID()}.${permanentPhotoExtension(photo)}` : null;
  }
  run(assertAccess: () => void): Promise<PermanentItem> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.execute(assertAccess).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  private async execute(assertAccess: () => void): Promise<PermanentItem> {
    assertAccess(); guardMutation(undefined);
    if (!this.base) this.base = await applyPermanentOperation(this.operation, assertAccess);
    if (!this.photo || !this.photoPath || this.operation.p_action === 'archive') return this.base;
    if (!this.uploaded) {
      assertAccess(); guardMutation(undefined);
      const { error } = await supabase.storage.from('permanent-item-photos').upload(this.photoPath, this.photo, { contentType: this.photo.type, upsert: true });
      if (error) throw error;
      this.uploaded = true;
    }
    assertAccess();
    if (!this.photoOperation) this.photoOperation = { ...this.operation, p_operation_id: crypto.randomUUID(), p_action: 'update', p_expected_revision: this.base.server_revision, p_photo_path: this.photoPath };
    return applyPermanentOperation(this.photoOperation, assertAccess);
  }
}