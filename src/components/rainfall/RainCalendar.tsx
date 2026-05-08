import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  endOfMonth,
  format,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

export function RainCalendar({ vineyardId }: Props) {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
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

  // Build month grid (Mon-first)
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const startWeekday = (first.getDay() + 6) % 7; // Mon=0
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
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Rain Calendar</h2>
          <p className="text-xs text-muted-foreground">
            Daily rainfall for {format(cursor, "MMMM yyyy")} · Total {total} mm
          </p>
        </div>
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
            <div
              key={i}
              title={
                row
                  ? `${format(c.date, "PP")}\n${
                      mm == null ? "No reading" : `${(mm as number).toFixed(1)} mm`
                    }${row.source ? `\nSource: ${sourceLabel(row.source)}` : ""}`
                  : `${format(c.date, "PP")}\nNo data`
              }
              className={cn(
                "h-16 rounded-md border p-1.5 flex flex-col justify-between text-xs",
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
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pt-1">
        <span className="font-medium">Source:</span>
        {Object.entries({
          manual: "Manual",
          davis_weatherlink: "Davis",
          wunderground_pws: "WU",
          open_meteo: "Open-Meteo",
        }).map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", SOURCE_DOT[k])} />
            {label}
          </span>
        ))}
        <span className="ml-auto">— = no data, 0 mm = recorded dry day</span>
      </div>
    </Card>
  );
}
