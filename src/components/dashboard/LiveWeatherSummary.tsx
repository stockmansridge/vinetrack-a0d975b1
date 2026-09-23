// Vineyard weather for the Live Dashboard.
//
// Two distinct data products, in two separate inner cards:
//   1. "Live observations" — MEASURED data from the vineyard's configured
//      local observation provider (Davis WeatherLink or Weather Underground)
//   2. "5-day forecast"    — FORECAST data from the configured forecast provider
// Observations are never called forecasts and forecast samples are never
// called observations.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNowStrict } from "date-fns";
import {
  CloudRain,
  Droplets,
  Thermometer,
  Wind,
  CloudOff,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchLiveWeather,
  type LiveWeatherReading,
} from "@/lib/weatherStatusQuery";
import {
  fetchLocalObservationProvider,
  refreshObservationProvider,
  observationFailureTitle,
  observationProviderLabel,
  noNewerObservationsMessage,
  type LocalObservationProvider,
} from "@/lib/localObservationProvider";
import {
  summarizeForecast,
  forecastUnavailableReason,
} from "@/lib/rainForecastQuery";
import { fetchFiveDayForecast } from "@/lib/fiveDayForecast";
import { FiveDayForecastPanel } from "@/components/weather/FiveDayForecastPanel";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";

const SOURCE_LABELS: Record<string, string> = {
  davis_weatherlink: "Davis WeatherLink",
  davis: "Davis WeatherLink",
  wunderground: "Weather Underground",
  wunderground_pws: "Weather Underground",
  open_meteo: "Open-Meteo",
  open_meteo_fallback: "Open-Meteo fallback",
  open_meteo_forecast: "Open-Meteo",
  willyweather: "WillyWeather",
  willyweather_forecast: "WillyWeather",
  manual: "Manual",
};

export function sourceLabel(s?: string | null): string {
  if (!s) return "—";
  return SOURCE_LABELS[s] ?? s;
}

export function isWillyWeatherSource(s?: string | null): boolean {
  return !!s && s.toLowerCase().includes("willyweather");
}

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function windCardinal(deg?: number | null): string | null {
  if (deg == null || isNaN(deg)) return null;
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return CARDINALS[idx];
}

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(digits);
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function forecastBadgeLabel(days: Array<{ date: string; rainfall_mm: number | null }>, rf: RegionFormatters): string {
  const s = summarizeForecast(days);
  if (!s.firstRainDay || s.totalMm < 1) {
    return "No significant rain in next 5 days";
  }
  const d = new Date(s.firstRainDay.date);
  const day = isNaN(d.getTime()) ? s.firstRainDay.date : WEEKDAY[d.getDay()];
  const mm = Math.round((s.firstRainDay.rainfall_mm ?? 0) * 10) / 10;
  return `Forecast rain: ${rf.rainfall(mm)} ${day}`;
}

interface MetricProps {
  Icon: typeof Thermometer;
  label: string;
  value: string;
  hint?: string | null;
  iconClass: string;
}
function Metric({ Icon, label, value, hint, iconClass }: MetricProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", iconClass)}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold leading-tight">
          {value}
          {hint && <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

interface Props {
  vineyardId: string;
  /** How often the cached observation is re-read from the server (cheap). */
  refetchIntervalMs?: number;
}

export function LiveWeatherSummary({ vineyardId, refetchIntervalMs = 45_000 }: Props) {
  const rf = useRegionFormatters();
  // Forecast fetch mode: set to true only for a manual Refresh so the shared
  // server-side cache is bypassed for that one request.
  const forceForecast = useRef(false);
  // Throttle for the provider-neutral automatic stale top-up.
  const autoObservationRefreshAt = useRef(0);

  const weatherQ = useQuery({
    queryKey: ["live-weather", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchLiveWeather(vineyardId),
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: false,
  });
  const forecastQ = useQuery({
    queryKey: ["five-day-forecast", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => {
      const force = forceForecast.current;
      forceForecast.current = false;
      return fetchFiveDayForecast(vineyardId, { force });
    },
    refetchInterval: 15 * 60_000,
    refetchIntervalInBackground: false,
  });

  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [observationsRefreshing, setObservationsRefreshing] = useState(false);

  const weather = weatherQ.data;
  const forecast = forecastQ.data;

  const reading: LiveWeatherReading | null =
    weather && weather.available ? weather.reading : null;
  // Server-authoritative staleness (SQL contract: 20 minutes).
  const stale = weather && weather.available ? weather.stale : false;

  const observationsOk = !!(weather && weather.available && reading);
  const forecastOk = !!(forecast && forecast.available && forecast.forecast.days?.length);

  // Which local observation provider is configured/active for this vineyard.
  // Resolved from the existing weather-integration status, never assumed.
  const providerQ = useQuery({
    queryKey: ["local-observation-provider", vineyardId],
    enabled: !!vineyardId,
    staleTime: 5 * 60_000,
    queryFn: () => fetchLocalObservationProvider(vineyardId, reading?.source ?? null),
  });
  const observationProvider: LocalObservationProvider = providerQ.data ?? "none";

  // Automatic top-up: only ask the ACTIVE provider for new data when the
  // server says its cached observation is stale — never every polling tick,
  // and never a provider that is not configured for this vineyard.
  useEffect(() => {
    if (!vineyardId || !weather || !weather.available || !weather.stale) return;
    if (observationsRefreshing) return;
    if (Date.now() - autoObservationRefreshAt.current < 5 * 60_000) return;
    autoObservationRefreshAt.current = Date.now();
    let cancelled = false;
    (async () => {
      setObservationsRefreshing(true);
      const res = await refreshObservationProvider(vineyardId, observationProvider);
      // Providers without an upstream refresh action simply re-read the cache.
      if (!cancelled && res.ok) await weatherQ.refetch({ cancelRefetch: true });
      if (!cancelled) setObservationsRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vineyardId, weather?.available, (weather as any)?.stale, observationProvider]);

  const forecastBadge = (() => {
    if (forecastQ.isLoading) return { label: "Loading forecast…", title: undefined as string | undefined };
    if (!forecast) return { label: "Forecast unavailable", title: "No response from forecast service" };
    if (forecast.available === false) {
      return {
        label: "Forecast unavailable",
        title: forecastUnavailableReason(forecast.reason, forecast.message),
      };
    }
    const rainDays = forecast.forecast.days.map((day) => ({ date: day.date, rainfall_mm: day.rainMm }));
    return { label: forecastBadgeLabel(rainDays, rf), title: undefined };
  })();

  const forecastSourceLabel = (() => {
    if (!forecast || forecast.available === false) return "WillyWeather";
    return forecast.forecast.source;
  })();
  const forecastIsWilly = forecastSourceLabel === "WillyWeather";

  const refreshing = weatherQ.isFetching || forecastQ.isFetching || observationsRefreshing;

  const forecastFreshness = (() => {
    if (forecastQ.isFetching) return "Refreshing…";
    if (forecast && forecast.available && forecast.cache?.fetchedAt) {
      return `Updated ${formatDistanceToNowStrict(new Date(forecast.cache.fetchedAt))} ago`;
    }
    return null;
  })();
  const forecastCacheNotice =
    forecast && forecast.available && (forecast as any).refreshFailed
      ? "Showing last forecast · refresh failed"
      : null;

  /**
   * Manual Refresh. The two sources are refreshed independently and cannot
   * fail each other:
   *   Observations: the ACTIVE local observation provider is refreshed where
   *                 the canonical backend exposes a current-fetch action
   *                 (Davis: davis-proxy "current"). Providers without one
   *                 (Weather Underground today) simply re-read
   *                 get_vineyard_current_weather() — that is not an error.
   *   Forecast:     bypass the shared forecast cache, fetch the provider,
   *                 replace the cache. On failure the cached forecast stays.
   */
  const refreshAll = async () => {
    const previousObservedAt = reading?.observed_at ?? null;
    setObservationsRefreshing(true);
    forceForecast.current = true;

    const observationTask = (async () => {
      const provider = providerQ.data ?? (await fetchLocalObservationProvider(vineyardId, reading?.source ?? null));
      const refresh = await refreshObservationProvider(vineyardId, provider);
      const res = await weatherQ.refetch({ cancelRefetch: true });
      return { provider, refresh, result: res.data };
    })();
    const forecastTask = forecastQ.refetch({ cancelRefetch: true });

    const [observationOutcome, forecastOutcome] = await Promise.allSettled([observationTask, forecastTask]);
    setObservationsRefreshing(false);
    forceForecast.current = false;

    const obs = observationOutcome.status === "fulfilled" ? observationOutcome.value : null;
    const forecastResult = forecastOutcome.status === "fulfilled" ? forecastOutcome.value.data : undefined;

    const provider: LocalObservationProvider = obs?.provider ?? observationProvider;
    const cacheUsable = !!(obs?.result && obs.result.available);
    // Observation success = the active provider step did not fail AND usable
    // observation data is available after the cache re-read. It is NOT
    // "davis.proxy.ok".
    const observationsSuccess = !!(obs && obs.refresh.ok && cacheUsable);
    const forecastSuccess = !!(forecastResult && forecastResult.available && !(forecastResult as any).refreshFailed);

    if (observationsSuccess || forecastSuccess) setLastRefreshedAt(new Date());

    if (!observationsSuccess) {
      const providerMessage =
        obs && !obs.refresh.ok ? obs.refresh.message || "The weather station could not be reached." : null;
      const why =
        providerMessage ??
        (obs?.result && obs.result.available === false
          ? obs.result.reason === "rpc_missing"
            ? "Server-side weather function is not deployed."
            : obs.result.reason === "not_configured"
              ? "No weather station is configured for this vineyard."
              : obs.result.reason === "no_data"
                ? "The station has not reported an observation yet."
                : obs.result.message || "Live readings could not be fetched."
          : "Live readings could not be fetched.");
      toast({ title: observationFailureTitle(provider), description: why });
    } else if (
      previousObservedAt &&
      obs?.result &&
      obs.result.available &&
      obs.result.reading.observed_at === previousObservedAt
    ) {
      // Only a provider that actually performed an upstream fetch can claim
      // there was nothing newer.
      const description = obs ? noNewerObservationsMessage(obs.refresh) : null;
      if (description) toast({ title: "No newer observations", description });
    }

    if (!forecastSuccess) {
      const why =
        forecastResult && forecastResult.available === false
          ? forecastUnavailableReason(forecastResult.reason, forecastResult.message)
          : "Showing the last forecast instead.";
      toast({ title: `Forecast not refreshed (${forecastSourceLabel})`, description: why });
    }

    if (observationsSuccess && forecastSuccess) toast({ title: "Weather updated" });
  };

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="outline" className="gap-1" title={forecastBadge.title}>
        <CloudRain className="h-3 w-3" />
        {forecastBadge.label}
      </Badge>
      {lastRefreshedAt && (
        <span className="text-muted-foreground">
          last refreshed {formatDistanceToNowStrict(lastRefreshedAt)} ago
        </span>
      )}
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={refreshAll} disabled={refreshing}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );

  if (weatherQ.isLoading && forecastQ.isLoading) {
    return <Card className="p-4 text-sm text-muted-foreground">Loading vineyard weather…</Card>;
  }

  const wind = reading?.wind_speed_kmh;
  const dir = windCardinal(reading?.wind_direction_deg);
  const observedAgo = reading?.observed_at
    ? formatDistanceToNowStrict(new Date(reading.observed_at))
    : null;
  // The observation row's own source stays authoritative; the configured
  // provider label is only a fallback before any reading exists.
  const observationSourceLabel = reading
    ? sourceLabel(reading.source)
    : observationProviderLabel(observationProvider);

  return (
    <Card className="space-y-5 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Vineyard weather</div>
        {headerRight}
      </div>

      {/* ---------- Measured: Live observations (Davis WeatherLink) ---------- */}
      <section
        className={cn(
          "rounded-xl border bg-card p-4 shadow-sm",
          stale && "border-amber-500/40 bg-amber-500/5",
        )}
        data-testid="live-observations-card"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide">Live observations</div>
            <Badge variant="outline" className="text-[10px]">Source: {observationSourceLabel}</Badge>
            {reading?.station_name && (
              <span className="text-xs text-muted-foreground">{reading.station_name}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {davisRefreshing ? "Refreshing…" : observedAgo ? `Updated ${observedAgo} ago` : ""}
            </span>
          </div>
          {stale && observationsOk && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              Observations are stale
            </span>
          )}
        </div>

        {observationsOk && reading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Metric
              Icon={Thermometer}
              iconClass="bg-amber-500/15 text-amber-500"
              label="Temperature"
              value={reading.temperature_c != null ? rf.temperature(reading.temperature_c, 1) : "—"}
            />
            <Metric
              Icon={Droplets}
              iconClass="bg-sky-500/15 text-sky-500"
              label="Humidity"
              value={reading.humidity_pct != null ? `${fmt(reading.humidity_pct, 0)}%` : "—"}
            />
            <Metric
              Icon={Wind}
              iconClass="bg-emerald-500/15 text-emerald-500"
              label="Current wind"
              value={wind != null ? rf.wind(wind, 1) : "—"}
              hint={dir}
            />
            <Metric
              Icon={Wind}
              iconClass="bg-orange-500/15 text-orange-500"
              label="Current gust"
              value={reading.wind_gust_kmh != null ? rf.wind(reading.wind_gust_kmh, 1) : "—"}
            />
            <Metric
              Icon={CloudRain}
              iconClass="bg-blue-500/15 text-blue-500"
              label="Rain today"
              value={reading.rain_today_mm != null ? rf.rainfall(reading.rain_today_mm, 1) : "—"}
            />
            <Metric
              Icon={CloudRain}
              iconClass="bg-cyan-500/15 text-cyan-500"
              label="Rain rate"
              value={
                reading.rain_rate_mm_per_hr != null
                  ? `${rf.rainfall(reading.rain_rate_mm_per_hr)}/h`
                  : "—"
              }
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <CloudOff className="h-4 w-4" />
            <span>
              Live observations unavailable
              {weather && weather.available === false
                ? weather.reason === "rpc_missing"
                  ? " — server-side weather function not deployed"
                  : weather.reason === "no_data"
                    ? " — no recent observations"
                    : weather.reason === "not_configured"
                      ? " — no weather station configured"
                      : weather.message
                        ? ` — ${weather.message}`
                        : ""
                : ""}
            </span>
          </div>
        )}
      </section>

      {/* ---------- Forecast: provider-neutral 5-day forecast ---------- */}
      <section className="space-y-2" data-testid="forecast-card">
        {forecastOk && forecast?.available ? (
          <FiveDayForecastPanel
            vineyardId={vineyardId}
            forecast={forecast.forecast}
            rf={rf}
            freshnessLabel={forecastFreshness}
            cacheNotice={forecastCacheNotice}
          />
        ) : forecastQ.isLoading ? (
          <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">Loading 5-day forecast…</div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card px-3 py-3 text-xs text-muted-foreground">
            <CloudOff className="h-4 w-4" />
            <span>5-day forecast unavailable{forecastBadge.title ? ` — ${forecastBadge.title}` : ""}</span>
          </div>
        )}

        {forecastIsWilly && (
          <div className="text-xs text-muted-foreground">
            Weather forecast by{" "}
            <a
              href="https://www.willyweather.com.au"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-foreground"
            >
              WillyWeather
            </a>
          </div>
        )}
      </section>
    </Card>
  );
}

// ---------- Per-trip context evaluator ----------

export interface WeatherContext {
  reading: LiveWeatherReading | null;
  available: boolean;
  rainSoon: boolean;
}

export interface TripWeatherLabel {
  label: string;
  tone: "warning" | "info" | "muted";
}

const SPRAY_FUNCTIONS = new Set(["spray", "spraying", "foliar", "banded_spray"]);
const WIND_SPRAY_THRESHOLD_KMH = 15;

export function evaluateTripWeather(
  tripFunction: string | null | undefined,
  ctx: WeatherContext,
): TripWeatherLabel | null {
  if (!ctx.available || !ctx.reading) {
    return { label: "Weather unavailable", tone: "muted" };
  }
  const r = ctx.reading;
  if ((r.rain_rate_mm_per_hr ?? 0) > 0.1) {
    return { label: "Rain active", tone: "warning" };
  }
  const fn = (tripFunction ?? "").toLowerCase();
  if (SPRAY_FUNCTIONS.has(fn)) {
    if ((r.wind_speed_kmh ?? 0) >= WIND_SPRAY_THRESHOLD_KMH) {
      return { label: "Check wind before spraying", tone: "warning" };
    }
  }
  if (ctx.rainSoon) {
    return { label: "Rain forecast soon", tone: "info" };
  }
  return null;
}

export function TripWeatherBadge({ label }: { label: TripWeatherLabel | null }) {
  if (!label) return null;
  const cls =
    label.tone === "warning"
      ? "bg-amber-500/15 text-amber-700 border-amber-500/30"
      : label.tone === "info"
      ? "bg-blue-500/15 text-blue-700 border-blue-500/30"
      : "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cls}>
      {label.label}
    </Badge>
  );
}
