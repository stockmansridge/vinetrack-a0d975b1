import { supabase, IOS_SUPABASE_URL, IOS_SUPABASE_ANON_KEY } from '@/integrations/ios-supabase/client';
import { localToday } from '@/lib/workTaskDefaultOrder';

export const MAIT_PROVIDER = 'mait_intelliweb';
export const MAIT_PARTIAL_WARNING = 'MAIT returned a partial/truncated result. VineTrack has not treated this range as complete.';
type Row = Record<string, any>;
export const maitRows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
export const maitRow = (value: unknown): Row => (Array.isArray(value) ? value[0] : value) ?? {};
export async function maitRpc(name: string, vineyardId: string, args: Row = {}) {
  const { data, error } = await (supabase.rpc as any)(name, { p_vineyard_id: vineyardId, ...args });
  if (error) throw new Error(error.message || 'MAIT settings could not be updated.');
  return data;
}
export async function maitAccess(vineyardId: string) {
  const [manage, view] = await Promise.all([
    maitRpc('has_mait_intelliweb_manage_access', vineyardId),
    maitRpc('has_mait_intelliweb_view_access', vineyardId),
  ]);
  // RPC booleans are the authority; missing/unrecognised responses fail closed.
  return { manage: manage === true, view: view === true };
}
export interface MaitResult { data: Row; status: number; partial: boolean; empty: boolean }
export function maitHttpResult(status: number, body: Row): MaitResult {
  if (status === 401) throw new Error('Your session has expired. Sign in again to use MAIT.');
  if (status === 403) throw new Error('You do not have permission to use this MAIT action for this vineyard.');
  if (status === 400) throw new Error('MAIT could not accept this request. Check the credentials, module and date range.');
  if (status < 200 || status >= 300 || body.ok === false || body.error) throw new Error('MAIT could not complete the request. Check your connection and MAIT configuration, then retry.');
  return { data: body, status, partial: status === 206 || body.partial === true, empty: status === 204 };
}
export async function maitProxy(vineyardId: string, action: string, args: Row = {}): Promise<MaitResult> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in again to use MAIT.');
  let response: Response;
  try {
    response = await fetch(`${IOS_SUPABASE_URL}/functions/v1/mait-intelliweb-proxy`, {
      method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: IOS_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vineyardId, action, ...args }),
    });
  } catch { throw new Error('MAIT could not be reached. Check your connection and retry.'); }
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return maitHttpResult(response.status, body);
}
export function connectionArgs(input: { username: string; password: string; networkId: string; networkName?: string; timezone: string }) {
  return { p_username: input.username.trim(), p_password: input.password === '' ? null : input.password, p_network_id: input.networkId.trim(), p_network_name: input.networkName || null, p_timezone: input.timezone || null };
}
export function saveMaitConnection(vineyardId: string, input: Parameters<typeof connectionArgs>[0]) {
  return maitRpc('save_mait_intelliweb_connection', vineyardId, connectionArgs(input));
}
export function maitModules(data: Row): Row[] {
  return maitRows(data.modules ?? data.data?.modules).map(m => ({ ...m, id: String(m.module_id ?? m.moduleId ?? m.id), name: String(m.description ?? m.module_name ?? m.name ?? '') })).filter(m => m.id !== 'undefined');
}
export function maitChannels(data: Row): Row[] {
  return maitRows(data.channels ?? data.data?.channels).map(c => ({ ...c, key: String(c.channel_key ?? c.key ?? c.channel_number ?? c.channel), number: c.channel_number ?? c.channel ?? null, label: String(c.source_label ?? c.label ?? c.name ?? ''), unit: String(c.source_unit ?? c.unit ?? ''), value: c.latest_value ?? c.value ?? null }));
}
export const MAIT_METRICS = [
  ['temperature_c', 'Air temperature'], ['humidity_pct', 'Relative humidity'], ['wind_speed_kmh', 'Wind speed'], ['wind_direction_deg', 'Wind direction'], ['wind_gust_kmh', 'Wind gust'], ['rainfall_mm', 'Rainfall'], ['rain_rate_mm_h', 'Rain rate'], ['leaf_wetness', 'Leaf wetness'], ['soil_moisture_pct', 'Soil moisture'], ['soil_temperature_c', 'Soil temperature'], ['ignore', 'Ignore'],
] as const;
export function maitConversion(unit: string, metric: string): { multiplier: number; offset: number } | null {
  const u = unit.trim().toLowerCase().replace(/°/g, '');
  if (metric === 'ignore') return { multiplier: 1, offset: 0 };
  if (['temperature_c', 'soil_temperature_c'].includes(metric)) {
    if (['c', 'celsius'].includes(u)) return { multiplier: 1, offset: 0 };
    if (['f', 'fahrenheit'].includes(u)) return { multiplier: 5 / 9, offset: -32 * 5 / 9 };
  }
  if (['wind_speed_kmh', 'wind_gust_kmh'].includes(metric)) {
    if (['km/h', 'kph'].includes(u)) return { multiplier: 1, offset: 0 };
    if (u === 'm/s') return { multiplier: 3.6, offset: 0 };
    if (u === 'mph') return { multiplier: 1.609344, offset: 0 };
  }
  if (['rainfall_mm', 'rain_rate_mm_h'].includes(metric)) {
    const base = metric === 'rain_rate_mm_h' ? u.replace(/\/(h|hr|hour)$/, '') : u;
    if (base === 'mm') return { multiplier: 1, offset: 0 };
    if (base === 'cm') return { multiplier: 10, offset: 0 };
    if (['in', 'inches'].includes(base)) return { multiplier: 25.4, offset: 0 };
  }
  if (['humidity_pct', 'soil_moisture_pct'].includes(metric) && u === '%') return { multiplier: 1, offset: 0 };
  if (metric === 'wind_direction_deg' && ['degrees', 'deg'].includes(u)) return { multiplier: 1, offset: 0 };
  return null;
}
export function maitDateWindow(timezone: string | null, now = new Date()) {
  const today = localToday(timezone, now);
  const shift = (days: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  return { startDate: shift(-2), endDate: shift(1) }; // Three local days, exclusive end = tomorrow.
}
export function maitOutputs(data: Row): Row[] {
  const rows = maitRows(data.outputs ?? data.events ?? data.usage ?? data.data?.events ?? data.data?.usage);
  const outputs = new Map<number, Row>();
  rows.forEach(r => { const n = Number(r.channel_number ?? r.output_number ?? r.channel ?? r.external_valve_number); if (Number.isFinite(n) && n >= 0) outputs.set(n, { number: n, name: String(r.channel_name ?? r.output_name ?? r.name ?? r.external_valve_name ?? '') }); });
  return [...outputs.values()].sort((a, b) => a.number - b.number);
}
export function maitSyncCounts(data: Row) {
  const s = data.summary ?? data.result ?? data;
  return [ ['Received', s.received], ['Committed', s.committed], ['Already existing', s.already_existing], ['Needs mapping', s.needs_mapping], ['Needs review', s.needs_review], ['Possible changed event', s.possible_changed_event ?? s.possible_changed_events] ] as const;
}
export function maitDailyRainConfirmed(mappings: Row[]) {
  return mappings.some(m => m.is_active === true && m.canonical_metric === 'rainfall_mm' && m.semantics === 'daily_cumulative');
}
export function irrigationSessionSourceLabel(session: { source_type?: string | null; configuration_snapshot?: Row | null }) {
  if (session.configuration_snapshot?.import?.provider === MAIT_PROVIDER) return 'MAIT iNTELLiWeb';
  return session.source_type === 'controller_api' ? 'Controller API' : session.source_type?.replace(/_/g, ' ') || '—';
}
