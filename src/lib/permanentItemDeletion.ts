import { supabase } from '@/integrations/ios-supabase/client';
import { guardMutation } from '@/lib/vineyardWriteAccess';
import type { PermanentItem } from './permanentItems';

export interface PermanentPermissions { can_read: boolean; can_manage: boolean; can_hard_delete: boolean }
export const permanentPermissionsKey = (vineyardId: string | null, userId?: string) => ['permanent-item-permissions', userId, vineyardId] as const;
export async function getPermanentPermissions(vineyardId: string): Promise<PermanentPermissions> {
  const { data, error } = await (supabase as any).rpc('permanent_item_permissions_v1', { p_vineyard_id: vineyardId });
  if (error) throw error;
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (!row || ['can_read', 'can_manage', 'can_hard_delete'].some(key => typeof row[key] !== 'boolean')) {
    throw new Error('Permanent Item permissions could not be verified.');
  }
  return row;
}
export interface PermanentDeletePayload {
  p_operation_id: string; p_item_id: string; p_vineyard_id: string; p_expected_revision: number;
}
export interface PermanentDeleteIntent {
  payload: PermanentDeletePayload; item: PermanentItem; cleanupPending: boolean; blocked: 'stale' | 'revoked' | null;
}
export const permanentDeleteKey = (userId: string, vineyardId: string, itemId: string) =>
  `vinetrack:permanent-delete:v1:${encodeURIComponent(userId)}:${encodeURIComponent(vineyardId)}:${encodeURIComponent(itemId)}`;
export function loadPermanentDeleteIntent(key: string, item: PermanentItem): PermanentDeleteIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  let value: PermanentDeleteIntent;
  try { value = JSON.parse(raw); } catch { throw new Error('Pending deletion is unreadable. Do not start another deletion.'); }
  const p = value?.payload;
  if (!p || value.item?.id !== item.id || value.item?.vineyard_id !== item.vineyard_id || p.p_item_id !== item.id || p.p_vineyard_id !== item.vineyard_id || typeof p.p_operation_id !== 'string' ||
      !p.p_operation_id || !Number.isSafeInteger(p.p_expected_revision) || typeof value.cleanupPending !== 'boolean' ||
      ![null, 'stale', 'revoked'].includes(value.blocked)) throw new Error('Pending deletion scope could not be verified.');
  return value;
}
export function persistPermanentDeleteIntent(key: string, intent: PermanentDeleteIntent) {
  localStorage.setItem(key, JSON.stringify(intent)); // Fail before calling the server if durable storage is unavailable.
}
export function createPermanentDeleteIntent(userId: string, vineyardId: string, item: PermanentItem): PermanentDeleteIntent {
  if (!userId || item.vineyard_id !== vineyardId || !Number.isSafeInteger(item.server_revision)) throw new Error('Reload this item in the selected vineyard.');
  return { item, payload: { p_operation_id: crypto.randomUUID(), p_item_id: item.id, p_vineyard_id: vineyardId,
    p_expected_revision: item.server_revision }, cleanupPending: false, blocked: null };
}
export function pendingPermanentDeleteItems(userId: string, vineyardId: string): PermanentItem[] {
  const prefix = permanentDeleteKey(userId, vineyardId, '');
  const items: PermanentItem[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const raw = localStorage.getItem(key);
      const item = raw ? JSON.parse(raw).item as PermanentItem : null;
      if (item && key === permanentDeleteKey(userId, vineyardId, item.id) && loadPermanentDeleteIntent(key, item)) items.push(item);
    } catch { /* Malformed intent is never sent to the server. */ }
  }
  return items;
}
export class PermanentDeleteFailure extends Error {
  constructor(message: string, readonly status: number | undefined, readonly cleanupPending: boolean) { super(message); }
}
export async function invokePermanentHardDelete(intent: PermanentDeleteIntent, assertAccess: () => void) {
  assertAccess(); guardMutation(undefined);
  if (intent.blocked) throw new Error('Reload and review this deletion; automatic retry is disabled.');
  const { data, error } = await supabase.functions.invoke('permanent-item-hard-delete-v1', { body: intent.payload });
  let body = data;
  const response = error?.context;
  if (error && response instanceof Response) {
    try { body = await response.clone().json(); } catch { /* No trustworthy receipt. */ }
  }
  const exact = body?.item_id === intent.payload.p_item_id && body?.operation_id === intent.payload.p_operation_id;
  const cleanupPending = exact && body?.deleted === true && body?.photo_cleanup_pending === true;
  const status = response instanceof Response ? response.status : undefined;
  if (error || !exact || body?.deleted !== true || body?.photo_cleanup_pending !== false) {
    const message = status === 409 ? 'This item changed. Reload and review; this deletion cannot automatically retry with a new revision.' :
      status === 403 ? 'Hard Delete access was revoked. No further deletion requests will be sent.' :
      cleanupPending ? 'Item deletion happened; photo cleanup remains pending. Retry the same operation to finish cleanup.' :
      'Deletion could not be confirmed. Retry the same operation; do not start another deletion.';
    throw new PermanentDeleteFailure(message, status, cleanupPending);
  }
  assertAccess();
  return body as { deleted: true; photo_cleanup_pending: false; item_id: string; operation_id: string };
}