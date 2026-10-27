// Trends tab — one readable trend for a block + analyte + series.
// Visual series: same analyte + unit + exact known method (strict), or all
// methods missing (provisional, visual only). Known and unknown methods,
// different methods and different units are never drawn together; when
// several series exist the user picks one, and only that chart renders.
// Raw results stay visible as dots; the line is a VineTrack-derived date
// average, labelled as such. Measured language only — no advice.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  listBlockAnalyteResults,
  listAnalyteCatalogue,
  buildTrendSeries,
  buildDateAverages,
  summariseTrend,
  labStatusLabel,
  formatMapValue,
  TREND_PROVISIONAL_BADGE,
} from "@/lib/soilAnalysis";
import { SoilAnalyteCombobox } from "./SoilAnalyteCombobox";
import { formatDate } from "@/pages/admin/_shared";

const db = supabase as any;

const toTs = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).getTime();
const depthOf = (s: { sample_depth_from_cm: number | null; sample_depth_to_cm: number | null }) =>
  s.sample_depth_from_cm != null ? `${s.sample_depth_from_cm}–${s.sample_depth_to_cm ?? "?"} cm` : "—";
const rangeOf = (r: { lab_range_min: number | null; lab_range_max: number | null; lab_range_text: string | null }) =>
  r.lab_range_text ??
  (r.lab_range_min != null || r.lab_range_max != null ? `${r.lab_range_min ?? "?"}–${r.lab_range_max ?? "?"}` : "—");

export function TrendsTab() {
  const { selectedVineyardId } = useVineyard();
  const [paddockId, setPaddockId] = useState("");
  const [analyteKey, setAnalyteKey] = useState("");
  const [seriesKey, setSeriesKey] = useState("");

  const blocksQuery = useQuery({
    queryKey: ["soil-analysis", "blocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await db
        .from("paddocks")
        .select("id, name")
        .eq("vineyard_id", selectedVineyardId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const analytesQuery = useQuery({
    queryKey: ["soil-analysis", "analytes"],
    queryFn: listAnalyteCatalogue,
  });

  const resultsQuery = useQuery({
    queryKey: ["soil-analysis", "trend", paddockId, analyteKey],
    enabled: !!paddockId && !!analyteKey,
    queryFn: () => listBlockAnalyteResults(paddockId, analyteKey),
  });

  const analytes = analytesQuery.data ?? [];
  const analyte = analytes.find((a) => a.key === analyteKey);
  const series = useMemo(
    () => buildTrendSeries((resultsQuery.data ?? []).map((r) => ({ result: r, sample: r.sample }))),
    [resultsQuery.data],
  );
  useEffect(() => {
    if (!series.some((s) => s.key === seriesKey)) setSeriesKey(series[0]?.key ?? "");
  }, [series, seriesKey]);
  const active = series.find((s) => s.key === seriesKey) ?? series[0] ?? null;


  const name = analyte?.display_name ?? analyteKey;
  const summary = active ? summariseTrend(active, name, analyte?.desired_direction) : null;
  const unit = active?.unit ? ` ${active.unit}` : "";
  const raw = (active?.points ?? [])
    .filter((p) => typeof p.result.value_numeric === "number")
    .map((p) => ({
      ts: toTs(p.sample.sampled_at ?? p.sample.created_at),
      raw: p.result.value_numeric,
      p,
    }));
  const avgs = active
    ? buildDateAverages(active.points).map((a) => ({ ts: toTs(a.date), avg: a.average, count: a.count }))
    : [];
  const hasSharedDates = avgs.some((a) => a.count > 1);

  const selectClass = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

  const TooltipBody = ({ active: on, payload }: any) => {
    if (!on || !payload?.length) return null;
    const item = payload.find((x: any) => x.payload?.p) ?? payload[0];
    const d = item.payload;
    if (d.p) {
      const { result: r, sample: s } = d.p;
      return (
        <div className="rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-sm space-y-0.5">
          <div className="font-medium">{formatDate(s.sampled_at)}</div>
          <div>{[s.lab_paddock_name, s.lab_sample_id].filter(Boolean).join(" · ") || "—"}</div>
          <div>{r.value_numeric}{r.unit ? ` ${r.unit}` : ""}</div>
          <div>Depth {depthOf(s)}</div>
          <div>{s.laboratory ?? "Laboratory not recorded"}</div>
          <div>Lab range {rangeOf(r)} · {labStatusLabel(r.lab_status)}</div>
        </div>
      );
    }
    return (
      <div className="rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-sm">
        <div className="font-medium">{formatDate(new Date(d.ts).toISOString())}</div>
        <div>Date average {formatMapValue(d.avg)}{unit} ({d.count} sample{d.count > 1 ? "s" : ""})</div>
        <div className="text-muted-foreground">VineTrack-derived, not a lab result</div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectClass} value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Trend block">
          <option value="">Choose a block…</option>
          {(blocksQuery.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <SoilAnalyteCombobox
          ariaLabel="Trend analyte"
          value={analyteKey}
          options={analytes.map((a) => ({ key: a.key, name: a.display_name, category: a.category ?? "Other" }))}
          onChange={setAnalyteKey}
        />
        {series.length > 1 && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Trend series">
            <span className="text-xs text-muted-foreground">Series:</span>
            {series.map((s) => (
              <Button
                key={s.key}
                size="sm"
                variant={active?.key === s.key ? "default" : "outline"}
                onClick={() => setSeriesKey(s.key)}
              >
                {s.method ?? "Method not recorded"} · {s.unit ?? "unit not recorded"} ({s.points.length})
              </Button>
            ))}
          </div>
        )}
      </div>

      {!paddockId || !analyteKey ? (
        <div className="text-sm text-muted-foreground py-6">
          Choose a block and an analyte to plot results over time.
        </div>
      ) : resultsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground py-6">Loading results…</div>
      ) : !active || !summary ? (
        <div className="text-sm text-muted-foreground py-6">
          No results recorded for this block and analyte yet.
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Latest{summary.latest && summary.latest.count > 1 ? " (date average)" : ""}</div>
              <div className="text-lg font-semibold">
                {summary.latest ? `${formatMapValue(summary.latest.average)}${unit}` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">{summary.latest ? formatDate(summary.latest.date) : ""}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Change since previous date</div>
              <div className="text-lg font-semibold">
                {summary.delta == null
                  ? "—"
                  : `${summary.delta > 0 ? "+" : ""}${formatMapValue(summary.delta)}${unit}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {summary.percent != null ? `${summary.percent >= 0 ? "+" : ""}${summary.percent.toFixed(1)}%` : ""}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Latest lab status</div>
              <div className="text-lg font-semibold">{summary.latestStatus ?? "Not stated"}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Samples / dates</div>
              <div className="text-lg font-semibold">{summary.sampleCount} / {summary.dateCount}</div>
            </CardContent></Card>
          </div>
          <p className="text-sm">{summary.sentences.join(" ")}</p>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex flex-wrap items-center gap-2">
                <span>{name}</span>
                <Badge variant="outline">{active.method ?? "Method not recorded"}</Badge>
                <Badge variant="outline">{active.unit ?? "Unit not recorded"}</Badge>
                {active.provisional && (
                  <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning-foreground">
                    {TREND_PROVISIONAL_BADGE}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      domain={["dataMin - 2592000000", "dataMax + 2592000000"]}
                      tickFormatter={(t) => formatDate(new Date(t).toISOString())}
                      fontSize={11}
                    />
                    <YAxis fontSize={11} domain={["auto", "auto"]} />
                    <Tooltip content={<TooltipBody />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      data={avgs}
                      dataKey="avg"
                      name={hasSharedDates ? "Date average (VineTrack-derived, where samples share a date)" : "Trend (VineTrack-derived)"}
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Scatter
                      data={raw}
                      dataKey="raw"
                      name="Laboratory result"
                      fill="hsl(var(--foreground))"
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-xs mt-3">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Date</th>
                      <th className="py-1 pr-3 font-medium">Lab paddock / sample</th>
                      <th className="py-1 pr-3 font-medium">Value</th>
                      <th className="py-1 pr-3 font-medium">Method</th>
                      <th className="py-1 pr-3 font-medium">Depth</th>
                      <th className="py-1 pr-3 font-medium">Lab range</th>
                      <th className="py-1 font-medium">Lab status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.points.map((p) => (
                      <tr key={p.result.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">{formatDate(p.sample.sampled_at)}</td>
                        <td className="py-1 pr-3">
                          {[p.sample.lab_paddock_name, p.sample.lab_sample_id].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="py-1 pr-3">
                          {p.result.value_numeric ?? p.result.value_text ?? "—"} {p.result.unit ?? ""}
                        </td>
                        <td className="py-1 pr-3">{p.result.method ?? "Not recorded"}</td>
                        <td className="py-1 pr-3">{depthOf(p.sample)}</td>
                        <td className="py-1 pr-3">{rangeOf(p.result)}</td>
                        <td className="py-1">{labStatusLabel(p.result.lab_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
