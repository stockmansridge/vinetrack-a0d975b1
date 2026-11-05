// Issue #54 real hard deletes. The server (RLS + triggers + RPC) is the
// authority; these helpers only gate visibility and verify receipts before
// the UI reports success. No archive / soft-delete substitution.
import { supabase } from '@/integrations/ios-supabase/client';
import { guardMutation } from '@/lib/vineyardWriteAccess';
import type { YieldSampleSite, YieldSiteSet } from '@/lib/yieldSampleSites';

const LEADERSHIP = ['owner', 'manager', 'supervisor'];
const MEMBER = [...LEADERSHIP, 'operator'];

/** Draft sites: any authorised member. Confirmed: leadership only. Archived: never. */
export function canHardDeleteYieldSite(role: string | null, status: YieldSiteSet['status']): boolean {
  if (status === 'draft') return MEMBER.includes(role ?? '');
  if (status === 'confirmed') return LEADERSHIP.includes(role ?? '');
  return false;
}
/** Sessions: any member before completion; leadership only once completed. */
export function canHardDeleteYieldSession(role: string | null, isCompleted: boolean): boolean {
  return (isCompleted ? LEADERSHIP : MEMBER).includes(role ?? '');
}

export interface SiteDeletionReceipt { deleted_row_id: string; site_set_id: string; site_id: string; vineyard_id: string; was_confirmed: boolean }

export async function hardDeleteYieldSite(set: YieldSiteSet, site: YieldSampleSite, role: string | null, assertAccess: () => void): Promise<SiteDeletionReceipt> {
  guardMutation(undefined); assertAccess();
  if (site.site_set_id !== set.id || site.vineyard_id !== set.vineyard_id || site.paddock_id !== set.paddock_id) throw new Error('Wrong site scope.');
  if (!canHardDeleteYieldSite(role, set.status)) throw new Error(set.status === 'confirmed' ? 'Only Owner, Manager or Supervisor may delete confirmed sites.' : 'This site cannot be deleted.');
  const { data, error } = await supabase.from('yield_sample_sites').delete()
    .eq('id', site.id).eq('site_set_id', set.id).eq('vineyard_id', set.vineyard_id).select('id');
  if (error) throw error;
  if (!data || data.length !== 1 || (data[0] as { id: string }).id !== site.id) throw new Error('The server did not delete this site (access may have changed). Reload.');
  const receipt = await supabase.from('yield_sample_site_deletion_receipts')
    .select('deleted_row_id,site_set_id,site_id,vineyard_id,was_confirmed').eq('deleted_row_id', site.id).eq('vineyard_id', set.vineyard_id).maybeSingle();
  if (receipt.error) throw new Error(`Site deleted but receipt could not be read: ${receipt.error.message}. Reload.`);
  const r = receipt.data as SiteDeletionReceipt | null;
  if (!r || r.site_set_id !== set.id || r.site_id !== site.site_id || r.was_confirmed !== (set.status === 'confirmed')) throw new Error('Deletion receipt missing or mismatched. Reload before continuing.');
  assertAccess();
  return r;
}

export async function hardDeleteYieldSession(id: string, vineyardId: string, isCompleted: boolean): Promise<void> {
  guardMutation(undefined);
  const { error } = await (supabase as any).rpc('hard_delete_yield_estimation_session', { p_id: id, p_vineyard_id: vineyardId, p_expected_completed: isCompleted });
  if (error) throw error;
  const receipt = await (supabase as any).from('yield_estimation_session_deletion_receipts').select('*').eq('deleted_row_id', id).eq('vineyard_id', vineyardId).maybeSingle();
  if (receipt.error) throw new Error(`Trip deleted but receipt could not be read: ${receipt.error.message}. Reload.`);
  if (!receipt.data) throw new Error('Deletion receipt not found. Reload before assuming the trip was deleted.');
}
