import { supabase } from '@/integrations/ios-supabase/client';
import type { LatLng } from '@/lib/paddockGeometry';
import { guardMutation } from '@/lib/vineyardWriteAccess';

export interface YieldSiteSet {
  id: string; vineyard_id: string; paddock_id: string; set_key: string;
  version: number; name: string; status: 'draft' | 'confirmed' | 'archived';
  created_by?: string; confirmed_by?: string | null; confirmed_at?: string | null;
}
export interface YieldSampleSite {
  id: string; site_set_id: string; vineyard_id: string; paddock_id: string;
  site_id: string; site_number: number; name: string; row_number: number | null;
  panel_number: number | null; latitude: number; longitude: number; notes: string | null;
}
export type YieldSiteFields = Pick<YieldSampleSite, 'site_number' | 'name' | 'row_number' | 'panel_number' | 'latitude' | 'longitude' | 'notes'>;
export const yieldSitesKey = (vineyard: string, user: string, block: string) => ['yield-sample-sites', vineyard, user, block] as const;
export const canConfirmYieldSites = (role: string | null) => ['owner', 'manager', 'supervisor'].includes(role ?? '');

export function siteLocationError(point: LatLng, polygon: LatLng[], blockConfirmed: boolean): string | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return 'Enter valid latitude and longitude.';
  if (polygon.length < 3) return blockConfirmed ? null : 'No boundary available. Explicitly confirm the selected block.';
  if (polygon.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) return 'Block boundary is invalid. Reload the block before saving.';
  // Ray intersection, inclusive of polygon edges; coordinates are never moved or guessed.
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    const cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng);
    if (Math.abs(cross) < 1e-12 && point.lng >= Math.min(a.lng, b.lng) && point.lng <= Math.max(a.lng, b.lng) && point.lat >= Math.min(a.lat, b.lat) && point.lat <= Math.max(a.lat, b.lat)) return null;
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lng < (b.lng - a.lng) * (point.lat - a.lat) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside ? null : 'The sample location is outside the selected block.';
}
export function validateYieldSite(fields: YieldSiteFields, polygon: LatLng[], blockConfirmed: boolean) {
  if (!fields.name.trim()) throw new Error('A site name is required.');
  if (!Number.isInteger(fields.site_number) || fields.site_number < 1) throw new Error('Site number must be a positive whole number.');
  for (const n of [fields.row_number, fields.panel_number]) if (n !== null && (!Number.isInteger(n) || n < 1)) throw new Error('Row and panel must be positive whole numbers or blank.');
  const error = siteLocationError({ lat: fields.latitude, lng: fields.longitude }, polygon, blockConfirmed);
  if (error) throw new Error(error);
}
function checkSet(set: YieldSiteSet, vineyard: string, block: string) {
  if (set.vineyard_id !== vineyard || set.paddock_id !== block || !Number.isInteger(set.version) || set.version < 1 || !['draft', 'confirmed', 'archived'].includes(set.status)) throw new Error('Invalid or out-of-scope site set.');
}
const setColumns = 'id,vineyard_id,paddock_id,set_key,version,name,status,created_by,confirmed_by,confirmed_at';
const siteColumns = 'id,site_set_id,vineyard_id,paddock_id,site_id,site_number,name,row_number,panel_number,latitude,longitude,notes';
export async function listYieldSiteSets(vineyard: string, block: string): Promise<YieldSiteSet[]> {
  const { data, error } = await supabase.from('yield_sample_site_sets').select(setColumns).eq('vineyard_id', vineyard).eq('paddock_id', block).order('version', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as YieldSiteSet[];
  rows.forEach(s => checkSet(s, vineyard, block));
  return rows;
}
export async function listYieldSites(set: YieldSiteSet): Promise<YieldSampleSite[]> {
  const { data, error } = await supabase.from('yield_sample_sites').select(siteColumns).eq('vineyard_id', set.vineyard_id).eq('paddock_id', set.paddock_id).eq('site_set_id', set.id).order('site_number');
  if (error) throw error;
  const rows = (data ?? []) as YieldSampleSite[];
  if (rows.some(s => s.site_set_id !== set.id || s.vineyard_id !== set.vineyard_id || s.paddock_id !== set.paddock_id || !s.site_id)) throw new Error('Out-of-scope sample site response.');
  return rows;
}
async function freshDraft(set: YieldSiteSet) {
  const current = (await listYieldSiteSets(set.vineyard_id, set.paddock_id)).find(s => s.id === set.id);
  if (!current || current.status !== 'draft' || current.version !== set.version || current.set_key !== set.set_key) throw new Error('This draft has changed or was confirmed. Reload before making changes.');
}
export function nextYieldDraft(source: YieldSiteSet | null, sets: YieldSiteSet[], vineyard: string, block: string, user: string, name: string): YieldSiteSet {
  if (!name.trim()) throw new Error('A set name is required.');
  if (source) { checkSet(source, vineyard, block); if (source.status !== 'confirmed') throw new Error('Start a revision from a confirmed set.'); }
  return { id: crypto.randomUUID(), vineyard_id: vineyard, paddock_id: block, set_key: source?.set_key ?? crypto.randomUUID(), version: source ? Math.max(source.version, ...sets.filter(s => s.set_key === source.set_key).map(s => s.version)) + 1 : 1, name: name.trim(), status: 'draft', created_by: user };
}
export function copyYieldSites(source: YieldSampleSite[], from: YieldSiteSet, to: YieldSiteSet): YieldSampleSite[] {
  if (from.status !== 'confirmed' || to.status !== 'draft' || from.set_key !== to.set_key || to.version <= from.version || from.vineyard_id !== to.vineyard_id || from.paddock_id !== to.paddock_id) throw new Error('Invalid revision scope.');
  return source.map(s => {
    if (s.site_set_id !== from.id || s.vineyard_id !== from.vineyard_id || s.paddock_id !== from.paddock_id) throw new Error('Invalid source site.');
    return { ...s, id: crypto.randomUUID(), site_set_id: to.id };
  });
}
// Retain these generated IDs in the UI on uncertain saves. Never upsert a confirmed row.
export async function createYieldDraft(draft: YieldSiteSet, sites: YieldSampleSite[], assertAccess: () => void): Promise<YieldSiteSet> {
  guardMutation(undefined); assertAccess();
  const existing = (await listYieldSiteSets(draft.vineyard_id, draft.paddock_id)).find(s => s.id === draft.id);
  assertAccess();
  if (!existing) {
    const { error } = await supabase.from('yield_sample_site_sets').insert(draft);
    if (error) throw error;
  } else if (existing.status !== 'draft' || existing.set_key !== draft.set_key || existing.version !== draft.version || existing.name !== draft.name) throw new Error('Draft retry does not match saved data. Reload.');
  await freshDraft(draft); assertAccess();
  const saved = await listYieldSites(draft);
  for (const site of sites) {
    const present = saved.find(s => s.id === site.id);
    if (present) { if (!sameSite(present, site)) throw new Error('Copied draft differs from the requested revision. Reload.'); continue; }
    assertAccess(); guardMutation(undefined);
    const { error } = await supabase.from('yield_sample_sites').insert(site);
    if (error) throw new Error(`Draft exists but copying sites is incomplete: ${error.message}. Retry this draft.`);
  }
  const result = (await listYieldSiteSets(draft.vineyard_id, draft.paddock_id)).find(s => s.id === draft.id);
  const copied = await listYieldSites(draft);
  if (!result || result.status !== 'draft' || sites.some(s => !copied.some(c => sameSite(c, s)))) throw new Error('Draft save could not be verified. Reload or retry the same draft.');
  assertAccess(); return result;
}
function sameSite(a: YieldSampleSite, b: YieldSampleSite) { return (siteColumns.split(',') as (keyof YieldSampleSite)[]).every(k => a[k] === b[k]); }
export async function saveYieldSite(set: YieldSiteSet, site: YieldSampleSite, isNew: boolean, polygon: LatLng[], blockConfirmed: boolean, assertAccess: () => void) {
  guardMutation(undefined); assertAccess(); checkSet(set, site.vineyard_id, site.paddock_id);
  if (site.site_set_id !== set.id) throw new Error('Wrong site set.');
  validateYieldSite(site, polygon, blockConfirmed);
  await freshDraft(set); assertAccess();
  const before = (await listYieldSites(set)).find(s => s.id === site.id);
  if (before && before.site_id !== site.site_id) throw new Error('Physical site identity cannot change.');
  if (isNew && before) { if (!sameSite(before, site)) throw new Error('Site retry differs from saved data. Reload.'); }
  else {
    if (!isNew && !before) throw new Error('The sample site no longer exists. Reload.');
    assertAccess(); guardMutation(undefined);
    const fields: YieldSiteFields = { site_number: site.site_number, name: site.name.trim(), row_number: site.row_number, panel_number: site.panel_number, latitude: site.latitude, longitude: site.longitude, notes: site.notes };
    const request = isNew ? supabase.from('yield_sample_sites').insert({ ...site, ...fields }) : supabase.from('yield_sample_sites').update(fields).eq('id', site.id).eq('vineyard_id', set.vineyard_id).eq('paddock_id', set.paddock_id).eq('site_set_id', set.id);
    const { error } = await request;
    if (error) throw error;
  }
  const result = (await listYieldSites(set)).find(s => s.id === site.id);
  assertAccess();
  if (!result || !sameSite(result, { ...site, name: site.name.trim() })) throw new Error('Site save could not be verified. Reload before continuing.');
  return result;
}
export async function deleteYieldDraftSite(set: YieldSiteSet, site: YieldSampleSite, assertAccess: () => void) {
  guardMutation(undefined); assertAccess();
  if (site.site_set_id !== set.id || site.vineyard_id !== set.vineyard_id || site.paddock_id !== set.paddock_id) throw new Error('Wrong site scope.');
  await freshDraft(set); assertAccess();
  const { error } = await supabase.from('yield_sample_sites').delete().eq('id', site.id).eq('vineyard_id', set.vineyard_id).eq('paddock_id', set.paddock_id).eq('site_set_id', set.id);
  if (error) throw error;
  if ((await listYieldSites(set)).some(s => s.id === site.id)) throw new Error('Deletion could not be verified.');
  assertAccess();
}
export async function confirmYieldSiteSet(set: YieldSiteSet, role: string | null, polygon: LatLng[], blockConfirmed: boolean, assertAccess: () => void) {
  guardMutation(undefined); assertAccess();
  if (!canConfirmYieldSites(role)) throw new Error('Only Owner, Manager or Supervisor may confirm sites.');
  await freshDraft(set);
  const sites = await listYieldSites(set);
  if (!sites.length) throw new Error('Add at least one saved site before confirmation.');
  sites.forEach(s => validateYieldSite(s, polygon, blockConfirmed));
  assertAccess(); guardMutation(undefined);
  const { error } = await supabase.rpc('confirm_yield_sample_site_set', { p_set_id: set.id, p_expected_version: set.version });
  if (error) throw error;
  const sets = await listYieldSiteSets(set.vineyard_id, set.paddock_id);
  const result = sets.find(s => s.id === set.id);
  assertAccess();
  if (!result || result.status !== 'confirmed' || result.version !== set.version || !result.confirmed_at || sets.filter(s => s.status === 'confirmed').length !== 1) throw new Error('Confirmation not verified. Reload; do not assume the block is confirmed.');
  return result;
}

/** Presentation only: unknown methods stay explicitly identified, never treated as legacy. */
export function yieldCountMethodLabel(payload: unknown): string {
  let doc = payload;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch { return 'Count method unavailable'; } }
  const value = doc && typeof doc === 'object' ? (doc as Record<string, unknown>).countMethod : undefined;
  if (value == null || value === '') return 'Bunches Per Vine Count (legacy)';
  if (typeof value !== 'string') return 'Count method unavailable';
  return value === 'bunchesPerVine' ? 'Bunches Per Vine Count' : `Count method: ${value}`;
}