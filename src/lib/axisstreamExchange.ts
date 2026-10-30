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

export interface AxisDevice { key: string; projectCode: string; dataset: string | null; code: string; name: string; kind: string | null; lastSeenAt: string | null }
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
  stagedReadingCount: number | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Render an object summary as readable text; never "[object Object]". */
export function formatAxisSummary(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "object") return null;
  const o = v as Record<string, any>;
  const parts: string[] = [];
  const counts = o.counts && typeof o.counts === "object" ? o.counts : null;
  if (counts) {
    const c = [["weather", "weather"], ["rain_gauge", "rain gauge"], ["leaf_wetness", "leaf wetness"]]
      .filter(([k]) => num(counts[k]) != null).map(([k, l]) => `${counts[k]} ${l}`);
    if (c.length) parts.push(c.join(", "));
  }
  if (num(o.devices) != null) parts.push(`${o.devices} devices`);
  if (num(o.staged_readings) != null) parts.push(`${o.staged_readings} staged readings`);
  if (str(o.error)) parts.push(`error: ${o.error}`);
  if (str(o.message)) parts.push(o.message);
  if (parts.length) return parts.join(" · ");
  const flat = Object.entries(o).filter(([, x]) => ["string", "number", "boolean"].includes(typeof x)).map(([k, x]) => `${k}: ${x}`);
  return flat.length ? flat.join(" · ") : null;
}

/** Normalise the deployed get_axisstream_exchange_configuration envelope. */
export function normaliseAxisConfig(raw: unknown): AxisConfig {
  const r = (raw ?? {}) as Record<string, any>;
  const c = (r.connection ?? {}) as Record<string, any>;
  const devicesRaw = Array.isArray(r.devices) ? r.devices : [];
  const configured = c.configured === true;
  return {
    configured,
    hasToken: configured,
    mode: c.mode === "testing" ? "testing" : "disabled",
    lastTestedAt: str(c.last_tested_at),
    lastStatus: str(c.last_test_status),
    summary: formatAxisSummary(c.last_test_summary),
    weatherCode: str(c.selected_weather_code),
    rainCode: str(c.selected_rain_code),
    leafCode: str(c.selected_leaf_code),
    devices: devicesRaw.map((d: any) => {
      const projectCode = String(d?.project_code ?? "");
      const dataset = str(d?.dataset);
      const code = String(d?.code ?? "");
      return { key: `${projectCode}|${dataset ?? ""}|${code}`, projectCode, dataset, code, name: str(d?.name) ?? code, kind: dataset, lastSeenAt: str(d?.last_seen_at) };
    }).filter((d: AxisDevice) => d.code),
    stagedReadingCount: num(r.staged_reading_count),
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

/** Map preview-function failures to safe admin text (no token detail). */
export function describeAxisTestError(status: number | undefined, body: any): string {
  const code = String(body?.error ?? body?.error_code ?? "");
  const msg = str(body?.message);
  if (code === "minimum_15_minute_interval" || (status === 409 && /15/.test(code))) {
    const s = num(body?.retry_after_seconds);
    return `Tested recently — AxisStream can be polled at most every ${AXISSTREAM_POLL_MINUTES} minutes.${s != null ? ` Try again in about ${Math.max(1, Math.ceil(s / 60))} min.` : ""}`;
  }
  if (status === 502) return msg ?? "AxisStream returned a non-success status; verify Exchange token";
  if (status === 409) return msg ?? "Connection is not ready for testing (save a token and keep Testing mode).";
  if (status === 401 || status === 403) return "Not authorised — System Admin and vineyard membership required.";
  return msg ?? (code ? `Test failed (${code}).` : "Test failed.");
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
  return { ok: true, message: `Test succeeded (staging only): ${formatAxisSummary(data) ?? "no counts returned"}`, details: data };
}
