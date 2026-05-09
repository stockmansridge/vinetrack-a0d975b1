import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  endOfMonth,
  endOfYear,
  format,
  isSameMonth,
  startOfMonth,
  startOfYear,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fetchDailyRainfall, sourceLabel, type RainfallDay } from "@/lib/rainfallQuery";
import { cn } from "@/lib/utils";

interface Props {
  vineyardId: string;
}

const SOURCE_DOT: Record<string, string> = {
  manual: "bg-emerald-500",
  davis_weatherlink: "bg-sky-500",
  wunderground_pws: "bg-violet-500",
  open_meteo: "bg-amber-500",
};

type View = "year" | "month";

export function RainCalendar({ vineyardId }: Props) {
  const [view, setView] = useState<View>("year");
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(new Date()));

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Rain Calendar</h2>
          <p className="text-xs text-muted-foreground">
            Source priority: Manual → Davis WeatherLink → Weather Underground → Open-Meteo
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border overflow-hidden">
            <Button
              size="sm"
              variant={view === "year" ? "default" : "ghost"}
              className="rounded-none"
              onClick={() => setView("year")}
            >
              Year
            </Button>
            <Button
              size="sm"
              variant={view === "month" ? "default" : "ghost"}
              className="rounded-none"
              onClick={() => setView("month")}
            >
              Month
            </Button>
          </div>
        </div>
      </div>

      {view === "year" ? (
        <YearMatrixView vineyardId={vineyardId} year={year} setYear={setYear} />
      ) : (
        <MonthView vineyardId={vineyardId} cursor={monthCursor} setCursor={setMonthCursor} />
      )}

      <SourceLegend />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Year matrix view: rows = day 1..31, columns = Jan..Dec, cells = rainfall mm
// ---------------------------------------------------------------------------

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function heatStyle(mm: number | null | undefined): React.CSSProperties {
  if (mm == null || mm <= 0) return {};
  // Cap intensity around 50mm/day for shading.
  const intensity = Math.min(1, mm / 50);
  // sky-blue heat: hsl(200 90% L%) where L drops from 92 to 45
  const lightness = 92 - intensity * 47;
  return { backgroundColor: `hsl(200 90% ${lightness}%)`, color: lightness < 60 ? "white" : undefined };
}

function YearMatrixView({
  vineyardId,
  year,
  setYear,
}: {
  vineyardId: string;
  year: number;
  setYear: (y: number) => void;
}) {
  const from = useMemo(() => startOfYear(new Date(year, 0, 1)), [year]);
  const to = useMemo(() => endOfYear(new Date(year, 0, 1)), [year]);
  const isCurrent = year === new Date().getFullYear();

  const { data, isLoading } = useQuery({
    queryKey: ["rain-year-matrix", vineyardId, year],
    enabled: !!vineyardId,
    queryFn: () => fetchDailyRainfall(vineyardId, from, to),
  });

  const byDate = useMemo(() => {
    const m = new Map<string, RainfallDay>();
    if (data?.ok) for (const r of data.rows) if (r.date) m.set(r.date, r);
    return m;
  }, [data]);

  // Per-month aggregates.
  const monthly = useMemo(() => {
    return Array.from({ length: 12 }).map((_, m) => {
      const last = endOfMonth(new Date(year, m, 1)).getDate();
      let total = 0;
      let rainDays = 0;
      let recordedDays = 0;
      let highest: { date: string; mm: number } | null = null;
      for (let d = 1; d <= last; d++) {
        const key = format(new Date(year, m, d), "yyyy-MM-dd");
        const row = byDate.get(key);
        const mm = row?.rainfall_mm;
        if (row == null || mm == null) continue;
        recordedDays += 1;
        total += mm;
        if (mm > 0) {
          rainDays += 1;
          if (!highest || mm > highest.mm) highest = { date: key, mm };
        }
      }
      return {
        month: m,
        total: Math.round(total * 10) / 10,
        rainDays,
        recordedDays,
        highest,
        avg: recordedDays > 0 ? Math.round((total / recordedDays) * 10) / 10 : null,
      };
    });
  }, [byDate, year]);

  const yearSummary = useMemo(() => {
    const total = monthly.reduce((s, m) => s + m.total, 0);
    const rainDays = monthly.reduce((s, m) => s + m.rainDays, 0);
    const monthsWithData = monthly.filter((m) => m.recordedDays > 0);
    let wettestMonth: typeof monthly[number] | null = null;
    let driestMonth: typeof monthly[number] | null = null;
    let wettestDay: { date: string; mm: number } | null = null;
    for (const m of monthsWithData) {
      if (!wettestMonth || m.total > wettestMonth.total) wettestMonth = m;
      if (!driestMonth || m.total < driestMonth.total) driestMonth = m;
      if (m.highest && (!wettestDay || m.highest.mm > wettestDay.mm)) wettestDay = m.highest;
    }
    return {
      total: Math.round(total * 10) / 10,
      rainDays,
      wettestMonth,
      driestMonth,
      wettestDay,
      avgPerMonth: monthsWithData.length > 0
        ? Math.round((total / monthsWithData.length) * 10) / 10
        : null,
    };
  }, [monthly]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {year} · Year total {yearSummary.total} mm · {yearSummary.rainDays} rain days
          {isLoading ? " · loading…" : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setYear(year - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isCurrent}
            onClick={() => setYear(new Date().getFullYear())}
          >
            This year
          </Button>
          <Button size="sm" variant="outline" onClick={() => setYear(year + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Day x Month matrix */}
      <div className="overflow-auto border rounded-md">
        <table className="w-full text-[11px] border-collapse">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 z-20 border-r">
                Day
              </th>
              {MONTH_LABELS.map((m) => (
                <th key={m} className="px-1.5 py-1.5 text-center font-medium text-muted-foreground border-l">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 31 }).map((_, di) => {
              const day = di + 1;
              return (
                <tr key={day} className="border-t">
                  <td className="px-2 py-0.5 text-muted-foreground tabular-nums sticky left-0 bg-background z-10 border-r font-medium">
                    {day}
                  </td>
                  {MONTH_LABELS.map((_, mi) => {
                    const lastDay = endOfMonth(new Date(year, mi, 1)).getDate();
                    if (day > lastDay) {
                      return <td key={mi} className="border-l bg-muted/20" />;
                    }
                    const date = new Date(year, mi, day);
                    const key = format(date, "yyyy-MM-dd");
                    const row = byDate.get(key);
                    const mm = row?.rainfall_mm;
                    const hasData = row != null && mm != null;
                    const today = format(new Date(), "yyyy-MM-dd") === key;
                    return (
                      <td key={mi} className={cn("border-l p-0", today && "ring-1 ring-primary ring-inset")}>
                        <DayPopover date={date} row={row}>
                          <button
                            type="button"
                            style={hasData ? heatStyle(mm) : undefined}
                            className={cn(
                              "w-full h-7 px-1 text-center tabular-nums leading-none cursor-pointer hover:outline hover:outline-1 hover:outline-primary",
                              !hasData && "text-muted-foreground/40",
                              hasData && (mm as number) === 0 && "text-muted-foreground",
                              hasData && (mm as number) > 0 && "font-medium",
                            )}
                          >
                            {!hasData
                              ? "—"
                              : (mm as number) === 0
                                ? "0.0"
                                : (mm as number).toFixed(1)}
                          </button>
                        </DayPopover>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {/* Monthly summary footer */}
          <tfoot className="bg-muted/30">
            <SummaryRow label="Total (mm)" values={monthly.map((m) => (m.recordedDays ? m.total.toFixed(1) : "—"))} bold />
            <SummaryRow label="Rain days" values={monthly.map((m) => (m.recordedDays ? String(m.rainDays) : "—"))} />
            <SummaryRow
              label="Wettest day"
              values={monthly.map((m) => (m.highest ? `${m.highest.mm.toFixed(1)}` : "—"))}
            />
            <SummaryRow
              label="Avg / day"
              values={monthly.map((m) => (m.avg != null ? m.avg.toFixed(1) : "—"))}
            />
          </tfoot>
        </table>
      </div>

      {/* Year summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <YearStat label="Year total" value={`${yearSummary.total} mm`} />
        <YearStat label="Rain days" value={String(yearSummary.rainDays)} />
        <YearStat
          label="Wettest month"
          value={yearSummary.wettestMonth ? `${MONTH_LABELS[yearSummary.wettestMonth.month]} (${yearSummary.wettestMonth.total} mm)` : "—"}
        />
        <YearStat
          label="Driest month"
          value={yearSummary.driestMonth ? `${MONTH_LABELS[yearSummary.driestMonth.month]} (${yearSummary.driestMonth.total} mm)` : "—"}
        />
        <YearStat
          label="Wettest day"
          value={yearSummary.wettestDay ? `${yearSummary.wettestDay.mm.toFixed(1)} mm` : "—"}
          sub={yearSummary.wettestDay ? format(new Date(yearSummary.wettestDay.date), "PP") : undefined}
        />
        <YearStat
          label="Avg / month"
          value={yearSummary.avgPerMonth != null ? `${yearSummary.avgPerMonth} mm` : "—"}
        />
      </div>
    </div>
  );
}

function SummaryRow({ label, values, bold }: { label: string; values: string[]; bold?: boolean }) {
  return (
    <tr className="border-t">
      <td className="px-2 py-1 text-muted-foreground sticky left-0 bg-muted/30 z-10 border-r text-[11px]">
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={cn(
            "px-1 py-1 text-center tabular-nums border-l text-[11px]",
            bold && "font-semibold",
            v === "—" && "text-muted-foreground/50",
          )}
        >
          {v}
        </td>
      ))}
    </tr>
  );
}

function YearStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}


function DayPopover({
  date,
  row,
  children,
}: {
  date: Date;
  row?: RainfallDay;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-sm space-y-1">
        <div className="font-semibold">{format(date, "PP")}</div>
        <div>
          Rainfall:{" "}
          {row?.rainfall_mm == null ? (
            <span className="text-muted-foreground">No reading</span>
          ) : (
            <span className="font-medium">{row.rainfall_mm.toFixed(1)} mm</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Source: {sourceLabel(row?.source)}
        </div>
        {row?.station_name && (
          <div className="text-xs text-muted-foreground">Station: {row.station_name}</div>
        )}
        {row?.notes && (
          <div className="text-xs text-muted-foreground">Notes: {row.notes}</div>
        )}
        {row?.updated_at && (
          <div className="text-[11px] text-muted-foreground pt-1">
            Updated {format(new Date(row.updated_at), "PP p")}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Month view (kept for "Month" toggle)
// ---------------------------------------------------------------------------

function MonthView({
  vineyardId,
  cursor,
  setCursor,
}: {
  vineyardId: string;
  cursor: Date;
  setCursor: (d: Date) => void;
}) {
  const from = useMemo(() => startOfMonth(cursor), [cursor]);
  const to = useMemo(() => endOfMonth(cursor), [cursor]);

  const { data, isLoading } = useQuery({
    queryKey: ["rain-calendar", vineyardId, from.toISOString()],
    enabled: !!vineyardId,
    queryFn: () => fetchDailyRainfall(vineyardId, from, to),
  });

  const byDate = useMemo(() => {
    const m = new Map<string, RainfallDay>();
    if (data?.ok) for (const r of data.rows) if (r.date) m.set(r.date, r);
    return m;
  }, [data]);

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const startWeekday = (first.getDay() + 6) % 7;
    const total = startWeekday + last.getDate();
    const trailing = (7 - (total % 7)) % 7;
    const all: { date: Date | null }[] = [];
    for (let i = 0; i < startWeekday; i++) all.push({ date: null });
    for (let d = 1; d <= last.getDate(); d++) {
      all.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), d) });
    }
    for (let i = 0; i < trailing; i++) all.push({ date: null });
    return all;
  }, [cursor]);

  const total = useMemo(() => {
    if (!data?.ok) return 0;
    return Math.round(
      data.rows.reduce((s, r) => s + (typeof r.rainfall_mm === "number" ? r.rainfall_mm : 0), 0) * 10,
    ) / 10;
  }, [data]);

  const isCurrent = isSameMonth(cursor, new Date());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {format(cursor, "MMMM yyyy")} · Total {total} mm
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isCurrent}
            onClick={() => setCursor(startOfMonth(new Date()))}
          >
            Today
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-1 py-0.5 text-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} className="h-16 rounded-md" />;
          const key = format(c.date, "yyyy-MM-dd");
          const row = byDate.get(key);
          const mm = row?.rainfall_mm;
          const hasData = row != null && mm != null;
          const isWet = hasData && (mm as number) > 0;
          const today = format(new Date(), "yyyy-MM-dd") === key;
          return (
            <DayPopover key={i} date={c.date} row={row}>
              <button
                type="button"
                className={cn(
                  "h-16 rounded-md border p-1.5 flex flex-col justify-between text-xs text-left w-full hover:ring-1 hover:ring-primary",
                  isWet && "bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-900",
                  !hasData && "bg-muted/30",
                  today && "ring-1 ring-primary",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium tabular-nums">{c.date.getDate()}</span>
                  {row?.source && (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        SOURCE_DOT[row.source] ?? "bg-muted-foreground",
                      )}
                      aria-label={sourceLabel(row.source)}
                    />
                  )}
                </div>
                <div
                  className={cn(
                    "text-right tabular-nums",
                    isWet ? "font-semibold text-sky-700 dark:text-sky-300" : "text-muted-foreground",
                  )}
                >
                  {!hasData
                    ? isLoading
                      ? "…"
                      : "—"
                    : (mm as number) === 0
                      ? "0 mm"
                      : `${(mm as number).toFixed(1)} mm`}
                </div>
              </button>
            </DayPopover>
          );
        })}
      </div>
    </div>
  );
}

function SourceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pt-1">
      <span className="font-medium">Source:</span>
      {Object.entries({
        manual: "Manual",
        davis_weatherlink: "Davis WeatherLink",
        wunderground_pws: "Weather Underground",
        open_meteo: "Open-Meteo fallback",
      }).map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className={cn("h-1.5 w-1.5 rounded-full", SOURCE_DOT[k])} />
          {label}
        </span>
      ))}
      <span className="ml-auto">— = no data, 0 mm = recorded dry day</span>
    </div>
  );
}
