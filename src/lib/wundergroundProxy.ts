// Weather Underground integration helper for the portal.
//
// Mirrors the iOS Weather Data & Forecasting page. The vineyard-wide
// Weather Underground configuration is stored in
// `vineyard_weather_integrations` (provider = 'wunderground') and is
// managed via the WU-specific RPCs introduced in SQL 88 so changes made
// in the portal appear in iOS after sync and vice versa.
//
//   - get_vineyard_wunderground_config(p_vineyard_id)
//   - save_vineyard_wunderground_station(
//       p_vineyard_id, p_station_id, p_station_name,
//       p_station_latitude, p_station_longitude
//     )
//   - remove_vineyard_wunderground_station(p_vineyard_id)
//   - plan_wunderground_rainfall_backfill(
//       p_vineyard_id, p_days, p_timezone
//     ) → planner. Returns:
//         dates_to_fetch, dates_skipped_today,
//         dates_skipped_manual, dates_skipped_davis,
//         dates_already_wu
//
// HTTP calls to Weather Underground itself still go through the
// `wunderground-proxy` edge function on the iOS Supabase project:
//   - action WU_PROXY_ACTIONS.findNearby
//   - action WU_PROXY_ACTIONS.backfillDates (only for the dates returned
//     by the planner)
//
// We never display, log or send WU api credentials from this module.
import { supabase } from "@/integrations/ios-supabase/client";
import {
  WU_DEFAULT_BACKFILL_DAYS,
  WU_NEARBY_FUNCTION,
  WU_PROVIDER,
  WU_PROXY_ACTIONS,
  WU_PROXY_FUNCTION,
} from "./wundergroundConstants";

// Same iOS Supabase project as davis-proxy lives in.
const IOS_SUPABASE_URL = "https://tbafuqwruefgkbyxrxyb.supabase.co";
const IOS_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw";

export interface WuNearbyStation {
  station_id: string;
  station_name: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  neighborhood?: string | null;
}

export interface WuActionResult<T = unknown> {
  ok: boolean;
  code?: string;
  message?: string;
  data?: T;
}

export interface WundergroundConfig {
  configured: boolean;
  is_active?: boolean | null;
  station_id?: string | null;
  station_name?: string | null;
  station_latitude?: number | null;
  station_longitude?: number | null;
  last_tested_at?: string | null;
  last_test_status?: string | null;
  updated_at?: string | null;
  caller_role?: string | null;
  error?: string | null;
}

export interface WuBackfillPlan {
  dates_to_fetch: string[];
  dates_skipped_today: string[];
  dates_skipped_manual: string[];
  dates_skipped_davis: string[];
  dates_already_wu: string[];
}

export interface WuBackfillSummary {
  plan: WuBackfillPlan;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// SQL 88 RPCs
// ---------------------------------------------------------------------------

/** Load the vineyard-wide Weather Underground configuration. Source of
 *  truth = public.vineyard_weather_integrations (provider='wunderground'). */
export async function getWundergroundConfig(
  vineyardId: string,
): Promise<WundergroundConfig> {
  const res = await (supabase.rpc as any)("get_vineyard_wunderground_config", {
    p_vineyard_id: vineyardId,
  });
  if (res.error) {
    return { configured: false, error: res.error.message };
  }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { configured: false };
  return {
    configured: !!(row.station_id ?? row.configured),
    is_active: row.is_active ?? null,
    station_id: row.station_id ?? null,
    station_name: row.station_name ?? null,
    station_latitude: row.station_latitude ?? null,
    station_longitude: row.station_longitude ?? null,
    last_tested_at: row.last_tested_at ?? null,
    last_test_status: row.last_test_status ?? null,
    updated_at: row.updated_at ?? null,
    caller_role: row.caller_role ?? null,
  };
}

/** Upsert the vineyard-wide Weather Underground station. Owner/manager only. */
export async function saveWundergroundStation(args: {
  vineyardId: string;
  stationId: string;
  stationName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<{ ok: boolean; message?: string }> {
  const res = await (supabase.rpc as any)(
    "save_vineyard_wunderground_station",
    {
      p_vineyard_id: args.vineyardId,
      p_station_id: args.stationId,
      p_station_name: args.stationName ?? null,
      p_station_latitude: args.latitude ?? null,
      p_station_longitude: args.longitude ?? null,
    },
  );
  if (res.error) return { ok: false, message: res.error.message };
  return { ok: true };
}

/** Remove the vineyard-wide Weather Underground station. */
export async function removeWundergroundStation(
  vineyardId: string,
): Promise<{ ok: boolean; message?: string }> {
  const res = await (supabase.rpc as any)(
    "remove_vineyard_wunderground_station",
    { p_vineyard_id: vineyardId },
  );
  if (res.error) return { ok: false, message: res.error.message };
  return { ok: true };
}

/** Server-side planner. Returns which dates the proxy should fetch and which
 *  were skipped (today / Manual / Davis / already-WU). */
export async function planWundergroundBackfill(args: {
  vineyardId: string;
  days?: number;
  timezone?: string | null;
}): Promise<{ ok: boolean; plan?: WuBackfillPlan; message?: string }> {
  const tz =
    args.timezone ??
    (typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : null);
  const res = await (supabase.rpc as any)(
    "plan_wunderground_rainfall_backfill",
    {
      p_vineyard_id: args.vineyardId,
      p_days: args.days ?? WU_DEFAULT_BACKFILL_DAYS,
      p_timezone: tz,
    },
  );
  if (res.error) return { ok: false, message: res.error.message };
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  const plan: WuBackfillPlan = {
    dates_to_fetch: row?.dates_to_fetch ?? [],
    dates_skipped_today: row?.dates_skipped_today ?? [],
    dates_skipped_manual: row?.dates_skipped_manual ?? [],
    dates_skipped_davis: row?.dates_skipped_davis ?? [],
    dates_already_wu: row?.dates_already_wu ?? [],
  };
  return { ok: true, plan };
}

// ---------------------------------------------------------------------------
// wunderground-proxy edge function
// ---------------------------------------------------------------------------

async function callWuProxy<T = any>(
  payload: Record<string, unknown>,
): Promise<WuActionResult<T>> {
  let accessToken: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
  } catch {
    /* ignore */
  }
  if (!accessToken) {
    return { ok: false, code: "unauthorized", message: "Sign-in expired. Please sign in again." };
  }

  const url = `${IOS_SUPABASE_URL}/functions/v1/${WU_PROXY_FUNCTION}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: IOS_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    return {
      ok: false,
      code: "network_error",
      message: e?.message ?? "Network error contacting Weather Underground service.",
    };
  }

  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }

  if (resp.status === 404) {
    return { ok: false, code: "function_not_found", message: "Weather Underground service is not deployed." };
  }
  if (resp.status === 401) {
    return { ok: false, code: "unauthorized", message: "Sign-in expired. Please sign in again." };
  }
  if (resp.status === 403) {
    return { ok: false, code: "forbidden", message: "Only vineyard Owners and Managers can do this." };
  }

  const code: string | undefined = body?.code ?? body?.error_code;
  const ok = body?.ok ?? body?.success ?? (resp.ok && !code && !body?.error);
  if (!resp.ok || !ok) {
    return {
      ok: false,
      code,
      message: body?.message ?? body?.error ?? `HTTP ${resp.status}`,
      data: body,
    };
  }
  return { ok: true, code, message: body?.message, data: (body?.data ?? body) as T };
}

/** Nearest Weather Underground personal weather stations near lat/lon. */
export async function findNearbyWuStations(args: {
  vineyardId: string;
  lat: number;
  lon: number;
  limit?: number;
}): Promise<WuActionResult<{ stations: WuNearbyStation[] }>> {
  const r = await callWuProxy<any>({
    action: WU_PROXY_ACTIONS.findNearby,
    vineyardId: args.vineyardId,
    lat: args.lat,
    lon: args.lon,
    limit: args.limit ?? 10,
  });
  if (!r.ok) return r as any;
  const raw = (r.data as any)?.stations ?? (r.data as any)?.results ?? (r.data as any) ?? [];
  const list: WuNearbyStation[] = (Array.isArray(raw) ? raw : []).map((s: any) => ({
    station_id: String(s.station_id ?? s.stationId ?? s.id ?? ""),
    station_name:
      s.station_name ?? s.stationName ?? s.name ?? s.neighborhood ?? null,
    latitude: s.latitude ?? s.lat ?? null,
    longitude: s.longitude ?? s.lon ?? null,
    distance_km: s.distance_km ?? s.distanceKm ?? s.distance ?? null,
    neighborhood: s.neighborhood ?? null,
  }));
  return { ok: true, data: { stations: list } };
}

/** Planner-driven backfill. Calls plan_wunderground_rainfall_backfill, then
 *  asks the proxy to fetch + write only the explicit dates_to_fetch list.
 *  Manual and Davis rainfall are never overwritten; today is skipped. */
export async function backfillWuRainfall(args: {
  vineyardId: string;
  days?: number;
  timezone?: string | null;
}): Promise<WuActionResult<WuBackfillSummary>> {
  const planned = await planWundergroundBackfill({
    vineyardId: args.vineyardId,
    days: args.days ?? WU_DEFAULT_BACKFILL_DAYS,
    timezone: args.timezone ?? null,
  });
  if (!planned.ok || !planned.plan) {
    return { ok: false, message: planned.message ?? "Could not plan backfill" };
  }
  const plan = planned.plan;

  // Nothing to fetch — return a clean summary without hitting the proxy.
  if (plan.dates_to_fetch.length === 0) {
    return {
      ok: true,
      data: { plan, inserted: 0, updated: 0, skipped: 0, errors: [] },
    };
  }

  const r = await callWuProxy<any>({
    action: WU_PROXY_ACTIONS.backfillDates,
    vineyardId: args.vineyardId,
    dates: plan.dates_to_fetch,
  });
  if (!r.ok) {
    return {
      ok: false,
      code: r.code,
      message: r.message,
      data: { plan, inserted: 0, updated: 0, skipped: 0, errors: [r.message ?? "proxy_error"] },
    };
  }
  const d = (r.data ?? {}) as any;
  return {
    ok: true,
    data: {
      plan,
      inserted: Number(d.inserted ?? 0) || 0,
      updated: Number(d.updated ?? 0) || 0,
      skipped: Number(d.skipped ?? 0) || 0,
      errors: Array.isArray(d.errors) ? d.errors : [],
    },
  };
}
