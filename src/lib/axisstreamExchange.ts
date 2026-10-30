import { supabase } from "@/integrations/supabase/client";

/**
 * AxisStream Exchange — TEST-ONLY integration. Writes only staging tables via
 * the backend. It is never a selectable weather/rainfall source and the token
 * is never read back, logged, persisted in the browser or put in a URL.
 */
export const AXISSTREAM_TOKEN_SOURCE_URL = "https://hq.axisstream.co/exchange/create";
export const AXISSTREAM_POLL_MINUTES = 15;
export const AXISSTREAM_ALLOWED_MODES = ["disabled", "testing"] as const;
export type AxisMode = (typeof AXISSTREAM_ALLOWED_MODES)[number];

export interface AxisDevice { code: string; name: string; kind: string | null }
export interface AxisConfig {
  configured: boolean;
  hasToken: boolean;
  mode: AxisMode;
  lastTestedAt: string | null;
  lastStatus: string | null;
  summary: string | null;
  weatherCode: string | null;
  rainCode: string | null;
  leafCode: string | null;
  devices: AxisDevice[];
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Normalise the RPC envelope defensively; any token-like field is dropped. */
export function normaliseAxisConfig(raw: unknown): AxisConfig {
  const r = (Array.isArray(raw) ? raw[0] : raw) as Record<string, any> | null;
  const c = (r?.connection ?? r ?? {}) as Record<string, any>;
  const devicesRaw = (r?.devices ?? c.devices ?? []) as any[];
  const mode = c.mode === "testing" ? "testing" : "disabled";
  return {
    configured: Boolean(r?.configured ?? c.id ?? c.has_token),
    hasToken: Boolean(c.has_token ?? r?.has_token ?? c.token_configured),
    mode,
    lastTestedAt: str(c.last_tested_at ?? c.last_test_at),
    lastStatus: str(c.last_test_status ?? c.last_status ?? c.status),
    summary: str(c.last_test_summary ?? c.summary ?? c.last_error),
    weatherCode: str(c.weather_code ?? c.weather_station_code),
    rainCode: str(c.rain_code ?? c.rain_gauge_code),
    leafCode: str(c.leaf_code ?? c.leaf_wetness_code),
    devices: Array.isArray(devicesRaw)
      ? devicesRaw.map((d) => ({ code: String(d.device_code ?? d.code ?? d.id ?? ""), name: String(d.name ?? d.device_name ?? d.device_code ?? d.code ?? ""), kind: str(d.kind ?? d.device_type ?? d.type) })).filter((d) => d.code)
      : [],
  };
}

export async function getAxisConfig(vineyardId: string): Promise<AxisConfig> {
  const { data, error } = await (supabase.rpc as any)("get_axisstream_exchange_configuration", { p_vineyard_id: vineyardId });
  if (error) throw new Error(error.message || "Could not load AxisStream status");
  return normaliseAxisConfig(data);
}

export interface AxisSaveInput { token?: string; mode?: AxisMode; weatherCode?: string | null; rainCode?: string | null; leafCode?: string | null }

/** Omitted token (null) preserves the stored server token. Live mode is never sent. */
export function buildAxisSavePayload(vineyardId: string, input: AxisSaveInput) {
  const token = input.token?.trim() ? input.token.trim() : null;
  if (input.mode && !AXISSTREAM_ALLOWED_MODES.includes(input.mode)) throw new Error("Only disabled or testing mode is allowed");
  return {
    p_vineyard_id: vineyardId,
    p_token: token,
    p_mode: input.mode ?? null,
    p_weather_code: input.weatherCode ?? null,
    p_rain_code: input.rainCode ?? null,
    p_leaf_code: input.leafCode ?? null,
  };
}

export async function saveAxisConfig(vineyardId: string, input: AxisSaveInput) {
  const { error } = await (supabase.rpc as any)("save_axisstream_exchange_configuration", buildAxisSavePayload(vineyardId, input));
  if (error) throw new Error(error.message || "Could not save AxisStream settings");
}

export async function removeAxisConfig(vineyardId: string) {
  const { error } = await (supabase.rpc as any)("remove_axisstream_exchange_configuration", { p_vineyard_id: vineyardId });
  if (error) throw new Error(error.message || "Could not remove AxisStream connection");
}

/** Map preview-function failures to clear admin text. */
export function describeAxisTestError(status: number | undefined, body: any): string {
  const code = String(body?.error_code ?? body?.error ?? "").toLowerCase();
  const msg = str(body?.message) ?? str(body?.user_message);
  if (code.includes("throttl") || code.includes("rate") || status === 429 || (status === 409 && /15|throttl|recent/i.test(msg ?? code)))
    return `Tested recently — AxisStream is polled at most every ${AXISSTREAM_POLL_MINUTES} minutes. ${msg ?? ""}`.trim();
  if (code.includes("expired")) return "AxisStream token has expired. Create a new token and replace it.";
  if (code.includes("invalid") || code.includes("unauthor") || code.includes("401")) return "AxisStream rejected the token. Check it and replace it.";
  if (status === 409) return msg ?? "Connection is not ready for testing (save a token and set Testing mode).";
  if (status === 502) return msg ?? "AxisStream could not be reached or returned an error.";
  if (status === 401 || status === 403) return "Not authorised — System Admin and vineyard membership required.";
  return msg ?? "Test failed.";
}

export interface AxisTestResult { ok: boolean; message: string; details?: any }

export async function testAxisConnection(vineyardId: string): Promise<AxisTestResult> {
  const { data, error } = await supabase.functions.invoke("axisstream-exchange-preview", { body: { vineyard_id: vineyardId, action: "test" } });
  if (error) {
    const ctx: any = (error as any).context;
    let body: any = null;
    let status: number | undefined;
    if (ctx && typeof ctx.status === "number") {
      status = ctx.status;
      try { body = await ctx.clone().json(); } catch { body = null; }
    }
    return { ok: false, message: describeAxisTestError(status, body) };
  }
  if (data && (data.ok === false || data.error)) return { ok: false, message: describeAxisTestError(data.status, data), details: data };
  return { ok: true, message: str(data?.summary) ?? str(data?.message) ?? "Test completed — readings staged only.", details: data };
}
