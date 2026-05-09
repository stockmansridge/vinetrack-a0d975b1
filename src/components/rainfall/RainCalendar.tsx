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
        <YearView vineyardId={vineyardId} year={year} setYear={setYear} />
      ) : (
        <MonthView vineyardId={vineyardId} cursor={monthCursor} setCursor={setMonthCursor} />
      )}

      <SourceLegend />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Year view: 12 month cards with summaries + compact day grid
// ---------------------------------------------------------------------------

function YearView({
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
    queryKey: ["rain-year", vineyardId, year],
    enabled: !!vineyardId,
    queryFn: () => fetchDailyRainfall(vineyardId, from, to),
  });

  const byDate = useMemo(() => {
    const m = new Map<string, RainfallDay>();
    if (data?.ok) for (const r of data.rows) if (r.date) m.set(r.date, r);
    return m;
  }, [data]);

  const yearTotal = useMemo(() => {
    if (!data?.ok) return 0;
    return Math.round(
      data.rows.reduce((s, r) => s + (typeof r.rainfall_mm === "number" ? r.rainfall_mm : 0), 0) * 10,
    ) / 10;
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {year} · Total {yearTotal} mm{isLoading ? " · loading…" : ""}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <MonthCard key={i} year={year} month={i} byDate={byDate} />
        ))}
      </div>
    </div>
  );
}

function MonthCard({
  year,
  month,
  byDate,
}: {
  year: number;
  month: number;
  byDate: Map<string, RainfallDay>;
}) {
  const first = startOfMonth(new Date(year, month, 1));
  const last = endOfMonth(first);

  // Summary
  let total = 0;
  let rainDays = 0;
  let highest: { date: string; mm: number } | null = null;
  let noDataDays = 0;
  for (let d = 1; d <= last.getDate(); d++) {
    const key = format(new Date(year, month, d), "yyyy-MM-dd");
    const row = byDate.get(key);
    const mm = row?.rainfall_mm;
    if (row == null || mm == null) {
      noDataDays += 1;
      continue;
    }
    total += mm;
    if (mm > 0) {
      rainDays += 1;
      if (!highest || mm > highest.mm) highest = { date: key, mm };
    }
  }
  total = Math.round(total * 10) / 10;

  const startWeekday = (first.getDay() + 6) % 7;
  const cells: { date: Date | null }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
  for (let d = 1; d <= last.getDate(); d++) cells.push({ date: new Date(year, month, d) });
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells.push({ date: null });

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold">{format(first, "MMMM")}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{total} mm</div>
      </div>
      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
        <span>{rainDays} rain days</span>
        <span>·</span>
        <span>
          Highest: {highest ? `${highest.mm.toFixed(1)} mm` : "—"}
        </span>
        {noDataDays > 0 && (
          <>
            <span>·</span>
            <span>{noDataDays} no-data</span>
          </>
        )}
      </div>
      <div className="grid grid-cols-7 gap-[2px]">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} className="aspect-square rounded-sm" />;
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
                  "aspect-square rounded-sm border text-[9px] leading-none flex items-center justify-center cursor-pointer hover:ring-1 hover:ring-primary",
                  isWet && "bg-sky-100 dark:bg-sky-950/50 border-sky-300 dark:border-sky-800 text-sky-800 dark:text-sky-200 font-medium",
                  !hasData && "bg-muted/40 text-muted-foreground/50",
                  hasData && !isWet && "bg-background",
                  today && "ring-1 ring-primary",
                )}
              >
                {c.date.getDate()}
              </button>
            </DayPopover>
          );
        })}
      </div>
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
