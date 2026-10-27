// Reports tab — the primary reporting experience is the vineyard analyte
// map. Data comes only from the two reporting RPCs, which return CONFIRMED
// samples only; review/failed samples are never queried here. Method/unit
// series are never mixed: when one analyte has several comparable series the
// user must pick one explicitly. Values describe measured results, lab
// ranges/status and historical change only — no agronomic prescriptions.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVineyard } from "@/context/VineyardContext";
import {
  getSoilMapReport,
  listSoilReportSeries,
  pickDefaultSeries,
  seriesForAnalyte,
  seriesKey,
  summariseMapReport,
  formatMapValue,
  labStatusLabel,
  SOIL_MAP_NO_DATA_COLOR,
  LAB_STATUS_MAP_COLOR,
  type SoilMapReportRow,
  type SoilReportSeries,
} from "@/lib/soilAnalysis";
import { formatDate } from "@/pages/admin/_shared";
import { SoilReportMap, type SoilMapMode } from "./SoilReportMap";

type SortKey = "block" | "value" | "date";

function depthLabel(row: SoilMapReportRow): string {
  if (row.sample_depth_from_cm == null && row.sample_depth_to_cm == null) return "—";
  if (row.sample_depth_from_cm != null && row.sample_depth_to_cm != null)
    return `${row.sample_depth_from_cm}–${row.sample_depth_to_cm} cm`;
  return `${row.sample_depth_from_cm ?? row.sample_depth_to_cm} cm`;
}

export function ReportsTab({ onOpenSample }: { onOpenSample: (id: string) => void }) {
  const { memberships, selectedVineyardId } = useVineyard();
  const [vineyardId, setVineyardId] = useState<string>(selectedVineyardId ?? "");
  const [analyteKey, setAnalyteKey] = useState<string>("");
  const [chosenSeriesKey, setChosenSeriesKey] = useState<string>("");
  const [asOf, setAsOf] = useState<string>("");
  const [mode, setMode] = useState<SoilMapMode>("value");
  const [selectedPaddockId, setSelectedPaddockId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "block", dir: 1 });

  const seriesQuery = useQuery({
    queryKey: ["soil-analysis", "report-series", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => listSoilReportSeries(vineyardId),
  });
  const series = seriesQuery.data ?? [];

  // Default selection: Total Carbon when it exists, otherwise the first
  // series; a single method/unit series auto-selects.
  useEffect(() => {
    if (series.length === 0 || analyteKey) return;
    const def = pickDefaultSeries(series);
    if (def) {
      setAnalyteKey(def.analyte_key);
      setChosenSeriesKey(seriesKey(def));
    }
  }, [series, analyteKey]);

  const analyteSeries = useMemo(
    () => (analyteKey ? seriesForAnalyte(series, analyteKey) : []),
    [series, analyteKey],
  );
  const activeSeries: SoilReportSeries | null = useMemo(() => {
    if (analyteSeries.length === 0) return null;
    if (analyteSeries.length === 1) return analyteSeries[0];
    return analyteSeries.find((s) => seriesKey(s) === chosenSeriesKey) ?? null;
  }, [analyteSeries, chosenSeriesKey]);

  // Analyte options grouped by category.
  const analyteGroups = useMemo(() => {
    const groups = new Map<string, SoilReportSeries[]>();
    for (const s of series) {
      const cat = s.category ?? "Other";
      if (!groups.has(cat)) groups.set(cat, []);
      const list = groups.get(cat)!;
      if (!list.some((x) => x.analyte_key === s.analyte_key)) list.push(s);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [series]);

  const mapQuery = useQuery({
    queryKey: [
      "soil-analysis",
      "map-report",
      {
        vineyardId,
        analyteKey,
        method: activeSeries?.method ?? null,
        unit: activeSeries?.unit ?? null,
        asOf: asOf || null,
      },
    ],
    enabled: !!vineyardId && !!activeSeries,
    queryFn: () =>
      getSoilMapReport({
        vineyardId,
        analyteKey,
        method: activeSeries!.method,
        unit: activeSeries!.unit,
        asOf: asOf || null,
      }),
  });
  const rows = mapQuery.data ?? [];
  const stats = useMemo(() => summariseMapReport(rows), [rows]);
  const selectedRow = rows.find((r) => r.paddock_id === selectedPaddockId) ?? null;

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort.key === "block") cmp = (a.paddock_name ?? "").localeCompare(b.paddock_name ?? "");
      else if (sort.key === "date")
        cmp = (a.sampled_at ?? "").localeCompare(b.sampled_at ?? "");
      else {
        // Null values always sort last.
        if (a.value_numeric == null && b.value_numeric == null) cmp = 0;
        else if (a.value_numeric == null) return 1;
        else if (b.value_numeric == null) return -1;
        else cmp = a.value_numeric - b.value_numeric;
      }
      return cmp * sort.dir;
    });
    return copy;
  }, [rows, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const selectClass = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
  const unit = activeSeries?.unit ?? null;

  const deltaLabel = (row: SoilMapReportRow): string => {
    if (row.value_numeric == null || row.previous_value_numeric == null) return "—";
    const d = row.value_numeric - row.previous_value_numeric;
    if (d === 0) return "No change";
    return `${d > 0 ? "+" : ""}${formatMapValue(d)}${unit ? ` ${unit}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Vineyard soil map</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Vineyard</Label>
              <select
                className={selectClass}
                value={vineyardId}
                onChange={(e) => {
                  setVineyardId(e.target.value);
                  setAnalyteKey("");
                  setChosenSeriesKey("");
                  setSelectedPaddockId(null);
                }}
                aria-label="Report vineyard"
              >
                <option value="">Choose a vineyard…</option>
                {memberships.map((m) => (
                  <option key={m.vineyard_id} value={m.vineyard_id}>
                    {m.vineyard_name ?? m.vineyard_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Analyte</Label>
              <select
                className={selectClass}
                value={analyteKey}
                onChange={(e) => {
                  setAnalyteKey(e.target.value);
                  const options = seriesForAnalyte(series, e.target.value);
                  setChosenSeriesKey(options.length === 1 ? seriesKey(options[0]) : "");
                  setSelectedPaddockId(null);
                }}
                aria-label="Report analyte"
              >
                {analyteGroups.map(([category, items]) => (
                  <optgroup key={category} label={category}>
                    {items.map((s) => (
                      <option key={s.analyte_key} value={s.analyte_key}>
                        {s.analyte_name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {analyteSeries.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Method / unit series</Label>
                <select
                  className={selectClass}
                  value={chosenSeriesKey}
                  onChange={(e) => setChosenSeriesKey(e.target.value)}
                  aria-label="Method and unit series"
                >
                  <option value="">Choose a series…</option>
                  {analyteSeries.map((s) => (
                    <option key={seriesKey(s)} value={seriesKey(s)}>
                      {s.method ?? "Method not recorded"} · {s.unit ?? "unit not recorded"} (
                      {s.sample_count} sample{s.sample_count === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">As of (optional)</Label>
              <Input
                type="date"
                className="w-auto"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                aria-label="As of date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Colour by</Label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={mode === "value" ? "default" : "outline"}
                  onClick={() => setMode("value")}
                >
                  Value
                </Button>
                <Button
                  size="sm"
                  variant={mode === "status" ? "default" : "outline"}
                  onClick={() => setMode("status")}
                >
                  Lab status
                </Button>
              </div>
            </div>
          </div>

          {seriesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading report series…</div>
          ) : seriesQuery.error ? (
            <div className="text-sm text-destructive">
              {(seriesQuery.error as Error).message}
            </div>
          ) series.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No confirmed, mapped soil results yet. Confirm reviewed samples with a block mapping
              and they will appear here.
            </div>
          ) : !activeSeries ? (
            <div className="text-sm text-muted-foreground">
              This analyte has more than one method/unit series — choose one to compare like with
              like.
            </div>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Blocks with data</div>
                    <div className="text-lg font-semibold">
                      {stats.withData} / {stats.totalBlocks}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Latest sample in series</div>
                    <div className="text-lg font-semibold">{formatDate(stats.latestSampledAt)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">
                      Min / median / max{unit ? ` (${unit})` : ""}
                    </div>
                    <div className="text-lg font-semibold">
                      {stats.min == null
                        ? "—"
                        : `${formatMapValue(stats.min)} / ${formatMapValue(stats.median)} / ${formatMapValue(stats.max)}`}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">
                      Average{unit ? ` (${unit})` : ""}
                    </div>
                    <div className="text-lg font-semibold">{formatMapValue(stats.average)}</div>
                  </CardContent>
                </Card>
              </div>

              {mapQuery.isLoading ? (
                <div className="h-[520px] rounded-md bg-muted animate-pulse" />
              ) : mapQuery.error ? (
                <div className="text-sm text-destructive">
                  {(mapQuery.error as Error).message}
                </div>
              ) : (
                <SoilReportMap
                  rows={rows}
                  mode={mode}
                  unit={unit}
                  selectedId={selectedPaddockId}
                  onSelect={setSelectedPaddockId}
                />
              )}

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                {mode === "value" ? (
                  <>
                    <span className="font-medium text-foreground">
                      {activeSeries.analyte_name}
                      {unit ? ` (${unit})` : ""}
                    </span>
                    {stats.min != null && stats.max != null ? (
                      <span className="flex items-center gap-1.5">
                        <span>{formatMapValue(stats.min)}</span>
                        <span
                          className="inline-block h-2.5 w-28 rounded-full"
                          style={{
                            background:
                              "linear-gradient(to right, #e3f2e8, #1b7a43)",
                          }}
                        />
                        <span>{formatMapValue(stats.max)}</span>
                        {stats.median != null && stats.min !== stats.max && (
                          <span>(mid {formatMapValue((stats.min + stats.max) / 2)})</span>
                        )}
                      </span>
                    ) : (
                      <span>No confirmed values in this series yet</span>
                    )}
                  </>
                ) : (
                  <>
                    {(["low", "within_range", "high", "unknown"] as const).map((k) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ background: LAB_STATUS_MAP_COLOR[k] }}
                        />
                        {labStatusLabel(k)}
                      </span>
                    ))}
                  </>
                )}
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: SOIL_MAP_NO_DATA_COLOR }}
                  />
                  No confirmed value
                </span>
              </div>

              {selectedRow && (
                <Card>
                  <CardContent className="p-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                    <span className="font-semibold">{selectedRow.paddock_name ?? "Block"}</span>
                    <span>
                      {selectedRow.value_numeric != null
                        ? `${formatMapValue(selectedRow.value_numeric)}${unit ? ` ${unit}` : ""}`
                        : (selectedRow.value_text ?? "No confirmed value")}
                    </span>
                    <span className="text-muted-foreground">
                      Sampled {formatDate(selectedRow.sampled_at)}
                    </span>
                    {(selectedRow.laboratory || selectedRow.lab_sample_id) && (
                      <span className="text-muted-foreground">
                        {selectedRow.laboratory ?? "—"}
                        {selectedRow.lab_sample_id ? ` · ${selectedRow.lab_sample_id}` : ""}
                      </span>
                    )}
                    <span className="text-muted-foreground">Depth {depthLabel(selectedRow)}</span>
                    {(selectedRow.lab_range_min != null ||
                      selectedRow.lab_range_max != null ||
                      selectedRow.lab_range_text) && (
                      <span className="text-muted-foreground">
                        Lab range{" "}
                        {selectedRow.lab_range_min != null || selectedRow.lab_range_max != null
                          ? `${selectedRow.lab_range_min ?? "?"}–${selectedRow.lab_range_max ?? "?"}`
                          : selectedRow.lab_range_text}
                      </span>
                    )}
                    <Badge variant="outline">{labStatusLabel(selectedRow.lab_status)}</Badge>
                    {selectedRow.previous_value_numeric != null && (
                      <span className="text-muted-foreground">
                        Previous {formatMapValue(selectedRow.previous_value_numeric)}
                        {unit ? ` ${unit}` : ""} ({formatDate(selectedRow.previous_sampled_at)}) ·{" "}
                        {deltaLabel(selectedRow)}
                      </span>
                    )}
                    {selectedRow.sample_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => onOpenSample(selectedRow.sample_id!)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Open soil sample
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Block values</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        {(
                          [
                            ["block", "Block"],
                            ["value", "Current value"],
                            ["date", "Sample date"],
                          ] as Array<[SortKey, string]>
                        ).map(([key, label]) => (
                          <th key={key} className="px-4 py-2 font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1"
                              onClick={() => toggleSort(key)}
                            >
                              {label}
                              {sort.key === key &&
                                (sort.dir === 1 ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : (
                                  <ArrowDown className="h-3 w-3" />
                                ))}
                            </button>
                          </th>
                        ))}
                        <th className="px-4 py-2 font-medium">Depth</th>
                        <th className="px-4 py-2 font-medium">Lab status</th>
                        <th className="px-4 py-2 font-medium">Previous value</th>
                        <th className="px-4 py-2 font-medium">Change</th>
                        <th className="px-4 py-2 font-medium">Sample</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => (
                        <tr
                          key={row.paddock_id}
                          className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                          onClick={() => setSelectedPaddockId(row.paddock_id)}
                        >
                          <td className="px-4 py-2 font-medium">{row.paddock_name ?? "—"}</td>
                          <td className="px-4 py-2">
                            {row.value_numeric != null
                              ? `${formatMapValue(row.value_numeric)}${unit ? ` ${unit}` : ""}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2">{formatDate(row.sampled_at)}</td>
                          <td className="px-4 py-2">{depthLabel(row)}</td>
                          <td className="px-4 py-2">{labStatusLabel(row.lab_status)}</td>
                          <td className="px-4 py-2">
                            {row.previous_value_numeric != null
                              ? `${formatMapValue(row.previous_value_numeric)}${unit ? ` ${unit}` : ""}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2">{deltaLabel(row)}</td>
                          <td className="px-4 py-2">
                            {row.sample_id ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1 px-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenSample(row.sample_id!);
                                }}
                              >
                                <ExternalLink className="h-3.5 w-3.5" /> Open
                              </Button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground">
                Each block shows its own latest confirmed sample date — blocks may have been
                sampled on different dates. Use “As of” to reconstruct a historical snapshot.
                Values are laboratory measurements only; no recommendations are made.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
