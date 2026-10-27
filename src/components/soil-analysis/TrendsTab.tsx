// One compatible visual series, with independent raw points and date-average lines per block.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { listBlocksAnalyteResults, listAnalyteCatalogue, buildTrendSeries, splitTrendByBlocks, buildDateAverages, summariseTrend, labStatusLabel, formatMapValue, TREND_PROVISIONAL_BADGE } from "@/lib/soilAnalysis";
import { SoilAnalyteCombobox } from "./SoilAnalyteCombobox";
import { SoilBlockSelector } from "./SoilBlockSelector";
import { formatDate } from "@/pages/admin/_shared";

const db = supabase as any;
const toTs = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
const depthOf = (s: { sample_depth_from_cm: number | null; sample_depth_to_cm: number | null }) =>
  s.sample_depth_from_cm != null ? `${s.sample_depth_from_cm}–${s.sample_depth_to_cm ?? "?"} cm` : "—";
const rangeOf = (r: { lab_range_min: number | null; lab_range_max: number | null; lab_range_text: string | null }) =>
  r.lab_range_text ?? (r.lab_range_min != null || r.lab_range_max != null ? `${r.lab_range_min ?? "?"}–${r.lab_range_max ?? "?"}` : "—");
// Existing themed report accents, paired with patterns and shapes rather than colour alone.
const styles = [
  { color: "hsl(var(--report-pruning))", dash: undefined, shape: "circle" },
  { color: "hsl(var(--report-trips))", dash: "7 3", shape: "square" },
  { color: "hsl(var(--report-tasks))", dash: "2 3", shape: "triangle" },
  { color: "hsl(var(--report-comparison))", dash: "9 3 2 3", shape: "diamond" },
  { color: "hsl(var(--report-spray))", dash: "12 4", shape: "cross" },
  { color: "hsl(var(--report-yield))", dash: "4 2", shape: "star" },
  { color: "hsl(var(--report-levy))", dash: "1 4", shape: "wye" },
  { color: "hsl(var(--report-documents))", dash: "10 2 2 2", shape: "circle" },
] as const;

export function TrendsTab() {
  const { selectedVineyardId } = useVineyard();
  const [selection, setSelection] = useState<{ vineyardId: string | null; ids: string[] }>({ vineyardId: selectedVineyardId, ids: [] });
  const [analyteKey, setAnalyteKey] = useState("");
  const [seriesKey, setSeriesKey] = useState("");
  const blocksQuery = useQuery({
    queryKey: ["soil-analysis", "blocks", selectedVineyardId], enabled: !!selectedVineyardId,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await db.from("paddocks").select("id, name").eq("vineyard_id", selectedVineyardId).is("deleted_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const blocks = useMemo(() => [...(blocksQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [blocksQuery.data]);
  const selectedBlocks = useMemo(() => blocks.filter((b) => selection.vineyardId === selectedVineyardId && selection.ids.includes(b.id)).map((b) => b.id), [blocks, selection, selectedVineyardId]);
  useEffect(() => {
    if (selection.vineyardId !== selectedVineyardId) setSelection({ vineyardId: selectedVineyardId, ids: [] });
    else if (blocksQuery.isSuccess && selection.ids.some((id) => !blocks.some((b) => b.id === id)))
      setSelection({ vineyardId: selectedVineyardId, ids: selectedBlocks });
  }, [selectedVineyardId, selection, blocks, selectedBlocks, blocksQuery.isSuccess]);
  const analytesQuery = useQuery({ queryKey: ["soil-analysis", "analytes"], queryFn: listAnalyteCatalogue });
  const resultsQuery = useQuery({
    queryKey: ["soil-analysis", "trend", selectedVineyardId, selectedBlocks, analyteKey],
    enabled: selectedBlocks.length > 0 && !!analyteKey,
    queryFn: () => listBlocksAnalyteResults(selectedBlocks, analyteKey),
  });
  const analytes = analytesQuery.data ?? [];
  const analyte = analytes.find((a) => a.key === analyteKey);
  const rows = resultsQuery.data ?? [];
  const series = useMemo(() => buildTrendSeries((resultsQuery.data ?? []).map((r) => ({ result: r, sample: r.sample }))), [resultsQuery.data]);
  useEffect(() => { if (!series.some((s) => s.key === seriesKey)) setSeriesKey(series[0]?.key ?? ""); }, [series, seriesKey]);
  const active = series.find((s) => s.key === seriesKey) ?? series[0] ?? null;
  const name = analyte?.display_name ?? analyteKey;
  const unit = active?.unit ? ` ${active.unit}` : "";
  const blockName = (id: string) => blocks.find((b) => b.id === id)?.name ?? id;
  const blockTrends = splitTrendByBlocks(active, rows, selectedBlocks).map((b, index) => ({
    ...b, name: blockName(b.paddockId), style: styles[index % styles.length],
    summary: b.series ? summariseTrend(b.series, name, analyte?.desired_direction) : null,
    raw: (b.series?.points ?? []).filter((p) => typeof p.result.value_numeric === "number" && Number.isFinite(p.result.value_numeric))
      .map((p) => ({ ts: toTs(p.sample.sampled_at ?? p.sample.created_at), raw: p.result.value_numeric, p, blockName: blockName(b.paddockId) })),
    averages: buildDateAverages(b.series?.points ?? []).map((a) => ({ ...a, ts: toTs(a.date), avg: a.average, blockName: blockName(b.paddockId) })),
  }));
  const rawRows = rows.filter((r) => selectedBlocks.includes(r.matched_paddock_id) && active?.points.some((p) => p.result === r))
    .sort((a, b) => String(a.sample.sampled_at ?? a.sample.created_at).localeCompare(String(b.sample.sampled_at ?? b.sample.created_at))
      || blockName(a.matched_paddock_id).localeCompare(blockName(b.matched_paddock_id)) || a.id.localeCompare(b.id));
  const TooltipBody = ({ active: on, payload }: any) => {
    if (!on || !payload?.length) return null;
    return <div className="max-h-64 max-w-72 overflow-y-auto rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm space-y-2">
      {payload.map((item: any, i: number) => {
        const d = item.payload;
        if (d.p) {
          const { result: r, sample: s } = d.p;
          return <div key={i} className="space-y-0.5">
            <div className="font-semibold">Block: {d.blockName}</div><div>{formatDate(s.sampled_at)}</div>
            <div>{[s.lab_paddock_name, s.lab_sample_id].filter(Boolean).join(" · ") || "—"}</div>
            <div>{r.value_numeric}{r.unit ? ` ${r.unit}` : ""}</div><div>Depth {depthOf(s)}</div>
            <div>{s.laboratory ?? "Laboratory not recorded"}</div><div>Lab range {rangeOf(r)} · {labStatusLabel(r.lab_status)}</div>
          </div>;
        }
        return <div key={i}><div className="font-semibold">Block: {d.blockName}</div><div>{formatDate(d.date)}</div>
          <div>Date average {d.avg}{unit} ({d.count} sample{d.count > 1 ? "s" : ""})</div>
          <div className="text-muted-foreground">VineTrack-derived, not a lab result</div></div>;
      })}
    </div>;
  };
  return <div className="space-y-3 min-w-0">
    <SoilBlockSelector blocks={blocks} selected={selectedBlocks} onChange={(ids) => setSelection({ vineyardId: selectedVineyardId, ids })} />
    <div className="flex flex-wrap items-center gap-2">
      <SoilAnalyteCombobox ariaLabel="Trend analyte" value={analyteKey} options={analytes.map((a) => ({ key: a.key, name: a.display_name, category: a.category ?? "Other" }))} onChange={setAnalyteKey} />
      {series.length > 1 && <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Trend series">
        <span className="text-xs text-muted-foreground">Series:</span>
        {series.map((s) => <Button key={s.key} size="sm" variant={active?.key === s.key ? "default" : "outline"} onClick={() => setSeriesKey(s.key)}>
          {s.method ?? "Method not recorded"} · {s.unit ?? "unit not recorded"} ({s.points.length})
        </Button>)}
      </div>}
    </div>
    {!selectedBlocks.length || !analyteKey ? <div className="text-sm text-muted-foreground py-6">Choose one or more blocks and an analyte to plot results over time.</div>
      : resultsQuery.isLoading ? <div className="text-sm text-muted-foreground py-6">Loading results…</div>
      : resultsQuery.isError ? <div role="alert" className="text-sm text-destructive py-6">Unable to load results. Please try again.</div>
      : <>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{name}</span><Badge variant="outline">{active?.method ?? "Method not recorded"}</Badge>
          <Badge variant="outline">{active?.unit ?? "Unit not recorded"}</Badge><span className="text-muted-foreground">{selectedBlocks.length} blocks selected</span>
          {active?.provisional && <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning-foreground">{TREND_PROVISIONAL_BADGE}</Badge>}
        </div>
        <div className="divide-y rounded-md border bg-card" aria-label="Block trend summaries">
          {blockTrends.map((b) => <section key={b.paddockId} aria-label={`${b.name} trend summary`} className="p-3">
            <h3 className="text-sm font-semibold mb-2">{b.name}</h3>
            {!b.summary ? <span className="text-sm text-muted-foreground">No data</span> : <>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 text-sm">
                <div><dt className="text-xs text-muted-foreground">Latest{(b.summary.latest?.count ?? 0) > 1 ? " (date average)" : ""}</dt>
                  <dd className="font-medium">{b.summary.latest ? `${formatMapValue(b.summary.latest.average)}${unit}` : "—"}</dd>
                  <dd className="text-xs text-muted-foreground">{b.summary.latest ? formatDate(b.summary.latest.date) : ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Change since previous date</dt>
                  <dd>{b.summary.delta == null ? "—" : `${b.summary.delta > 0 ? "+" : ""}${formatMapValue(b.summary.delta)}${unit}`}
                    {b.summary.percent != null ? ` (${b.summary.percent >= 0 ? "+" : ""}${b.summary.percent.toFixed(1)}%)` : ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Latest lab status</dt><dd>{b.summary.latestStatus ?? "Not stated"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Samples / dates</dt><dd>{b.summary.sampleCount} / {b.summary.dateCount}</dd></div>
              </dl>
              {b.summary.rangeChanged && <p className="text-xs text-muted-foreground mt-2">{b.name}: Laboratory reference range changed between reports.</p>}
            </>}
          </section>)}
        </div>
        {active && <div className="h-96 min-w-0" aria-label="Block trends chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin - 2592000000", "dataMax + 2592000000"]} tickFormatter={(t) => formatDate(new Date(t).toISOString())} fontSize={11} />
              <YAxis fontSize={11} domain={["auto", "auto"]} />
              <Tooltip shared={false} content={<TooltipBody />} />
              <Legend content={() => <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
                {blockTrends.map((b) => <span key={b.paddockId} className="inline-flex items-center gap-1">
                  <svg width="28" height="10" aria-hidden><line x1="0" x2="28" y1="5" y2="5" stroke={b.style.color} strokeWidth="2" strokeDasharray={b.style.dash} /></svg>
                  {b.name}{b.series ? "" : " · No data"}
                </span>)}
              </div>} />
              {blockTrends.filter((b) => b.raw.length > 0).map((b) => <Fragment key={b.paddockId}>
                <Line data={b.averages} dataKey="avg" name={`${b.name} · Date average`} stroke={b.style.color} strokeDasharray={b.style.dash} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Scatter data={b.raw} dataKey="raw" name={`${b.name} · Laboratory result`} fill={b.style.color} shape={b.style.shape} isAnimationActive={false} />
              </Fragment>)}
            </ComposedChart>
          </ResponsiveContainer>
        </div>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b text-left text-muted-foreground">
              {["Block", "Date", "Lab paddock / sample", "Value", "Method", "Depth", "Lab range", "Lab status"].map((h) => <th key={h} className="py-2 pr-3 font-medium whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>{rawRows.map((r) => <tr key={`${r.matched_paddock_id}:${r.id}`} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium">{blockName(r.matched_paddock_id)}</td><td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.sample.sampled_at)}</td>
              <td className="py-2 pr-3">{[r.sample.lab_paddock_name, r.sample.lab_sample_id].filter(Boolean).join(" · ") || "—"}</td>
              <td className="py-2 pr-3">{r.value_numeric ?? r.value_text ?? "—"} {r.unit ?? ""}</td><td className="py-2 pr-3">{r.method ?? "Not recorded"}</td>
              <td className="py-2 pr-3">{depthOf(r.sample)}</td><td className="py-2 pr-3">{rangeOf(r)}</td><td className="py-2">{labStatusLabel(r.lab_status)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
  </div>;
}
