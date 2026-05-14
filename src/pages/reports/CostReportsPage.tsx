// Cost Reports — Block × Variety cost breakdown.
// Owner/manager only. Reads from trip_cost_allocations (iOS Supabase),
// which is RLS-restricted to owner/manager. We additionally gate the
// query and the entire page behind useCanSeeCosts().
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Download, AlertTriangle, Info } from "lucide-react";
import { Link } from "react-router-dom";

import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { useCanSeeCosts } from "@/lib/permissions";
import {
  fetchTripCostAllocationsForVineyard,
  type TripCostAllocation,
} from "@/lib/tripCostAllocationsQuery";
import {
  useGrapeVarieties,
  buildVarietyMap,
  primaryVarietyName,
} from "@/lib/varietyResolver";
import CostingSetupWizard, {
  useCostingSetupSummary,
} from "@/components/cost/CostingSetupWizard";

import { Card } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

const ANY = "__any__";

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}
function fmtNum(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: dp });
}
function warningsList(w: any): string[] {
  if (!w) return [];
  if (Array.isArray(w)) return w.map(String).filter(Boolean);
  if (typeof w === "string") return w ? [w] : [];
  if (typeof w === "object") return Object.values(w).map(String).filter(Boolean);
  return [];
}

function NoAccessCard() {
  return (
    <div className="p-6 max-w-2xl">
      <Card className="p-6 flex items-start gap-3">
        <Lock className="h-5 w-5 mt-0.5 text-muted-foreground" />
        <div>
          <h2 className="font-medium">Cost Reports are restricted</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Only Owners and Managers can view cost allocation data. Please ask
            your vineyard owner to update your role if you need access.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default function CostReportsPage() {
  const canSeeCosts = useCanSeeCosts();
  const { selectedVineyardId } = useVineyard();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["trip_cost_allocations", selectedVineyardId],
    queryFn: () => fetchTripCostAllocationsForVineyard(selectedVineyardId!),
    enabled: !!selectedVineyardId && canSeeCosts,
  });

  // Resolve varieties from paddocks.variety_allocations + grape_varieties
  // so rows whose snapshot variety is missing/UUID can still display a name.
  const { data: grapeVarieties } = useGrapeVarieties(canSeeCosts ? selectedVineyardId : null);
  const { data: paddockRows = [] } = useQuery({
    queryKey: ["paddocks-for-cost-reports", selectedVineyardId],
    enabled: !!selectedVineyardId && canSeeCosts,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select("id,variety_allocations")
        .eq("vineyard_id", selectedVineyardId);
      if (error) {
        console.warn("[paddocks] fetch failed:", error.message);
        return [];
      }
      return (data ?? []) as Array<{ id: string; variety_allocations: any }>;
    },
  });
  const varietyMap = useMemo(() => buildVarietyMap(grapeVarieties), [grapeVarieties]);
  const paddockAllocsById = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of paddockRows) m.set(p.id, p.variety_allocations);
    return m;
  }, [paddockRows]);

  // UUID detector — trip_cost_allocations.variety sometimes stores a varietyId
  // string snapshot rather than a name; resolve those here too.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function resolveRowVariety(r: TripCostAllocation): string | null {
    const raw = (r.variety ?? "").toString().trim();
    if (raw && !/^unassigned/i.test(raw)) {
      if (UUID_RE.test(raw) && varietyMap.byId.has(raw)) return varietyMap.byId.get(raw)!;
      // Case-insensitive name match → canonical capitalisation, else use as-is.
      const ci = varietyMap.byNameLower.get(raw.toLowerCase());
      if (ci) return ci;
      if (!UUID_RE.test(raw)) return raw;
    }
    if (r.paddock_id) {
      const allocs = paddockAllocsById.get(r.paddock_id);
      const name = primaryVarietyName(allocs, varietyMap);
      if (name) return name;
    }
    return null;
  }

  const [season, setSeason] = useState<string>(ANY);
  const [paddock, setPaddock] = useState<string>(ANY);
  const [variety, setVariety] = useState<string>(ANY);
  const [tripFn, setTripFn] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [drill, setDrill] = useState<TripCostAllocation | null>(null);

  const seasons = useMemo(
    () => Array.from(new Set(rows.map((r) => r.season_year).filter((v): v is number => v != null))).sort((a, b) => b - a),
    [rows],
  );
  const paddocks = useMemo(
    () => Array.from(new Set(rows.map((r) => r.paddock_name).filter((v): v is string => !!v))).sort(),
    [rows],
  );
  const varieties = useMemo(
    () => Array.from(new Set(rows.map((r) => resolveRowVariety(r)).filter((v): v is string => !!v))).sort(),
    [rows, varietyMap, paddockAllocsById],
  );
  const tripFns = useMemo(
    () => Array.from(new Set(rows.map((r) => r.trip_function).filter((v): v is string => !!v))).sort(),
    [rows],
  );
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.costing_status).filter((v): v is string => !!v))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (season !== ANY && String(r.season_year ?? "") !== season) return false;
      if (paddock !== ANY && (r.paddock_name ?? "") !== paddock) return false;
      if (variety !== ANY && (resolveRowVariety(r) ?? "") !== variety) return false;
      if (tripFn !== ANY && (r.trip_function ?? "") !== tripFn) return false;
      if (status !== ANY && (r.costing_status ?? "") !== status) return false;
      return true;
    });
  }, [rows, season, paddock, variety, tripFn, status, varietyMap, paddockAllocsById]);

  const summary = useMemo(() => {
    let total = 0, area = 0, yieldT = 0, warns = 0;
    const trips = new Set<string>();
    for (const r of filtered) {
      total += Number(r.total_cost ?? 0);
      area += Number(r.allocation_area_ha ?? 0);
      yieldT += Number(r.yield_tonnes ?? 0);
      warns += warningsList(r.warnings).length;
      if (r.trip_id) trips.add(r.trip_id);
    }
    return {
      total,
      area,
      yieldT,
      costPerHa: area > 0 ? total / area : null,
      costPerTonne: yieldT > 0 ? total / yieldT : null,
      tripCount: trips.size,
      warns,
    };
  }, [filtered]);

  if (!canSeeCosts) return <NoAccessCard />;

  function exportCsv() {
    const headers = [
      "season_year","paddock_name","variety","allocation_area_ha","yield_tonnes",
      "labour_cost","fuel_cost","chemical_cost","input_cost","total_cost",
      "cost_per_ha","cost_per_tonne","trip_function","costing_status","warnings",
      "trip_id","calculated_at",
    ];
    const csv = [headers.join(",")].concat(
      filtered.map((r) => [
        r.season_year ?? "",
        csvCell(r.paddock_name),
        csvCell(resolveRowVariety(r) ?? r.variety),
        r.allocation_area_ha ?? "",
        r.yield_tonnes ?? "",
        r.labour_cost ?? "",
        r.fuel_cost ?? "",
        r.chemical_cost ?? "",
        r.input_cost ?? "",
        r.total_cost ?? "",
        r.cost_per_ha ?? "",
        r.cost_per_tonne ?? "",
        csvCell(r.trip_function),
        csvCell(r.costing_status),
        csvCell(warningsList(r.warnings).join("; ")),
        csvCell(r.trip_id),
        csvCell(r.calculated_at),
      ].join(",")),
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const setupSummary = useCostingSetupSummary(canSeeCosts ? selectedVineyardId : null);
  const totalReportWarnings = summary.warns;
  const showMissingBanner = canSeeCosts && (setupSummary.hasIssues || totalReportWarnings > 0);

  const isUnassignedVariety = (v: string | null | undefined) =>
    !v || /^unassigned/i.test(v);

  return (
    <TooltipProvider delayDuration={150}>
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cost Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Block × variety cost breakdown from saved trip cost allocations.
            Recalculations are currently performed in the iOS app.
          </p>
        </div>
        <Button onClick={exportCsv} variant="outline" size="sm" disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-2" />Export CSV
        </Button>
      </div>

      {/* Costing Setup Wizard (owner/manager only) */}
      {selectedVineyardId && <CostingSetupWizard vineyardId={selectedVineyardId} />}

      {/* Missing-data banner */}
      {showMissingBanner && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some costing inputs are missing</AlertTitle>
          <AlertDescription>
            Complete the setup checklist above to improve cost/ha and cost/tonne accuracy.
            {totalReportWarnings > 0 && (
              <> {totalReportWarnings} allocation warning{totalReportWarnings === 1 ? "" : "s"} were flagged in the data below.</>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="Total cost" value={fmtMoney(summary.total)} />
        <SummaryCard
          label="Treated area"
          value={`${fmtNum(summary.area)} ha`}
          info="Treated area is the accumulated mapped block area from the jobs/trips included in this report. If the same block is treated multiple times, its area contributes once per job. Example: a 2 ha block treated 3 times contributes 6 treated ha."
        />
        <SummaryCard
          label="Cost / ha"
          value={fmtMoney(summary.costPerHa)}
          info="Total cost divided by treated area (cumulative across jobs)."
        />
        <SummaryCard label="Yield" value={`${fmtNum(summary.yieldT)} t`} />
        <SummaryCard label="Cost / tonne" value={fmtMoney(summary.costPerTonne)} />
        <SummaryCard label="Trips" value={String(summary.tripCount)} />
        <SummaryCard label="Warnings" value={String(summary.warns)} />
      </div>

      {/* Filters */}
      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <FilterSelect label="Season" value={season} onChange={setSeason} options={seasons.map(String)} />
        <FilterSelect label="Block" value={paddock} onChange={setPaddock} options={paddocks} />
        <FilterSelect label="Variety" value={variety} onChange={setVariety} options={varieties} />
        <FilterSelect label="Function" value={tripFn} onChange={setTripFn} options={tripFns} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={statuses} />
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Season</TableHead>
              <TableHead>Block</TableHead>
              <TableHead>Variety</TableHead>
              <TableHead className="text-right">Area (ha)</TableHead>
              <TableHead className="text-right">Yield (t)</TableHead>
              <TableHead className="text-right">Labour</TableHead>
              <TableHead className="text-right">Fuel</TableHead>
              <TableHead className="text-right">Chemical</TableHead>
              <TableHead className="text-right">Seed/input</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Cost/ha</TableHead>
              <TableHead className="text-right">Cost/t</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                No cost allocations match these filters.
              </TableCell></TableRow>
            )}
            {filtered.map((r) => {
              const warns = warningsList(r.warnings);
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDrill(r)}>
                  <TableCell>{r.season_year ?? "—"}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{r.paddock_name ?? "—"}</TableCell>
                  <TableCell>
                    {(() => {
                      const resolved = resolveRowVariety(r);
                      if (resolved) return resolved;
                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1">
                              <Badge variant="outline" className="text-amber-700 border-amber-400">
                                Unassigned variety
                              </Badge>
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            This block has no variety allocation, or the
                            allocation could not be matched. Add or fix the
                            variety allocation in{" "}
                            <Link to="/setup/paddocks" className="underline">Block settings</Link>.
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right">{fmtNum(r.allocation_area_ha)}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.yield_tonnes)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.labour_cost)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.fuel_cost)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.chemical_cost)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.input_cost)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(r.total_cost)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.cost_per_ha)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.cost_per_tonne)}</TableCell>
                  <TableCell>
                    {r.costing_status ? <Badge variant="outline">{r.costing_status}</Badge> : "—"}
                  </TableCell>
                  <TableCell>
                    {warns.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3" />{warns.length}
                      </span>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Drilldown */}
      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          {drill && (
            <>
              <SheetHeader>
                <SheetTitle>{drill.paddock_name ?? "Cost allocation"}{(() => { const v = resolveRowVariety(drill); return v ? ` · ${v}` : ""; })()}</SheetTitle>
                <SheetDescription>
                  Season {drill.season_year ?? "—"} · {drill.trip_function ?? "trip"}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <DetailRow label="Trip ID" value={drill.trip_id ?? "—"} mono />
                <DetailRow label="Calculated at" value={drill.calculated_at ? new Date(drill.calculated_at).toLocaleString() : "—"} />
                {drill.trip_updated_at && (
                  <DetailRow
                    label="Source trip updated"
                    value={new Date(drill.trip_updated_at).toLocaleString()}
                    extra={drill.calculated_at && drill.trip_updated_at > drill.calculated_at
                      ? <Badge variant="outline" className="ml-2">Stale</Badge>
                      : null}
                  />
                )}
                <DetailRow label="Area" value={`${fmtNum(drill.allocation_area_ha)} ha`} />
                <DetailRow label="Yield" value={`${fmtNum(drill.yield_tonnes)} t`} />
                <hr />
                <DetailRow label="Labour" value={fmtMoney(drill.labour_cost)} />
                <DetailRow label="Fuel" value={fmtMoney(drill.fuel_cost)} />
                <DetailRow label="Chemical" value={fmtMoney(drill.chemical_cost)} />
                <DetailRow label="Seed / input" value={fmtMoney(drill.input_cost)} />
                <DetailRow label="Total" value={fmtMoney(drill.total_cost)} bold />
                <DetailRow label="Cost / ha" value={fmtMoney(drill.cost_per_ha)} />
                <DetailRow label="Cost / tonne" value={fmtMoney(drill.cost_per_tonne)} />
                <DetailRow label="Status" value={drill.costing_status ?? "—"} />
                {warningsList(drill.warnings).length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mt-3 mb-1">Warnings</div>
                    <ul className="text-xs space-y-1 list-disc list-inside text-amber-700">
                      {warningsList(drill.warnings).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  );
}

function SummaryCard({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {label}
        {info && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{info}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </Card>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function DetailRow({
  label, value, mono, bold, extra,
}: { label: string; value: string; mono?: boolean; bold?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono text-xs" : ""} ${bold ? "font-semibold" : ""}`}>
        {value}{extra}
      </span>
    </div>
  );
}

function csvCell(v: any): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
