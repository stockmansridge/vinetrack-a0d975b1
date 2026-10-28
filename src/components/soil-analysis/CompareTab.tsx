// Compare tab — two modes over the same sample period:
// - Values (default): one analyte + one visual series, latest value per
//   selected block as a neutral horizontal bar; no-result blocks stay listed.
// - Status overview: the analyte × block lab-status matrix (secondary).
// Known/unknown methods, different methods and different units are never
// mixed; an all-methods-missing series is shown as provisional.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  listBlockPeriodResults,
  listAnalyteCatalogue,
  buildCompareMatrix,
  filterCompareMatrix,
  compareSeriesOptions,
  buildValueComparison,
  sortValueComparison,
  summariseValueComparison,
  labStatusLabel,
  formatMapValue,
  soilTimePresetCutoff,
  COMPARE_PROVISIONAL_BADGE,
} from "@/lib/soilAnalysis";
import { SoilAnalyteCombobox } from "./SoilAnalyteCombobox";
import { SoilTimePeriodSelect } from "./SoilTimePeriodSelect";
import { SoilBlockSelector } from "./SoilBlockSelector";
import { formatDate } from "@/pages/admin/_shared";

const db = supabase as any;

const STATUS_CLASS: Record<string, string> = {
  low: "border-warning/50 bg-warning/10 text-warning-foreground",
  within_range: "border-primary/40 bg-primary/10 text-primary",
  high: "border-destructive/40 bg-destructive/10 text-destructive",
};
const STATUS_SHORT: Record<string, string> = {
  low: "Below",
  within_range: "Within",
  high: "Above",
};

export type CompareMode = "values" | "status";
export const DEFAULT_COMPARE_MODE: CompareMode = "values";

export function CompareTab() {
  const { selectedVineyardId } = useVineyard();
  const navigate = useNavigate();
  const [mode, setMode] = useState<CompareMode>(DEFAULT_COMPARE_MODE);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [timeKey, setTimeKey] = useState("all");
  const [analyteKey, setAnalyteKey] = useState("");
  const [seriesKey, setSeriesKey] = useState("");
  const [order, setOrder] = useState<"value" | "block">("value");
  const [category, setCategory] = useState("");
  const [outsideOnly, setOutsideOnly] = useState(false);

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
    queryKey: ["soil-analysis", "compare", selectedBlocks, dateFrom, dateTo],
    enabled: selectedBlocks.length > 0,
    queryFn: () => listBlockPeriodResults(selectedBlocks, dateFrom || null, dateTo || null),
  });

  const blocks = blocksQuery.data ?? [];
  const analytes = analytesQuery.data ?? [];
  const rows = resultsQuery.data ?? [];

  const presentAnalytes = useMemo(() => {
    const present = new Set(rows.map((r) => r.analyte_key).filter(Boolean) as string[]);
    return analytes.filter((a) => present.has(a.key));
  }, [rows, analytes]);
  const analyteKeys = presentAnalytes.map((a) => a.key);
  const categories = [...new Set(presentAnalytes.map((a) => a.category ?? "Other"))];

  useEffect(() => {
    if (presentAnalytes.length && !presentAnalytes.some((a) => a.key === analyteKey)) {
      setAnalyteKey(presentAnalytes[0].key);
    }
  }, [presentAnalytes, analyteKey]);

  const seriesOptions = useMemo(() => compareSeriesOptions(rows, analyteKey), [rows, analyteKey]);
  useEffect(() => {
    if (!seriesOptions.some((s) => s.key === seriesKey)) setSeriesKey(seriesOptions[0]?.key ?? "");
  }, [seriesOptions, seriesKey]);
  const activeSeries = seriesOptions.find((s) => s.key === seriesKey) ?? null;

  const analyteName = (key: string) => analytes.find((a) => a.key === key)?.display_name ?? key;
  const categoryOf = (key: string) => analytes.find((a) => a.key === key)?.category ?? "Other";
  const blockName = (id: string) => blocks.find((b) => b.id === id)?.name ?? "Block";

  const valueRows = sortValueComparison(
    buildValueComparison(rows, selectedBlocks, seriesKey),
    order,
    blockName,
  );
  const valueSummary = summariseValueComparison(valueRows);
  const maxValue = valueSummary.highest?.value ?? 0;
  const unit = activeSeries?.unit ? ` ${activeSeries.unit}` : "";

  const matrix = useMemo(
    () => buildCompareMatrix(rows, selectedBlocks, analyteKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selectedBlocks, analyteKeys.join("|")],
  );
  const filteredMatrix = filterCompareMatrix(matrix, {
    category: category || null,
    outsideOnly,
    categoryOf,
  });

  const selectClass = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
  const depth = (s: { sample_depth_from_cm: number | null; sample_depth_to_cm: number | null }) =>
    s.sample_depth_from_cm != null ? `${s.sample_depth_from_cm}–${s.sample_depth_to_cm ?? "?"} cm` : "—";

  return (
    <div className="w-full max-w-none min-w-0 space-y-3">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex gap-1" role="group" aria-label="Compare mode">
            <Button size="sm" variant={mode === "values" ? "default" : "outline"} onClick={() => setMode("values")}>
              Values
            </Button>
            <Button size="sm" variant={mode === "status" ? "default" : "outline"} onClick={() => setMode("status")}>
              Status overview
            </Button>
          </div>
          <SoilBlockSelector blocks={blocks} selected={selectedBlocks} onChange={setSelectedBlocks} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Sample period:</span>
            <SoilTimePeriodSelect ariaLabel="Compare period preset" showCustom value={timeKey} onChange={(key) => {
              setTimeKey(key);
              const cutoff = soilTimePresetCutoff(key);
              if (cutoff) setDateFrom(cutoff);
              else { setDateFrom(""); setDateTo(""); }
            }} />
            <Input type="date" className="w-auto" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setTimeKey(""); }} aria-label="Period from" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" className="w-auto" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setTimeKey(""); }} aria-label="Period to" />
          </div>
          {mode === "values" && presentAnalytes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <SoilAnalyteCombobox
                ariaLabel="Compare analyte"
                value={analyteKey}
                options={presentAnalytes.map((a) => ({ key: a.key, name: a.display_name, category: a.category ?? "Other" }))}
                onChange={setAnalyteKey}
              />
              {seriesOptions.length > 1 && (
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Compare series">
                  <span className="text-xs text-muted-foreground">Series:</span>
                  {seriesOptions.map((s) => (
                    <Button key={s.key} size="sm" variant={seriesKey === s.key ? "default" : "outline"} onClick={() => setSeriesKey(s.key)}>
                      {s.method ?? "Method not recorded"} · {s.unit ?? "unit not recorded"}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex gap-1" role="group" aria-label="Sort order">
                <Button size="sm" variant={order === "value" ? "default" : "outline"} onClick={() => setOrder("value")}>High → low</Button>
                <Button size="sm" variant={order === "block" ? "default" : "outline"} onClick={() => setOrder("block")}>Block order</Button>
              </div>
            </div>
          )}
          {mode === "status" && categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={outsideOnly} onChange={(e) => setOutsideOnly(e.target.checked)} />
                Outside lab range only
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedBlocks.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6">
          Choose blocks to compare their latest laboratory results.
        </div>
      ) : resultsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground py-6">Loading results…</div>
      ) : presentAnalytes.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6">
          No measured analytes for the selected blocks in this period.
        </div>
      ) : mode === "values" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Blocks with data</div>
              <div className="text-lg font-semibold">{valueSummary.withData} / {valueSummary.selected}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Highest measured</div>
              <div className="text-lg font-semibold">
                {valueSummary.highest ? `${formatMapValue(valueSummary.highest.value)}${unit}` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">{valueSummary.highest ? blockName(valueSummary.highest.paddockId) : ""}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Lowest measured</div>
              <div className="text-lg font-semibold">
                {valueSummary.lowest ? `${formatMapValue(valueSummary.lowest.value)}${unit}` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">{valueSummary.lowest ? blockName(valueSummary.lowest.paddockId) : ""}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Spread (max − min)</div>
              <div className="text-lg font-semibold">
                {valueSummary.spread != null ? `${formatMapValue(valueSummary.spread)}${unit}` : "—"}
              </div>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex flex-wrap items-center gap-2">
                <span>{analyteName(analyteKey)}</span>
                <Badge variant="outline">{activeSeries?.method ?? "Method not recorded"}</Badge>
                <Badge variant="outline">{activeSeries?.unit ?? "Unit not recorded"}</Badge>
                {activeSeries?.provisional && (
                  <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning-foreground">
                    {COMPARE_PROVISIONAL_BADGE}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {valueRows.map((r) => {
                const v = r.result?.value_numeric;
                const pct = typeof v === "number" && maxValue > 0 ? Math.max(2, (v / maxValue) * 100) : 0;
                return (
                  <button
                    key={r.paddockId}
                    type="button"
                    className="grid w-full grid-cols-[9rem_1fr_auto] items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
                    disabled={!r.result}
                    onClick={() => r.result && navigate(`/soil-analysis/samples/${r.result.sample.id}`)}
                    aria-label={`${blockName(r.paddockId)} ${r.result ? "open source sample" : "no result"}`}
                  >
                    <span className="truncate">
                      <span className="block truncate font-medium">{blockName(r.paddockId)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.result ? formatDate(r.result.sample.sampled_at) : ""}
                      </span>
                    </span>
                    <span className="h-5 rounded bg-muted">
                      {typeof v === "number" && (
                        <span className="block h-5 rounded bg-primary/70" style={{ width: `${pct}%` }} />
                      )}
                    </span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                      {r.result ? (
                        <>
                          <span className="font-medium">
                            {v != null ? `${formatMapValue(v)}${unit}` : (r.result.value_text ?? "—")}
                          </span>
                          <Badge variant="outline" className={STATUS_CLASS[r.result.lab_status ?? ""] ?? ""}>
                            {labStatusLabel(r.result.lab_status)}
                          </Badge>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No result</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="overflow-auto">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {["Block", "Value", "Date", "Depth", "Lab range", "Lab status", "Lab/sample"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {valueRows.map((r) => (
                    <tr key={r.paddockId} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-medium">{blockName(r.paddockId)}</td>
                      {r.result ? (
                        <>
                          <td className="px-3 py-1.5">
                            {r.result.value_numeric != null ? `${formatMapValue(r.result.value_numeric)}${unit}` : (r.result.value_text ?? "—")}
                          </td>
                          <td className="px-3 py-1.5">{formatDate(r.result.sample.sampled_at)}</td>
                          <td className="px-3 py-1.5">{depth(r.result.sample)}</td>
                          <td className="px-3 py-1.5">
                            {r.result.lab_range_text ??
                              (r.result.lab_range_min != null || r.result.lab_range_max != null
                                ? `${r.result.lab_range_min ?? "?"}–${r.result.lab_range_max ?? "?"}`
                                : "—")}
                          </td>
                          <td className="px-3 py-1.5">{labStatusLabel(r.result.lab_status)}</td>
                          <td className="px-3 py-1.5">
                            {[r.result.sample.laboratory, r.result.sample.lab_sample_id].filter(Boolean).join(" · ") || "—"}
                          </td>
                        </>
                      ) : (
                        <td className="px-3 py-1.5 text-muted-foreground" colSpan={6}>No result</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Laboratory status by block</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredMatrix.length === 0 ? (
              <div className="px-4 pb-4 text-sm text-muted-foreground">No analytes match these filters.</div>
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-20 bg-card">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="sticky left-0 z-30 bg-card px-3 py-2 font-medium">Analyte</th>
                      {selectedBlocks.map((id) => (
                        <th key={id} className="whitespace-nowrap px-3 py-2 font-medium">{blockName(id)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatrix.map((row) => {
                      const key = row[0]?.analyteKey ?? "";
                      const mixed = row.some((c) => c.mixedMethods);
                      return (
                        <tr key={key} className="border-b last:border-0">
                          <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              {analyteName(key)}
                              {mixed && (
                                <span
                                  title="Mixed methods or units across blocks — values are not directly comparable."
                                  aria-label="Mixed methods or units"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                                </span>
                              )}
                            </span>
                          </td>
                          {row.map((cell) => (
                            <td key={cell.paddockId} className="px-3 py-1.5">
                              {cell.result ? (
                                <div className="flex flex-col gap-0.5">
                                  <Badge
                                    variant="outline"
                                    className={`w-fit px-1.5 py-0 text-[11px] ${STATUS_CLASS[cell.result.lab_status ?? ""] ?? ""}`}
                                  >
                                    {STATUS_SHORT[cell.result.lab_status ?? ""] ?? "Not stated"}
                                  </Badge>
                                  <span className="text-[11px] text-muted-foreground">
                                    {cell.result.value_numeric ?? cell.result.value_text ?? "—"} {cell.result.unit ?? ""}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">No result</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
