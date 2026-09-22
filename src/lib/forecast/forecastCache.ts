// Provider-neutral vineyard forecast cache (Portal client).
//
// The authoritative cache is server-side in the canonical VineTrack project so
// every platform (Portal, iOS, Android) shares one forecast read and one
// provider call. Browser localStorage is NOT an authoritative cache — it is
// only used for the user's Highlight display preferences elsewhere.
//
// Backend contract (see sql/248_vineyard_forecast_cache.sql — handoff to Rork,
// NOT applied from this repository):
//   get_vineyard_forecast_cache(p_vineyard_id uuid, p_provider text)
//     -> { provider, provider_location_ref, timezone, fetched_at, stale_at,
//          provider_updated_at, schema_version, payload jsonb, is_stale }
//   upsert_vineyard_forecast_cache(p_vineyard_id uuid, p_provider text,
//     p_provider_location_ref text, p_timezone text, p_provider_updated_at
//     timestamptz, p_schema_version text, p_payload jsonb, p_ttl_minutes int)
//
// Until those functions exist the helpers below report "unavailable" and the
// caller fetches the provider directly — no browser-side substitute cache.
import { supabase } from "@/integrations/supabase/client";
import type { FiveDayForecast } from "@/lib/fiveDayForecast";

export const FORECAST_CACHE_SCHEMA_VERSION = "5day-6bucket-v2";
export const FORECAST_CACHE_TTL_MINUTES = 30;

export interface CachedForecast {
  forecast: FiveDayForecast;
  fetchedAt: string | null;
  staleAt: string | null;
  isStale: boolean;
}

function missingFunction(error: any): boolean {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "");
  return code === "PGRST202" || /not\s*found|does not exist/i.test(msg);
}

export function isCacheStale(row: {
  is_stale?: boolean | null;
  stale_at?: string | null;
}, now = Date.now()): boolean {
  if (typeof row.is_stale === "boolean") return row.is_stale;
  if (!row.stale_at) return true;
  const staleAt = new Date(row.stale_at).getTime();
  return !Number.isFinite(staleAt) || staleAt <= now;
}

/** Reads the shared cache. `null` means no usable cached forecast. */
export async function readForecastCache(
  vineyardId: string,
  provider: string,
): Promise<CachedForecast | null> {
  try {
    const res = await (supabase.rpc as any)("get_vineyard_forecast_cache", {
      p_vineyard_id: vineyardId,
      p_provider: provider,
    });
    if (res.error) return null;
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row?.payload) return null;
    if (row.schema_version && row.schema_version !== FORECAST_CACHE_SCHEMA_VERSION) return null;
    const forecast = row.payload as FiveDayForecast;
    if (!Array.isArray(forecast?.days) || !forecast.days.length) return null;
    return {
      forecast,
      fetchedAt: row.fetched_at ?? null,
      staleAt: row.stale_at ?? null,
      isStale: isCacheStale(row),
    };
  } catch {
    return null;
  }
}

/** Best-effort write. A missing cache function is not an error for the user. */
export async function writeForecastCache(args: {
  vineyardId: string;
  provider: string;
  providerLocationRef?: string | null;
  timezone?: string | null;
  forecast: FiveDayForecast;
  ttlMinutes?: number;
}): Promise<{ stored: boolean; reason?: "not_deployed" | "error" }> {
  try {
    const res = await (supabase.rpc as any)("upsert_vineyard_forecast_cache", {
      p_vineyard_id: args.vineyardId,
      p_provider: args.provider,
      p_provider_location_ref: args.providerLocationRef ?? null,
      p_timezone: args.timezone ?? args.forecast.timezone ?? null,
      p_provider_updated_at: args.forecast.updatedAt ?? null,
      p_schema_version: FORECAST_CACHE_SCHEMA_VERSION,
      p_payload: args.forecast,
      p_ttl_minutes: args.ttlMinutes ?? FORECAST_CACHE_TTL_MINUTES,
    });
    if (res.error) {
      return { stored: false, reason: missingFunction(res.error) ? "not_deployed" : "error" };
    }
    return { stored: true };
  } catch {
    return { stored: false, reason: "error" };
  }
}
