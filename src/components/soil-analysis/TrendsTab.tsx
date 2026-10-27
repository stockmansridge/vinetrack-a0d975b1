// Trends tab — chronological results for one block + analyte. Only results
// with the same canonical analyte, compatible method and compatible unit are
// drawn together; anything else is shown as a separate, labelled series or a
// neutral "not comparable" note. Direction (improving/declining) is shown
// only when the analyte catalogue carries direction metadata.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  listBlockAnalyteResults,
  listAnalyteCatalogue,
  buildTrendGroups,
  classifyChange,
  labStatusLabel,
} from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";

const db = supabase as any;

export function TrendsTab() {
  const { selectedVineyardId } = useVineyard();
  const [paddockId, setPaddockId] = useState("");
  const [analyteKey, setAnalyteKey] = useState("");

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

  const analyte = (analytesQuery.data ?? []).find((a) => a.analyte_key === analyteKey);
  const points = (resultsQuery.data ?? []).map((r) => ({ result: r, sample: r.sample }));
  const groups = useMemo(() => buildTrendGroups(points), [resultsQuery.data]);

  const selectClass = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectClass} value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Trend block">
          <option value="">Choose a block…</option>
          {(blocksQuery.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select className={selectClass} value={analyteKey} onChange={(e) => setAnalyteKey(e.target.value)} aria-label="Trend analyte">
          <option value="">Choose an analyte…</option>
          {(analytesQuery.data ?? []).map((a) => (
            <option key={a.analyte_key} value={a.analyte_key}>{a.display_name}</option>
          ))}
        </select>
      </div>

      {!paddockId || !analyteKey ? (
        <div className="text-sm text-muted-foreground py-6">
          Choose a block and an analyte to plot comparable results over time.
        </div>
      ) : resultsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground py-6">Loading results…</div>
      ) : groups.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6">
          No results recorded for this block and analyte yet.
        </div>
      ) : (
        groups.map((group, gi) => {
          const chartData = group.points.map((p) => ({
            date: p.sample.sample_date ?? p.sample.created_at,
            value: p.result.value_numeric,
            depth:
              p.sample.depth_from_cm != null
                ? `${p.sample.depth_from_cm}–${p.sample.depth_to_cm ?? "?"} cm`
                : "depth not recorded",
            method: p.result.method ?? "method not recorded",
            status: labStatusLabel(p.result.lab_status),
          }));
          const numeric = group.points.filter((p) => p.result.value_numeric != null);
          const last = numeric[numeric.length - 1];
          const prev = numeric[numeric.length - 2];
          const change =
            last && prev
              ? classifyChange(prev.result.value_numeric!, last.result.value_numeric!, analyte?.higher_is_better)
              : null;
          return (
            <Card key={gi}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex flex-wrap items-center gap-2">
                  <span>{analyte?.display_name ?? analyteKey}</span>
                  <Badge variant="outline">{group.method ?? "Method not recorded"}</Badge>
                  <Badge variant="outline">{group.unit ?? "Unit not recorded"}</Badge>
                  {groups.length > 1 && (
                    <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning-foreground">
                      Separate series — methods/units are not comparable
                    </Badge>
                  )}
                  {change && (
                    <Badge variant="outline">
                      {change.direction === "not_classified"
                        ? `Change ${change.delta >= 0 ? "+" : ""}${change.delta} (not classified)`
                        : `${change.direction} (${change.delta >= 0 ? "+" : ""}${change.delta})`}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {chartData.some((d) => d.value == null) ? (
                  <div className="text-xs text-muted-foreground mb-2">
                    Some results have no numeric value and are listed below only.
                  </div>
                ) : null}
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip
                        labelFormatter={(d) => formatDate(d as string)}
                        formatter={(value: any, _name, item: any) => [
                          `${value ?? "—"} ${group.unit ?? ""}`,
                          `${item.payload.method} · ${item.payload.depth} · ${item.payload.status}`,
                        ]}
                      />
                      <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full text-xs mt-3">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Sample date</th>
                      <th className="py-1 pr-3 font-medium">Value</th>
                      <th className="py-1 pr-3 font-medium">Method</th>
                      <th className="py-1 pr-3 font-medium">Depth</th>
                      <th className="py-1 font-medium">Lab status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.points.map((p) => (
                      <tr key={p.result.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">{formatDate(p.sample.sample_date)}</td>
                        <td className="py-1 pr-3">
                          {p.result.value_numeric ?? p.result.value_text ?? "—"} {p.result.unit ?? ""}
                        </td>
                        <td className="py-1 pr-3">{p.result.method ?? "—"}</td>
                        <td className="py-1 pr-3">
                          {p.sample.depth_from_cm != null
                            ? `${p.sample.depth_from_cm}–${p.sample.depth_to_cm ?? "?"} cm`
                            : "—"}
                        </td>
                        <td className="py-1">{labStatusLabel(p.result.lab_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
