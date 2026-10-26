import { supabase, IOS_SUPABASE_URL, IOS_SUPABASE_ANON_KEY } from '@/integrations/ios-supabase/client';
import { localToday } from '@/lib/workTaskDefaultOrder';

export const MAIT_PROVIDER = 'mait_intelliweb';
export const MAIT_PARTIAL_WARNING = 'MAIT returned a partial/truncated result. VineTrack has not treated this range as complete.';
type Row = Record<string, any>;
export const maitRows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
export const maitRow = (value: unknown): Row => (Array.isArray(value) ? value[0] : value) ?? {};
// Normalize the live RPC envelope once; station_id is a weather module, never a network.
export function maitConfiguration(value: unknown) {
  const data = maitRow(value);
  const modules = maitRows(data.modules);
  return {
    connection: maitRow(data.connection),
    weatherModule: modules.find(m => m.module_role === 'weather' && m.is_active === true),
    controllerModules: modules.filter(m => m.module_role === 'irrigation_controller' && m.is_active === true),
    // Supplementary soil/leaf sensors live in separate MAIT modules on the same connection.
    sensorModules: modules.filter(m => m.module_role === 'sensor' && m.is_active === true),
    weatherMappings: maitRows(data.weather_mappings),
    sync: maitRows(data.sync),
  };
}
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
// Stable messages for the live proxy's typed error envelopes. These stay
// distinguishable from the generic status mappings so diagnostics can tell
// a MAIT upstream 401/204/400 apart from a VineTrack session/permission failure.
export const MAIT_AUTH_FAILED_MESSAGE = 'MAIT authentication failed. The supplied credentials were not accepted.';
export const MAIT_NO_DATA_MESSAGE = 'MAIT returned no data for this request.';
export const MAIT_BAD_REQUEST_MESSAGE = 'MAIT rejected the request format.';
export function maitHttpResult(status: number, body: Row): MaitResult {
  // Typed live-proxy error codes first: MAIT upstream 401 -> mait_authentication_failed,
  // MAIT upstream 204 (test action) -> HTTP 404 mait_no_data, MAIT upstream 400 -> mait_bad_request.
  if (body?.error === 'mait_authentication_failed') throw new Error(MAIT_AUTH_FAILED_MESSAGE);
  if (body?.error === 'mait_no_data') throw new Error(MAIT_NO_DATA_MESSAGE);
  if (body?.error === 'mait_bad_request') throw new Error(MAIT_BAD_REQUEST_MESSAGE);
  if (status === 401) throw new Error('Your session has expired. Sign in again to use MAIT.');
  if (status === 403) throw new Error('You do not have permission to use this MAIT action for this vineyard.');
  if (status === 400) throw new Error('MAIT could not accept this request. Check the credentials, module and date range.');
  // Truncated sync_usage deliberately returns success=false with HTTP 206.
  if (status === 206 && !body.error) return { data: body, status, partial: true, empty: false };
  if (status < 200 || status >= 300 || body.ok === false || body.success === false || body.error) throw new Error('MAIT could not complete the request. Check your connection and MAIT configuration, then retry.');
  return { data: body, status, partial: status === 206 || body.partial === true || body.data?.partial === true, empty: status === 204 };
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
  const body = response.status === 204 ? {} : await response.json().catch(() => {
    throw new Error('MAIT returned an unreadable response. Retry before saving or importing.');
  });
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
  return maitRows(data.columns).filter(c => c.channel_key != null && String(c.channel_key).replace(/\s/g, '').toLowerCase() !== 'datetime').map(c => ({ ...c, key: String(c.channel_key), number: c.channel_number ?? null, label: String(c.label ?? ''), unit: String(c.unit ?? ''), value: data.latest?.[c.channel_key] ?? null }));
}
export const MAIT_METRICS = [
  ['air_temperature', 'Air temperature'], ['relative_humidity', 'Relative humidity'], ['wind_speed', 'Wind speed'], ['wind_direction', 'Wind direction'], ['wind_gust', 'Wind gust'], ['rainfall', 'Rainfall'], ['rain_rate', 'Rain rate'], ['leaf_wetness', 'Leaf wetness'], ['soil_moisture', 'Soil moisture'], ['soil_temperature', 'Soil temperature'], ['none', 'Ignore'],
] as const;
export function maitWeatherReady(config: ReturnType<typeof maitConfiguration>) {
  return !!config.weatherModule && config.weatherMappings.some(m =>
    String(m.module_id) === String(config.weatherModule?.module_id) && m.is_active === true &&
    MAIT_METRICS.some(([id]) => id !== 'none' && id === m.canonical_metric));
}
export function maitConversion(unit: string, metric: string): { multiplier: number; offset: number } | null {
  const raw = unit.trim().toLowerCase();
  // MAIT reports wind direction with the degree symbol itself ("°") as the unit.
  // Check the raw unit before the degree symbol is stripped for temperature handling.
  if (metric === 'wind_direction' && ['°', 'deg', 'degree', 'degrees'].includes(raw)) return { multiplier: 1, offset: 0 };
  const u = raw.replace(/°/g, '');
  if (metric === 'none') return { multiplier: 1, offset: 0 };
  if (['air_temperature', 'soil_temperature'].includes(metric)) {
    if (['c', 'celsius'].includes(u)) return { multiplier: 1, offset: 0 };
    if (['f', 'fahrenheit'].includes(u)) return { multiplier: 5 / 9, offset: -32 * 5 / 9 };
  }
  if (['wind_speed', 'wind_gust'].includes(metric)) {
    if (['km/h', 'kph'].includes(u)) return { multiplier: 1, offset: 0 };
    if (u === 'm/s') return { multiplier: 3.6, offset: 0 };
    if (u === 'mph') return { multiplier: 1.609344, offset: 0 };
  }
  if (['rainfall', 'rain_rate'].includes(metric)) {
    const base = metric === 'rain_rate' ? u.replace(/\/(h|hr|hour)$/, '') : u;
    if (base === 'mm') return { multiplier: 1, offset: 0 };
    if (base === 'cm') return { multiplier: 10, offset: 0 };
    if (['in', 'inches'].includes(base)) return { multiplier: 25.4, offset: 0 };
  }
  if (['relative_humidity', 'soil_moisture'].includes(metric) && u === '%') return { multiplier: 1, offset: 0 };
  return null;
}
// Label-based wind mapping suggestions only — never auto-saved; the customer
// still confirms each mapping explicitly.
export const MAIT_WIND_INTERVAL_HINT = 'MAIT stations may provide interval minimum, average and maximum wind speeds rather than a separate instantaneous value. Review the MAIT labels before confirming.';
export function maitWindSuggestion(label: string): 'wind_speed' | 'wind_gust' | 'none' | null {
  const l = label.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!l.includes('wind') || !l.includes('speed')) return null;
  if (/\b(avg|average|mean)\b/.test(l)) return 'wind_speed';
  if (/\b(max|maximum|gust)\b/.test(l)) return 'wind_gust';
  if (/\b(min|minimum)\b/.test(l)) return 'none';
  return null;
}
// Supplementary sensor modules accept only these canonical metrics (backend-enforced).
export const MAIT_SENSOR_METRICS = [
  ['soil_moisture', 'Soil moisture'], ['soil_temperature', 'Soil temperature'], ['leaf_wetness', 'Leaf wetness'], ['none', 'Ignore'],
] as const;
export function setMaitSensorModule(vineyardId: string, moduleId: string, moduleName?: string | null) {
  return maitRpc('set_mait_intelliweb_sensor_module', vineyardId, { p_module_id: moduleId, p_module_name: moduleName ?? null });
}
export function removeMaitSensorModule(vineyardId: string, moduleId: string) {
  return maitRpc('remove_mait_intelliweb_sensor_module', vineyardId, { p_module_id: moduleId });
}
export interface MaitSupplementaryModule {
  module_id: string; module_name: string | null; status: 'ok' | 'no_data' | 'error';
  partial: boolean; observed_at: string | null;
  readings: { canonical_metric: string; channel_key: string; channel_number: number | null; source_label: string | null; source_unit: string | null; raw_value: number | null; value: number | null }[];
}
// Normalise action=supplementary_current; only mapped sensor metrics are shown,
// never unmapped channels or connection details.
export function maitSupplementary(data: Row): MaitSupplementaryModule[] {
  return maitRows(data.modules).map(m => ({
    module_id: String(m.module_id ?? ''),
    module_name: m.module_name ?? null,
    status: (['ok', 'no_data', 'error'] as const).includes(m.status) ? m.status : 'error',
    partial: m.partial === true,
    observed_at: m.observed_at ?? null,
    readings: maitRows(m.readings)
      .filter(r => MAIT_SENSOR_METRICS.some(([id]) => id !== 'none' && id === r.canonical_metric))
      .map(r => ({ canonical_metric: String(r.canonical_metric), channel_key: String(r.channel_key ?? ''), channel_number: r.channel_number ?? null, source_label: r.source_label ?? null, source_unit: r.source_unit ?? null, raw_value: r.raw_value ?? null, value: r.value ?? null })),
  })).filter(m => m.module_id !== '');
}
export function maitDateWindow(timezone: string | null, now = new Date()) {
  const today = localToday(timezone, now);
  const shift = (days: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  return { startDate: shift(-2), endDate: shift(1) }; // Three local days, exclusive end = tomorrow.
}
export function maitOutputs(data: Row): Row[] {
  const rows = maitRows(data.outputs ?? data.events ?? data.usage ?? data.data?.events ?? data.data?.usage);
  const outputs = new Map<number, Row>();
  rows.forEach(r => { const raw = r.channel_number ?? r.output_number ?? r.channel ?? r.external_valve_number; if (raw == null || raw === '') return; const n = Number(raw); if (Number.isInteger(n) && n >= 0) outputs.set(n, { number: n, name: String(r.channel_name ?? r.output_name ?? r.name ?? r.external_valve_name ?? '') }); });
  return [...outputs.values()].sort((a, b) => a.number - b.number);
}
export function maitSyncCounts(data: Row) {
  const s = data.summary ?? data.result ?? data;
  return [ ['Received', s.received], ['Committed', s.committed], ['Already existing', s.existing], ['Needs mapping', s.needs_mapping], ['Needs review', s.needs_review], ['Possible changed event', s.possible_changed_event] ] as const;
}
export function maitControllerSyncState(data: Row, moduleId: string) {
  return maitRows(data.sync).find(row => String(row.module_id) === moduleId && row.sync_kind === 'irrigation_usage');
}
export function maitDailyRainConfirmed(mappings: Row[]) {
  return mappings.some(m => m.is_active === true && m.canonical_metric === 'rainfall' && m.semantics === 'daily_cumulative');
}
export function irrigationSessionSourceLabel(session: { source_type?: string | null; configuration_snapshot?: Row | null }) {
  if (session.configuration_snapshot?.import?.provider === MAIT_PROVIDER) return 'MAIT iNTELLiWeb';
  return session.source_type === 'controller_api' ? 'Controller API' : session.source_type?.replace(/_/g, ' ') || '—';
}
