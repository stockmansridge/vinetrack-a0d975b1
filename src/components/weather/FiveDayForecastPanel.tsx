import { useEffect, useMemo, useState } from "react";
import { CloudRain, Droplets, Lightbulb, Thermometer, Wind } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { FiveDayForecast, ForecastDay } from "@/lib/fiveDayForecast";
import { WeatherGlyph, weatherGlyphKey } from "@/components/weather/WeatherGlyph";
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
  /** Freshness line, e.g. "Updated 8 min ago" or "Refreshing…". */
  freshnessLabel?: string | null;
  /** Shown when a refresh failed but a cached forecast is still displayed. */
  cacheNotice?: string | null;
}

function parseLocalDate(date: string): Date | null {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface ChartRow {
  index: number;
  date: string;
  time: string;
  endTime: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  /** Shading band between low and high: [low, high]. */
  tempRange: [number, number] | null;
  windMaxKmh: number | null;
}

function chartRows(days: ForecastDay[]): ChartRow[] {
  return days.flatMap((day, dayIndex) =>
    day.periods.map((period, bucketIndex) => {
      const has = period.sampleCount > 0;
      const low = has ? period.tempMinC : null;
      const high = has ? period.tempMaxC : null;
      return {
        index: dayIndex * 6 + bucketIndex,
        date: day.date,
        time: period.startTimeLocal,
        endTime: period.endTimeLocal,
        tempMinC: low,
        tempMaxC: high,
        tempRange: low != null && high != null ? ([low, high] as [number, number]) : null,
        windMaxKmh: has ? period.windMaxKmh : null,
      };
    }),
  );
}

interface TooltipCardProps {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  rf: RegionFormatters;
  kind: "temperature" | "wind";
}

function TooltipCard({ active, payload, rf, kind }: TooltipCardProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;
  const date = parseLocalDate(row.date);
  const heading = date
    ? date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
    : row.date;
  return (
    <div className="rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur">
      <div className="font-semibold">{heading}</div>
      <div className="mb-1 text-muted-foreground">{row.time}–{row.endTime} local</div>
      {kind === "temperature" ? (
        <>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            High: {row.tempMaxC == null ? "—" : rf.temperature(row.tempMaxC, 1)}
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-foreground" />
            Low: {row.tempMinC == null ? "—" : rf.temperature(row.tempMinC, 1)}
          </div>
        </>
      ) : (
        <div>Wind: {row.windMaxKmh == null ? "—" : rf.wind(row.windMaxKmh, 1)}</div>
      )}
    </div>
  );
}

function niceDomain(values: Array<number | null>, pad: number): [number, number] | undefined {
  const valid = values.filter((value): value is number => value != null);
  if (!valid.length) return undefined;
  const lo = Math.floor((Math.min(...valid) - pad) / 2) * 2;
  const hi = Math.ceil((Math.max(...valid) + pad) / 2) * 2;
  return [lo, hi];
}

function TrendChart({
  rows,
  rf,
  kind,
  windThreshold,
}: {
  rows: ChartRow[];
  rf: RegionFormatters;
  kind: "temperature" | "wind";
  windThreshold?: number | null;
}) {
  // Day separators sit between the last bucket of one day and the first of the next.
  const boundaries = [5.5, 11.5, 17.5, 23.5];
  const domain =
    kind === "temperature"
      ? niceDomain(rows.flatMap((row) => [row.tempMinC, row.tempMaxC]), 2)
      : niceDomain([0, ...rows.map((row) => row.windMaxKmh)], 3);

  return (
    <div
      className="h-44 w-full rounded-lg bg-background/60 p-1 shadow-inner"
      data-testid={`${kind}-trend`}
      data-point-count={rows.length}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 4, left: -18 }}>
          <defs>
            <linearGradient id="vt-wind-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="vt-temp-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="2 6" />
          <XAxis dataKey="index" hide domain={[0, 29]} />
          <YAxis
            width={48}
            domain={domain ?? ["auto", "auto"]}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            tickFormatter={(value) => (kind === "temperature" ? rf.temperature(value, 0) : rf.wind(value, 0))}
          />
          {boundaries.map((value) => (
            <ReferenceLine key={value} x={value} stroke="hsl(var(--border))" strokeDasharray="4 4" />
          ))}
          {kind === "wind" && windThreshold != null && (
            <ReferenceLine y={windThreshold} stroke="hsl(var(--warning))" strokeDasharray="5 5" strokeOpacity={0.8} />
          )}
          <Tooltip
            content={<TooltipCard rf={rf} kind={kind} />}
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          {kind === "temperature" ? (
            <>
              <Area
                connectNulls={false}
                type="monotone"
                dataKey="tempRange"
                stroke="none"
                fill="url(#vt-temp-band)"
                isAnimationActive={false}
              />
              <Line
                connectNulls={false}
                type="monotone"
                dataKey="tempMaxC"
                stroke="hsl(var(--destructive))"
                strokeWidth={3}
                dot={{ r: 3, strokeWidth: 0, fill: "hsl(var(--destructive))" }}
                activeDot={{ r: 5.5 }}
                isAnimationActive={false}
              />
              <Line
                connectNulls={false}
                type="monotone"
                dataKey="tempMinC"
                stroke="hsl(var(--foreground))"
                strokeWidth={2.5}
                dot={{ r: 3, strokeWidth: 0, fill: "hsl(var(--foreground))" }}
                activeDot={{ r: 5.5 }}
                isAnimationActive={false}
              />
            </>
          ) : (
            <>
              <Area
                connectNulls={false}
                type="monotone"
                dataKey="windMaxKmh"
                stroke="none"
                fill="url(#vt-wind-fill)"
                isAnimationActive={false}
              />
              <Line
                connectNulls={false}
                type="monotone"
                dataKey="windMaxKmh"
                stroke="hsl(var(--accent))"
                strokeWidth={3}
                isAnimationActive={false}
                dot={(props: any) => {
                  const value = props?.payload?.windMaxKmh;
                  if (value == null) return <g key={props.key} />;
                  // A single elevated bucket is marked amber; the line stays continuous.
                  const over = windThreshold != null && value >= windThreshold;
                  return (
                    <circle
                      key={props.key}
                      cx={props.cx}
                      cy={props.cy}
                      r={3.2}
                      fill={over ? "hsl(var(--warning))" : "hsl(var(--accent))"}
                    />
                  );
                }}
                activeDot={{ r: 5.5 }}
              />
            </>
          )}
        </ComposedChart>
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

export function FiveDayForecastPanel({ vineyardId, forecast, rf, freshnessLabel, cacheNotice }: Props) {
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
  const hasThirtyPositions =
    rows.length === 30 &&
    rows.some((row) => row.tempMinC != null || row.tempMaxC != null || row.windMaxKmh != null);
  const rainDisplay = rf.settings.distance_unit === "imperial" ? preferences.rain.threshold / 25.4 : preferences.rain.threshold;
  const windDisplay = rf.settings.distance_unit === "imperial" ? preferences.wind.threshold / 1.609344 : preferences.wind.threshold;
  const humiditySource = forecast.fieldSources?.humidity ?? null;
  const humidityIsSupplementary = !!humiditySource && humiditySource !== forecast.source;

  const update = (key: keyof ForecastHighlightPreferences, patch: Partial<{ enabled: boolean; threshold: number }>) => {
    setPreferences((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="five-day-forecast">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div>
          <div className="text-base font-semibold">5-day forecast</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Forecast: {forecast.source}
            {forecast.timezone ? ` · ${forecast.timezone}` : ""}
            {freshnessLabel ? ` · ${freshnessLabel}` : forecast.updatedAt ? ` · updated ${rf.dateTime(forecast.updatedAt)}` : ""}
          </div>
          {cacheNotice && (
            <div className="mt-1 text-xs text-amber-600" data-testid="forecast-cache-notice">{cacheNotice}</div>
          )}
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

      <div className="grid grid-cols-5" data-testid="forecast-day-headers">
        {days.map((day, index) => {
          const date = parseLocalDate(day.date);
          const glyph = weatherGlyphKey(day.conditionKey, day.conditionCode);
          return (
            <div
              key={day.date}
              className={cn(
                "min-w-0 px-2 py-5 text-center sm:px-3",
                index > 0 && "border-l border-border/40",
              )}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                {date?.toLocaleDateString(undefined, { weekday: "short" }) ?? day.date}
              </div>
              <div className="text-xs text-muted-foreground">
                {date?.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </div>
              <div className="my-3 flex justify-center">
                <WeatherGlyph glyph={glyph} size={40} title={day.conditionDescription ?? "Condition unavailable"} />
              </div>
              <div className="min-h-8 text-xs text-muted-foreground">
                {day.conditionDescription ?? "Condition unavailable"}
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 text-base font-semibold">
                <span className="text-sky-300/90 dark:text-sky-300">
                  {day.tempMinC == null ? "—" : rf.temperature(day.tempMinC, 0)}
                </span>
                <span className="text-muted-foreground/60">/</span>
                <span className="text-destructive">
                  {day.tempMaxC == null ? "—" : rf.temperature(day.tempMaxC, 0)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <section className="border-t px-3 py-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
          <Thermometer className="h-4 w-4 text-destructive" />Temperature
          <span className="ml-2 h-2 w-2 rounded-full bg-destructive" />high
          <span className="ml-2 h-2 w-2 rounded-full bg-foreground" />low
          <span className="ml-auto font-normal text-muted-foreground">Four-hourly forecast samples</span>
        </div>
        {hasThirtyPositions ? (
          <TrendChart rows={rows} rf={rf} kind="temperature" />
        ) : (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            Detailed temperature trend is not available from {forecast.source}.
          </div>
        )}
      </section>

      <section className="border-t px-3 py-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
          <Wind className="h-4 w-4 text-accent" />Wind trend
        </div>
        {hasThirtyPositions ? (
          <TrendChart
            rows={rows}
            rf={rf}
            kind="wind"
            windThreshold={preferences.wind.enabled ? preferences.wind.threshold : null}
          />
        ) : (
          <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
            Detailed wind trend is not available from {forecast.source}.
          </div>
        )}
      </section>

      <MetricGrid
        label="Wind"
        Icon={Wind}
        iconClass="bg-emerald-500/15 text-emerald-500"
        days={days}
        highlighted={(day) => shouldHighlight(day.windMaxKmh, preferences.wind)}
        highlightClass="border-warning/70 bg-warning/20 text-warning-foreground"
        render={(day) => day.windMaxKmh == null ? "—" : rf.wind(day.windMaxKmh, 0)}
      />
      <MetricGrid
        label="Humidity"
        Icon={Droplets}
        iconClass="bg-sky-500/15 text-sky-500"
        note={humidityIsSupplementary ? `Humidity: ${humiditySource}` : null}
        days={days}
        highlighted={(day) => shouldHighlight(day.humidityMaxPct, preferences.humidity)}
        highlightClass="border-sky-500/70 bg-sky-500/20"
        render={(day) => day.humidityMaxPct == null ? "—" : `${Math.round(day.humidityMaxPct)}%`}
      />
      <MetricGrid
        label="Rain"
        Icon={CloudRain}
        iconClass="bg-blue-500/15 text-blue-500"
        days={days}
        highlighted={(day) => shouldHighlight(day.rainMm, preferences.rain)}
        highlightClass="border-blue-500/70 bg-blue-500/20"
        render={(day) => (
          <>
            <div>{day.rainMm == null ? "—" : rf.rainfall(day.rainMm)}</div>
            <div className="text-[11px] font-normal text-muted-foreground">
              {day.rainProbabilityPct == null ? "Probability unavailable" : `${Math.round(day.rainProbabilityPct)}% chance`}
            </div>
          </>
        )}
      />
    </div>
  );
}

function MetricGrid({ label, Icon, iconClass, note, days, highlighted, highlightClass, render }: {
  label: string;
  Icon: typeof Wind;
  iconClass?: string;
  note?: string | null;
  days: ForecastDay[];
  highlighted: (day: ForecastDay) => boolean;
  highlightClass: string;
  render: (day: ForecastDay) => React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[104px_1fr] border-t sm:grid-cols-[132px_1fr]" data-testid={`${label.toLowerCase()}-row`}>
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold">
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full", iconClass)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          {note && <span className="block truncate text-[10px] font-normal text-muted-foreground">{note}</span>}
        </span>
      </div>
      <div className="grid grid-cols-5">
        {days.map((day, index) => {
          const active = highlighted(day);
          return (
            <div
              key={day.date}
              data-highlighted={active ? "true" : "false"}
              className={cn(
                "m-1 min-w-0 rounded-md border border-transparent px-1 py-3 text-center text-sm font-medium sm:px-2",
                index > 0 && !active && "border-l-border/30",
                active && `font-bold ${highlightClass}`,
              )}
            >
              {render(day)}
            </div>
          );
        })}
      </div>
    </section>
  );
}
