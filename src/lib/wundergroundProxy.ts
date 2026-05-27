// Weather Underground integration helper for the portal.
//
// Mirrors the iOS Weather Data & Forecasting page. The vineyard-wide
// Weather Underground configuration is stored in
// `vineyard_weather_integrations` (provider = 'wunderground') and is
// managed via the SAME server-side RPCs / edge function the iOS app uses,
// so changes made in the portal appear in iOS after sync and vice versa.
//
//   - get_vineyard_weather_integration(vineyard_id, 'wunderground')
//       members read non-secret fields (station id/name, etc.).
//   - save_vineyard_weather_integration(...)
//       owner/manager — upserts station id/name (api_key/secret left null
//       so the platform-level Weather Underground key is used).
//   - delete_vineyard_weather_integration(vineyard_id, 'wunderground')
//       owner/manager — removes the shared station.
//   - edge function `wunderground-proxy` on the iOS Supabase project
//       authenticated actions:
//         action "find_nearby" — nearest WU PWS to given lat/lon
//         action "backfill"    — chunked 14-day rainfall backfill
//
// We never display, log or send api credentials from this module.
import { supabase } from "@/integrations/ios-supabase/client";

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

  const url = `${IOS_SUPABASE_URL}/functions/v1/wunderground-proxy`;
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
    action: "find_nearby",
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

/** Backfill the last 14 days of Weather Underground rainfall. The server
 *  refuses to overwrite Manual or Davis rainfall rows and skips today
 *  because the daily summary is incomplete. */
export async function backfillWuRainfall(args: {
  vineyardId: string;
  days?: number;
}): Promise<WuActionResult<{ inserted?: number; updated?: number; skipped?: number; days?: number }>> {
  return callWuProxy({
    action: "backfill",
    vineyardId: args.vineyardId,
    days: args.days ?? 14,
  });
}
