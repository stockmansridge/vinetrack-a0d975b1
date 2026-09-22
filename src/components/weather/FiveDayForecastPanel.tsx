import { useEffect, useMemo, useState } from "react";
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Filter,
  Snowflake,
  Sun,
  Wind,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { FiveDayForecast, ForecastDay } from "@/lib/fiveDayForecast";
import {
  DEFAULT_FORECAST_HIGHLIGHTS,
  forecastHighlightStorageKey,
  parseForecastHighlightPreferences,
  shouldHighlight,
  type ForecastHighlightPreferences,
} from "@/lib/forecastHighlightPreferences";
import type { RegionFormatters } from "@/lib/regionFormatters";

interface Props {
  vineyardId: string;
  forecast: FiveDayForecast;
  rf: RegionFormatters;
}

function parseLocalDate(date: string): Date | null {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function WeatherIcon({ code, className }: { code: number | string | null; className?: string }) {
  const value = typeof code === "string" ? Number(code) : code;
  if (value === 0) return <Sun className={className} />;
  if (value === 1 || value === 2) return <CloudSun className={className} />;
  if (value === 45 || value === 48) return <CloudFog className={className} />;
  if (value != null && [71, 73, 75, 77, 85, 86].includes(value)) return <Snowflake className={className} />;
  if (value != null && [95, 96, 99].includes(value)) return <CloudLightning className={className} />;
  if (value != null && value >= 51) return <CloudRain className={className} />;
  return <Cloud className={className} />;
}

interface ChartRow {
  index: number;
  date: string;
  time: string;
  endTime: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  windMaxKmh: number | null;
}

function chartRows(days: ForecastDay[]): ChartRow[] {
  return days.flatMap((day, dayIndex) =>
    day.periods.map((period, bucketIndex) => ({
      index: dayIndex * 6 + bucketIndex,
      date: day.date,
      time: period.startTimeLocal,
      endTime: period.endTimeLocal,
      tempMinC: period.observationCount ? period.tempMinC : null,
      tempMaxC: period.observationCount ? period.tempMaxC : null,
      windMaxKmh: period.observationCount ? period.windMaxKmh : null,
    })),
  );
}

function TooltipCard({ active, payload, rf, kind }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;
  const date = parseLocalDate(row.date);
  const heading = date
    ? date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
    : row.date;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-semibold">{heading}</div>
      <div className="mb-1 text-muted-foreground">{row.time}–{row.endTime} local</div>
      {kind === "temperature" ? (
        <>
          <div>High: {row.tempMaxC == null ? "—" : rf.temperature(row.tempMaxC, 1)}</div>
          <div>Low: {row.tempMinC == null ? "—" : rf.temperature(row.tempMinC, 1)}</div>
        </>
      ) : (
        <div>Wind: {row.windMaxKmh == null ? "—" : rf.wind(row.windMaxKmh, 1)}</div>
      )}
    </div>
  );
}

function TrendChart({ rows, rf, kind }: { rows: ChartRow[]; rf: RegionFormatters; kind: "temperature" | "wind" }) {
  const boundaries = [5.5, 11.5, 17.5, 23.5];
  return (
    <div className="h-36 w-full" data-testid={`${kind}-trend`} data-point-count={rows.length}>
      <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 10, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
        <XAxis dataKey="index" hide domain={[0, 29]} />
        <YAxis
          width={48}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          tickFormatter={(value) => kind === "temperature" ? rf.temperature(value, 0) : rf.wind(value, 0)}
        />
        {boundaries.map((value) => <ReferenceLine key={value} x={value} stroke="hsl(var(--border))" />)}
        <Tooltip content={<TooltipCard rf={rf} kind={kind} />} />
        {kind === "temperature" ? (
          <>
            <Line connectNulls={false} type="monotone" dataKey="tempMaxC" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            <Line connectNulls={false} type="monotone" dataKey="tempMinC" stroke="hsl(var(--card-foreground))" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </>
        ) : (
          <Line connectNulls={false} type="monotone" dataKey="windMaxKmh" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        )}
      </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function HighlightSetting({
  label,
  unit,
  setting,
  displayValue,
  onToggle,
  onValue,
}: {
  label: string;
  unit: string;
  setting: { enabled: boolean; threshold: number };
  displayValue: number;
  onToggle: (enabled: boolean) => void;
  onValue: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b py-3 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-1 flex items-center gap-2">
          <Input
            aria-label={`${label} highlight threshold`}
            type="number"
            min="0"
            step={label === "Humidity" ? "1" : "0.1"}
            value={Number(displayValue.toFixed(2))}
            onChange={(event) => onValue(Number(event.target.value))}
            className="h-8 w-24"
            disabled={!setting.enabled}
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <Switch aria-label={`${label} highlights`} checked={setting.enabled} onCheckedChange={onToggle} />
    </div>
  );
}

export function FiveDayForecastPanel({ vineyardId, forecast, rf }: Props) {
  const storageKey = forecastHighlightStorageKey(vineyardId);
  const [preferences, setPreferences] = useState<ForecastHighlightPreferences>(() =>
    typeof window === "undefined"
      ? structuredClone(DEFAULT_FORECAST_HIGHLIGHTS)
      : parseForecastHighlightPreferences(window.localStorage.getItem(storageKey)),
  );

  useEffect(() => {
    setPreferences(parseForecastHighlightPreferences(window.localStorage.getItem(storageKey)));
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  }, [preferences, storageKey]);

  const days = forecast.days.slice(0, 5);
  const rows = useMemo(() => chartRows(days), [days]);
  const hasThirtyPositions = rows.length === 30 && rows.some((row) => row.tempMinC != null || row.tempMaxC != null || row.windMaxKmh != null);
  const rainDisplay = rf.settings.distance_unit === "imperial" ? preferences.rain.threshold / 25.4 : preferences.rain.threshold;
  const windDisplay = rf.settings.distance_unit === "imperial" ? preferences.wind.threshold / 1.609344 : preferences.wind.threshold;

  const update = (key: keyof ForecastHighlightPreferences, patch: Partial<{ enabled: boolean; threshold: number }>) => {
    setPreferences((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-card" data-testid="five-day-forecast">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="font-semibold">5-day forecast</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Forecast: {forecast.source}
            {forecast.updatedAt ? ` · updated ${rf.dateTime(forecast.updatedAt)}` : ""}
            {forecast.timezone ? ` · ${forecast.timezone}` : ""}
          </div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm"><Filter className="mr-2 h-4 w-4" />Highlights</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <div className="font-semibold">Forecast highlights</div>
            <p className="mt-1 text-xs text-muted-foreground">Display only. Vineyard weather alerts are unchanged.</p>
            <HighlightSetting label="Rain" unit={rf.rainfallUnitLabel} setting={preferences.rain} displayValue={rainDisplay} onToggle={(enabled) => update("rain", { enabled })} onValue={(value) => { const canonical = rf.rainfallToCanonical(value); if (canonical != null) update("rain", { threshold: canonical }); }} />
            <HighlightSetting label="Wind" unit={rf.windUnitLabel} setting={preferences.wind} displayValue={windDisplay} onToggle={(enabled) => update("wind", { enabled })} onValue={(value) => { const canonical = rf.windToCanonical(value); if (canonical != null) update("wind", { threshold: canonical }); }} />
            <HighlightSetting label="Humidity" unit="%" setting={preferences.humidity} displayValue={preferences.humidity.threshold} onToggle={(enabled) => update("humidity", { enabled })} onValue={(value) => { if (Number.isFinite(value) && value >= 0) update("humidity", { threshold: value }); }} />
            <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setPreferences(structuredClone(DEFAULT_FORECAST_HIGHLIGHTS))}>Reset to defaults</Button>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-5 divide-x" data-testid="forecast-day-headers">
        {days.map((day) => {
          const date = parseLocalDate(day.date);
          return (
            <div key={day.date} className="min-w-0 px-2 py-4 text-center sm:px-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">{date?.toLocaleDateString(undefined, { weekday: "short" }) ?? day.date}</div>
              <div className="text-xs text-muted-foreground">{date?.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
              <WeatherIcon code={day.conditionCode} className="mx-auto my-2 h-8 w-8 text-primary" />
              <div className="min-h-8 text-xs text-muted-foreground">{day.conditionDescription ?? "Forecast"}</div>
              <div className="mt-1 text-base font-semibold">
                {day.tempMinC == null ? "—" : rf.temperature(day.tempMinC, 0)}
                <span className="px-1 text-muted-foreground">/</span>
                <span className="text-destructive">{day.tempMaxC == null ? "—" : rf.temperature(day.tempMaxC, 0)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <section className="border-t px-3 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold"><span className="h-2 w-2 rounded-full bg-destructive" />Temperature high <span className="ml-2 h-2 w-2 rounded-full bg-card-foreground" />low</div>
        {hasThirtyPositions ? <TrendChart rows={rows} rf={rf} kind="temperature" /> : <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">Detailed temperature trend is not available from {forecast.source}.</div>}
      </section>

      <section className="border-t px-3 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold"><Wind className="h-4 w-4" />Wind trend</div>
        {hasThirtyPositions ? <TrendChart rows={rows} rf={rf} kind="wind" /> : <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">Detailed wind trend is not available from {forecast.source}.</div>}
      </section>

      <MetricGrid
        label="Wind"
        Icon={Wind}
        days={days}
        highlighted={(day) => shouldHighlight(day.windMaxKmh, preferences.wind)}
        highlightClass="border-warning/60 bg-warning/15"
        render={(day) => day.windMaxKmh == null ? "—" : rf.wind(day.windMaxKmh, 0)}
      />
      <MetricGrid
        label="Humidity"
        Icon={Droplets}
        days={days}
        highlighted={(day) => shouldHighlight(day.humidityMaxPct, preferences.humidity)}
        highlightClass="border-accent/60 bg-accent/15"
        render={(day) => day.humidityMaxPct == null ? "—" : `${Math.round(day.humidityMaxPct)}%`}
      />
      <MetricGrid
        label="Rain"
        Icon={CloudRain}
        days={days}
        highlighted={(day) => shouldHighlight(day.rainMm, preferences.rain)}
        highlightClass="border-map-accent/60 bg-map-accent/15"
        render={(day) => (
          <><div>{day.rainMm == null ? "—" : rf.rainfall(day.rainMm)}</div><div className="text-[11px] font-normal text-muted-foreground">{day.rainProbabilityPct == null ? "Probability unavailable" : `${Math.round(day.rainProbabilityPct)}% chance`}</div></>
        )}
      />
    </div>
  );
}

function MetricGrid({ label, Icon, days, highlighted, highlightClass, render }: {
  label: string;
  Icon: typeof Wind;
  days: ForecastDay[];
  highlighted: (day: ForecastDay) => boolean;
  highlightClass: string;
  render: (day: ForecastDay) => React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[96px_1fr] border-t sm:grid-cols-[120px_1fr]" data-testid={`${label.toLowerCase()}-row`}>
      <div className="flex items-center gap-2 px-3 text-xs font-semibold text-muted-foreground"><Icon className="h-4 w-4" />{label}</div>
      <div className="grid grid-cols-5 divide-x">
        {days.map((day) => {
          const active = highlighted(day);
          return <div key={day.date} data-highlighted={active ? "true" : "false"} className={cn("m-1 min-w-0 rounded-md border border-transparent px-1 py-3 text-center text-sm font-medium sm:px-2", active && `font-bold ${highlightClass}`)}>{render(day)}</div>;
        })}
      </div>
    </section>
  );
}