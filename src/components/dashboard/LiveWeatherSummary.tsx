// Live Weather + Rain Forecast summary card for the Live Dashboard.
// Read-only. Uses safe RPCs only — no direct provider calls from the browser.
import { useQuery } from "@tanstack/react-query";
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
  forecastHeadline,
  forecastUnavailableReason,
  summarizeForecast,
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
    // Forecast doesn't need to refresh as often as live readings.
    refetchInterval: 15 * 60_000,
    refetchIntervalInBackground: false,
  });

  const weather = weatherQ.data;
  const forecast = forecastQ.data;

  const reading: LiveWeatherReading | null =
    weather && weather.available ? weather.reading : null;
  const stale = weather && weather.available ? weather.stale : false;

  const forecastInfo = (() => {
    if (forecastQ.isLoading) return { label: "Loading forecast…", title: undefined as string | undefined };
    if (!forecast) return { label: "Forecast unavailable", title: "No response from forecast service" };
    if (forecast.available === false) {
      return {
        label: "Forecast unavailable",
        title: forecastUnavailableReason(forecast.reason, forecast.message),
      };
    }
    const isWilly =
      forecast.via === "willyweather" || isWillyWeatherSource(forecast.source);
    const sourceText =
      isWilly
        ? "Forecast source: WillyWeather"
        : forecast.via === "open_meteo"
          ? "Forecast source: Open-Meteo"
          : forecast.source
            ? `Forecast source: ${sourceLabel(forecast.source)}`
            : undefined;
    return {
      label: forecastHeadline(summarizeForecast(forecast.days)),
      title: sourceText,
      sourceText,
      isWilly: isWillyWeatherSource(forecast.source),
    };
  })();
  const forecastLabel = forecastInfo.label;

  const refreshing = weatherQ.isFetching || forecastQ.isFetching;
  const refreshAll = () => {
    weatherQ.refetch();
    forecastQ.refetch();
  };

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="outline" className="gap-1" title={forecastInfo.title}>
        <CloudRain className="h-3 w-3" />
        {forecastLabel}
      </Badge>
      {reading && (
        <Badge variant="outline">{sourceLabel(reading.source)}</Badge>
      )}
      {reading?.station_name && (
        <span className="text-muted-foreground">{reading.station_name}</span>
      )}
      {reading?.observed_at && (
        <span className="text-muted-foreground">
          updated {formatDistanceToNowStrict(new Date(reading.observed_at))} ago
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

  // Unavailable state — soft, never red.
  if (weatherQ.isLoading) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Loading vineyard weather…
      </Card>
    );
  }
  if (!weather || !weather.available || !reading) {
    return (
      <Card className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <CloudOff className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Weather unavailable</span>
            <span className="text-muted-foreground text-xs">
              {weather && weather.available === false && weather.reason === "rpc_missing"
                ? "Server-side weather RPC not deployed"
                : weather && weather.available === false && weather.reason === "no_data"
                ? "No recent observations"
                : "Live readings could not be fetched"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="gap-1" title={forecastInfo.title}>
              <CloudRain className="h-3 w-3" />
              {forecastLabel}
            </Badge>
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
        </div>
      </Card>
    );
  }

  const wind = reading.wind_speed_kmh;
  const dir = windCardinal(reading.wind_direction_deg);
  const observedAgo = reading.observed_at
    ? formatDistanceToNowStrict(new Date(reading.observed_at))
    : null;

  return (
    <Card className={`p-4 space-y-3 ${stale ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium flex items-center gap-2">
          {stale && <AlertTriangle className="h-4 w-4 text-amber-600" />}
          {stale
            ? `Weather data stale — last updated ${observedAgo} ago`
            : "Live vineyard weather"}
        </div>
        {headerRight}
      </div>
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
          label="Wind"
          value={wind != null ? `${fmt(wind, 1)} km/h` : "—"}
          hint={dir}
        />
        <Metric
          Icon={CloudRain}
          label="Rain today"
          value={reading.rain_today_mm != null ? `${fmt(reading.rain_today_mm, 1)} mm` : "—"}
        />
        <Metric
          Icon={CloudRain}
          label="Rain rate"
          value={
            reading.rain_rate_mm_per_hr != null
              ? `${fmt(reading.rain_rate_mm_per_hr, 1)} mm/h`
              : "—"
          }
        />
      </div>
      <ForecastStrip
        days={forecast && forecast.available ? forecast.days : null}
        loading={forecastQ.isLoading}
        unavailableLabel={forecastInfo.title ?? forecastLabel}
      />
      {forecastInfo.sourceText && (
        <div className="text-xs text-muted-foreground">{forecastInfo.sourceText}</div>
      )}
      {forecastInfo.isWilly && (
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
      <div className="text-xs text-muted-foreground border-t pt-3">Loading 7-day forecast…</div>
    );
  }
  if (!days || !days.length) {
    return (
      <div className="text-xs text-muted-foreground border-t pt-3">
        7-day forecast unavailable{unavailableLabel ? ` — ${unavailableLabel}` : ""}
      </div>
    );
  }
  const week = days.slice(0, 7);
  return (
    <div className="border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground mb-2">7-day forecast</div>
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
                const heavy = (d.rainfall_mm ?? 0) >= 5;
                return (
                  <div
                    className={`flex items-center justify-center gap-1 text-xs mt-0.5 rounded px-1 ${
                      heavy ? "bg-blue-500/15 text-blue-700 font-semibold" : ""
                    }`}
                  >
                    <CloudRain className={`h-3 w-3 ${heavy ? "text-blue-600" : "text-muted-foreground"}`} />
                    <span>{d.rainfall_mm != null ? `${fmt(d.rainfall_mm, 1)} mm` : "—"}</span>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
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
