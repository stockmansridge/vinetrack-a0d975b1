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
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  fetchLiveWeather,
  type LiveWeatherReading,
} from "@/lib/weatherStatusQuery";
import {
  fetchRainForecast,
  forecastHeadline,
  summarizeForecast,
} from "@/lib/rainForecastQuery";

const SOURCE_LABELS: Record<string, string> = {
  davis_weatherlink: "Davis WeatherLink",
  davis: "Davis WeatherLink",
  wunderground: "Weather Underground",
  wunderground_pws: "Weather Underground",
  open_meteo: "Open-Meteo fallback",
  open_meteo_fallback: "Open-Meteo fallback",
  manual: "Manual",
};

export function sourceLabel(s?: string | null): string {
  if (!s) return "—";
  return SOURCE_LABELS[s] ?? s;
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

  const forecastLabel = (() => {
    if (forecastQ.isLoading) return "Loading forecast…";
    if (!forecast) return "Forecast unavailable";
    if (!forecast.available) return "Forecast unavailable";
    return forecastHeadline(summarizeForecast(forecast.days));
  })();

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="outline" className="gap-1">
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
      {stale && reading && (
        <Badge variant="outline" className="bg-amber-500/15 text-amber-700 border-amber-500/30">
          Stale
        </Badge>
      )}
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
              {weather && !weather.available && weather.reason === "rpc_missing"
                ? "Server-side weather RPC not deployed"
                : weather && !weather.available && weather.reason === "no_data"
                ? "No recent observations"
                : "Live readings could not be fetched"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="gap-1">
              <CloudRain className="h-3 w-3" />
              {forecastLabel}
            </Badge>
          </div>
        </div>
      </Card>
    );
  }

  const wind = reading.wind_speed_kmh;
  const dir = windCardinal(reading.wind_direction_deg);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Live vineyard weather</div>
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
