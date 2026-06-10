// Live Weather + Rain Forecast summary card for the Live Dashboard.
// Read-only. Uses safe RPCs only — no direct provider calls from the browser.
//
// The card is split into two clearly labelled sections so observed values
// (Davis WeatherLink) are never confused with forecast values (WillyWeather):
//   1. "Live observations" — Davis WeatherLink
//   2. "7-day forecast"    — WillyWeather (or Open-Meteo fallback)
import { useState } from "react";
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
import {
  fetchLiveWeather,
  type LiveWeatherReading,
} from "@/lib/weatherStatusQuery";
import {
  fetchRainForecast,
  summarizeForecast,
  forecastUnavailableReason,
  type RainForecastDay,
} from "@/lib/rainForecastQuery";

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

function forecastBadgeLabel(days: RainForecastDay[]): string {
  const s = summarizeForecast(days);
  if (!s.firstRainDay || s.totalMm < 1) {
    return "No significant rain in next 7 days";
  }
  const d = new Date(s.firstRainDay.date);
  const day = isNaN(d.getTime()) ? s.firstRainDay.date : WEEKDAY[d.getDay()];
  const mm = Math.round((s.firstRainDay.rainfall_mm ?? 0) * 10) / 10;
  return `Forecast rain: ${mm} mm ${day}`;
}

interface MetricProps {
  Icon: typeof Thermometer;
  label: string;
  value: string;
  hint?: string | null;
}
function Metric({ Icon, label, value, hint }: MetricProps) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium leading-tight">
          {value}
          {hint && (
            <span className="text-xs text-muted-foreground font-normal ml-1">{hint}</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  vineyardId: string;
  refetchIntervalMs?: number;
}

export function LiveWeatherSummary({ vineyardId, refetchIntervalMs = 45_000 }: Props) {
  const weatherQ = useQuery({
    queryKey: ["live-weather", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchLiveWeather(vineyardId),
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: false,
  });
  const forecastQ = useQuery({
    queryKey: ["rain-forecast", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchRainForecast(vineyardId, 7),
    refetchInterval: 15 * 60_000,
    refetchIntervalInBackground: false,
  });

  // Only update after a successful refresh request completes.
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const weather = weatherQ.data;
  const forecast = forecastQ.data;

  const reading: LiveWeatherReading | null =
    weather && weather.available ? weather.reading : null;
  const stale = weather && weather.available ? weather.stale : false;

  const observationsOk = !!(weather && weather.available && reading);
  const forecastOk = !!(forecast && forecast.available && forecast.days?.length);

  const forecastBadge = (() => {
    if (forecastQ.isLoading) return { label: "Loading forecast…", title: undefined as string | undefined };
    if (!forecast) return { label: "Forecast unavailable", title: "No response from forecast service" };
    if (forecast.available === false) {
      return {
        label: "Forecast unavailable",
        title: forecastUnavailableReason(forecast.reason, forecast.message),
      };
    }
    return { label: forecastBadgeLabel(forecast.days), title: undefined };
  })();

  const forecastSourceLabel = (() => {
    if (!forecast || forecast.available === false) return "WillyWeather";
    if (forecast.via === "willyweather") return "WillyWeather";
    if (forecast.via === "open_meteo") return "Open-Meteo";
    return forecast.source ? sourceLabel(forecast.source) : "WillyWeather";
  })();
  const forecastIsWilly = forecastSourceLabel === "WillyWeather";

  const refreshing = weatherQ.isFetching || forecastQ.isFetching;
  const refreshAll = async () => {
    const previousObservedAt =
      weatherQ.data && weatherQ.data.available
        ? weatherQ.data.reading.observed_at ?? null
        : null;
    try {
      const [weatherRes, forecastRes] = await Promise.all([
        weatherQ.refetch({ cancelRefetch: true }),
        forecastQ.refetch({ cancelRefetch: true }),
      ]);

      const weatherResult = weatherRes.data;
      const forecastResult = forecastRes.data;

      const weatherSuccess = !!(weatherResult && weatherResult.available);
      const forecastSuccess = !!(forecastResult && forecastResult.available);

      // Only stamp last-refreshed once at least one request returned cleanly.
      if (weatherSuccess || forecastSuccess) {
        setLastRefreshedAt(new Date());
      }

      // Per-source feedback so one failing source doesn't make the whole card
      // appear stale.
      if (!weatherSuccess && !forecastSuccess) {
        toast({
          title: "Weather refresh failed",
          description: "Neither live observations nor forecast could be refreshed.",
          variant: "destructive",
        });
        return;
      }
      if (!weatherSuccess) {
        const why =
          weatherResult && weatherResult.available === false
            ? weatherResult.reason === "rpc_missing"
              ? "Server-side weather function is not deployed."
              : weatherResult.reason === "not_configured"
                ? "No weather provider is configured for this vineyard."
                : weatherResult.reason === "no_data"
                  ? "Weather provider has no observations yet."
                  : weatherResult.message || "Live readings could not be fetched."
            : "Live readings could not be fetched.";
        toast({ title: "Live observations unavailable (Davis)", description: why });
      } else if (previousObservedAt && weatherResult!.reading.observed_at === previousObservedAt) {
        toast({
          title: "No newer observations",
          description:
            "Davis WeatherLink returned no newer data. The station hasn't reported since the last update.",
        });
      }
      if (!forecastSuccess) {
        const why =
          forecastResult && forecastResult.available === false
            ? forecastUnavailableReason(forecastResult.reason, forecastResult.message)
            : "Forecast could not be refreshed.";
        toast({ title: "Forecast unavailable (WillyWeather)", description: why });
      }
      if (weatherSuccess && forecastSuccess) {
        toast({ title: "Weather updated" });
      }
    } catch (e: any) {
      toast({
        title: "Weather refresh failed",
        description: e?.message ?? "Unexpected error.",
        variant: "destructive",
      });
    }
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
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        onClick={refreshAll}
        disabled={refreshing}
      >
        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );

  if (weatherQ.isLoading && forecastQ.isLoading) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Loading vineyard weather…
      </Card>
    );
  }

  const wind = reading?.wind_speed_kmh;
  const dir = windCardinal(reading?.wind_direction_deg);
  const observedAgo = reading?.observed_at
    ? formatDistanceToNowStrict(new Date(reading.observed_at))
    : null;

  const observationSourceLabel = reading ? sourceLabel(reading.source) : "Davis WeatherLink";

  return (
    <Card className={`p-4 space-y-4 ${stale ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Vineyard weather</div>
        {headerRight}
      </div>

      {/* ---------- Section 1: Live observations (Davis) ---------- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live observations
            </div>
            <Badge variant="outline" className="text-[10px]">
              Source: {observationSourceLabel}
            </Badge>
            {reading?.station_name && (
              <span className="text-xs text-muted-foreground">{reading.station_name}</span>
            )}
            {observedAgo && (
              <span className="text-xs text-muted-foreground">
                updated {observedAgo} ago
              </span>
            )}
          </div>
          {stale && observationsOk && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Observations are stale
            </span>
          )}
        </div>

        {observationsOk && reading ? (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <Metric
              Icon={Thermometer}
              label="Temperature"
              value={reading.temperature_c != null ? `${fmt(reading.temperature_c, 1)}°C` : "—"}
            />
            <Metric
              Icon={Droplets}
              label="Humidity"
              value={reading.humidity_pct != null ? `${fmt(reading.humidity_pct, 0)}%` : "—"}
            />
            <Metric
              Icon={Wind}
              label="Current wind"
              value={wind != null ? `${fmt(wind, 1)} km/h` : "—"}
              hint={dir}
            />
            <Metric
              Icon={CloudRain}
              label="Rain recorded today"
              value={reading.rain_today_mm != null ? `${fmt(reading.rain_today_mm, 1)} mm` : "—"}
            />
            <Metric
              Icon={CloudRain}
              label="Current rain rate"
              value={
                reading.rain_rate_mm_per_hr != null
                  ? `${fmt(reading.rain_rate_mm_per_hr, 1)} mm/h`
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
                      ? " — no weather provider configured"
                      : weather.message
                        ? ` — ${weather.message}`
                        : ""
                : ""}
            </span>
          </div>
        )}
      </section>

      {/* ---------- Section 2: 7-day forecast (WillyWeather) ---------- */}
      <section className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            7-day forecast
          </div>
          <Badge variant="outline" className="text-[10px]">
            Source: {forecastSourceLabel}
          </Badge>
        </div>

        <ForecastStrip
          days={forecastOk ? forecast!.days : null}
          loading={forecastQ.isLoading}
          unavailableLabel={forecastBadge.title ?? forecastBadge.label}
        />

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

// ---------- 7-day forecast strip ----------

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ForecastStrip({
  days,
  loading,
  unavailableLabel,
}: {
  days: RainForecastDay[] | null;
  loading: boolean;
  unavailableLabel?: string;
}) {
  if (loading) {
    return (
      <div className="text-xs text-muted-foreground">Loading 7-day forecast…</div>
    );
  }
  if (!days || !days.length) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <CloudOff className="h-4 w-4" />
        <span>
          7-day forecast unavailable{unavailableLabel ? ` — ${unavailableLabel}` : ""}
        </span>
      </div>
    );
  }
  const week = days.slice(0, 7);
  return (
    <div className="grid grid-cols-7 gap-2">
      {week.map((d) => {
        const dt = new Date(d.date);
        const valid = !isNaN(dt.getTime());
        const dayLabel = valid ? WEEKDAY_SHORT[dt.getDay()] : d.date;
        const dateLabel = valid ? `${dt.getDate()}/${dt.getMonth() + 1}` : "";
        return (
          <div
            key={d.date}
            className="rounded-md border bg-muted/30 px-2 py-2 text-center min-w-0"
          >
            <div className="text-xs font-medium">{dayLabel}</div>
            <div className="text-[10px] text-muted-foreground mb-1">{dateLabel}</div>
            <div className="flex items-center justify-center gap-1 text-xs">
              <Thermometer className="h-3 w-3 text-muted-foreground" />
              <span>
                {d.temp_max_c != null ? `${fmt(d.temp_max_c, 0)}°` : "—"}
                {d.temp_min_c != null ? (
                  <span className="text-muted-foreground">/{fmt(d.temp_min_c, 0)}°</span>
                ) : null}
              </span>
            </div>
            <div className="flex items-center justify-center gap-1 text-xs mt-0.5">
              <Wind className="h-3 w-3 text-muted-foreground" />
              <span>{d.wind_max_kmh != null ? `${fmt(d.wind_max_kmh, 0)} km/h` : "—"}</span>
            </div>
            {(() => {
              const rain = d.rainfall_mm ?? 0;
              const hasRain = rain >= 5;
              return (
                <div className="flex items-center justify-center text-xs mt-0.5">
                  {hasRain ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                      <CloudRain className="h-3 w-3 text-white" />
                      {`${fmt(rain, 1)} mm`}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CloudRain className="h-3 w-3 text-muted-foreground" />
                      {d.rainfall_mm != null ? `${fmt(d.rainfall_mm, 1)} mm` : "—"}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
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
