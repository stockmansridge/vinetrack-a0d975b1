// Cost Reports — aggregated Block × Variety cost breakdown.
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

interface GroupedRow {
  key: string;
  season_year: number | null;
  paddock_id: string | null;
  paddock_name: string | null;
  variety: string | null;          // resolved name, null if unresolved
  varietyResolved: boolean;
  allocation_area_ha: number;
  yield_tonnes: number;
  labour_cost: number;
  fuel_cost: number;
  chemical_cost: number;
  input_cost: number;
  total_cost: number;
  cost_per_ha: number | null;
  cost_per_tonne: number | null;
  trip_count: number;
  warnings_count: number;
  status: string | null;            // most-common / first non-null status
  trip_functions: string[];         // distinct functions present
  contributing: TripCostAllocation[];
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

  function resolveRowVariety(r: TripCostAllocation): string | null {
    const raw = (r.variety ?? "").toString().trim();
    if (raw && !/^unassigned/i.test(raw)) {
      if (UUID_RE.test(raw) && varietyMap.byId.has(raw)) return varietyMap.byId.get(raw)!;
      const ci = varietyMap.byNameLower.get(raw.toLowerCase());
      if (ci) return ci;
      if (!UUID_RE.test(raw)) return raw;
    }
    if (r.paddock_id) {
      const name = primaryVarietyName(paddockAllocsById.get(r.paddock_id), varietyMap);
      if (name) return name;
    }
    return null;
  }

  const [season, setSeason] = useState<string>(ANY);
  const [paddock, setPaddock] = useState<string>(ANY);
  const [variety, setVariety] = useState<string>(ANY);
  const [tripFn, setTripFn] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [drill, setDrill] = useState<GroupedRow | null>(null);

  // First filter raw rows by trip-function/status (which apply at allocation level),
  // then group by season × block × variety.
  const prefiltered = useMemo(() => {
    return rows.filter((r) => {
      if (tripFn !== ANY && (r.trip_function ?? "") !== tripFn) return false;
      if (status !== ANY && (r.costing_status ?? "") !== status) return false;
      return true;
    });
  }, [rows, tripFn, status]);

  const grouped: GroupedRow[] = useMemo(() => {
    const map = new Map<string, GroupedRow>();
    for (const r of prefiltered) {
      const resolvedVariety = resolveRowVariety(r);
      const pid = r.paddock_id ?? `name:${r.paddock_name ?? ""}`;
      const key = `${r.season_year ?? ""}|${pid}|${resolvedVariety ?? ""}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          season_year: r.season_year ?? null,
          paddock_id: r.paddock_id ?? null,
          paddock_name: r.paddock_name ?? null,
          variety: resolvedVariety,
          varietyResolved: !!resolvedVariety,
          allocation_area_ha: 0,
          yield_tonnes: 0,
          labour_cost: 0,
          fuel_cost: 0,
          chemical_cost: 0,
          input_cost: 0,
          total_cost: 0,
          cost_per_ha: null,
          cost_per_tonne: null,
          trip_count: 0,
          warnings_count: 0,
          status: null,
          trip_functions: [],
          contributing: [],
        };
        map.set(key, g);
      }
      g.allocation_area_ha += Number(r.allocation_area_ha ?? 0);
      g.yield_tonnes += Number(r.yield_tonnes ?? 0);
      g.labour_cost += Number(r.labour_cost ?? 0);
      g.fuel_cost += Number(r.fuel_cost ?? 0);
      g.chemical_cost += Number(r.chemical_cost ?? 0);
      g.input_cost += Number(r.input_cost ?? 0);
      g.total_cost += Number(r.total_cost ?? 0);
      g.warnings_count += warningsList(r.warnings).length;
      if (r.trip_id) g.trip_count += 1;
      if (!g.status && r.costing_status) g.status = r.costing_status;
      if (r.trip_function && !g.trip_functions.includes(r.trip_function)) {
        g.trip_functions.push(r.trip_function);
      }
      g.contributing.push(r);
    }
    for (const g of map.values()) {
      g.cost_per_ha = g.allocation_area_ha > 0 ? g.total_cost / g.allocation_area_ha : null;
      g.cost_per_tonne = g.yield_tonnes > 0 ? g.total_cost / g.yield_tonnes : null;
    }
    return Array.from(map.values()).sort((a, b) => {
      const sy = (b.season_year ?? 0) - (a.season_year ?? 0);
      if (sy !== 0) return sy;
      const pn = (a.paddock_name ?? "").localeCompare(b.paddock_name ?? "");
      if (pn !== 0) return pn;
      return (a.variety ?? "").localeCompare(b.variety ?? "");
    });
  }, [prefiltered, varietyMap, paddockAllocsById]);

  const seasons = useMemo(
    () => Array.from(new Set(grouped.map((g) => g.season_year).filter((v): v is number => v != null))).sort((a, b) => b - a),
    [grouped],
  );
  const paddocks = useMemo(
    () => Array.from(new Set(grouped.map((g) => g.paddock_name).filter((v): v is string => !!v))).sort(),
    [grouped],
  );
  const varieties = useMemo(
    () => Array.from(new Set(grouped.map((g) => g.variety).filter((v): v is string => !!v))).sort(),
    [grouped],
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
    return grouped.filter((g) => {
      if (season !== ANY && String(g.season_year ?? "") !== season) return false;
      if (paddock !== ANY && (g.paddock_name ?? "") !== paddock) return false;
      if (variety !== ANY && (g.variety ?? "") !== variety) return false;
      return true;
    });
  }, [grouped, season, paddock, variety]);

  const summary = useMemo(() => {
    let total = 0, area = 0, yieldT = 0, warns = 0, trips = 0;
    for (const g of filtered) {
      total += g.total_cost;
      area += g.allocation_area_ha;
      yieldT += g.yield_tonnes;
      warns += g.warnings_count;
      trips += g.trip_count;
    }
    return {
      total, area, yieldT, warns, tripCount: trips,
      costPerHa: area > 0 ? total / area : null,
      costPerTonne: yieldT > 0 ? total / yieldT : null,
    };
  }, [filtered]);

  const unassignedCount = useMemo(
    () => filtered.filter((g) => !g.varietyResolved).length,
    [filtered],
  );

  if (!canSeeCosts) return <NoAccessCard />;

  function exportCsv() {
    const headers = [
      "season","block","variety","treated_area_ha","yield_tonnes",
      "labour_cost","fuel_cost","chemical_cost","input_cost","total_cost",
      "cost_per_ha","cost_per_tonne","contributing_trips","warnings_count","status",
    ];
    const csv = [headers.join(",")].concat(
      filtered.map((g) => [
        g.season_year ?? "",
        csvCell(g.paddock_name),
        csvCell(g.variety ?? "Unassigned"),
        g.allocation_area_ha,
        g.yield_tonnes,
        g.labour_cost,
        g.fuel_cost,
        g.chemical_cost,
        g.input_cost,
        g.total_cost,
        g.cost_per_ha ?? "",
        g.cost_per_tonne ?? "",
        g.trip_count,
        g.warnings_count,
        csvCell(g.status),
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
  const showMissingBanner = canSeeCosts && (setupSummary.hasIssues || summary.warns > 0);

  return (
    <TooltipProvider delayDuration={150}>
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cost Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aggregated block × variety cost breakdown. Each row sums all
            contributing trip allocations for the season. Recalculations are
            currently performed in the iOS app.
          </p>
        </div>
        <Button onClick={exportCsv} variant="outline" size="sm" disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-2" />Export CSV
        </Button>
      </div>

      {selectedVineyardId && <CostingSetupWizard vineyardId={selectedVineyardId} />}

      {showMissingBanner && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some costing inputs are missing</AlertTitle>
          <AlertDescription>
            Complete the setup checklist above to improve cost/ha and cost/tonne accuracy.
            {summary.warns > 0 && (
              <> {summary.warns} allocation warning{summary.warns === 1 ? "" : "s"} were flagged in the data below.</>
            )}
          </AlertDescription>
        </Alert>
      )}

      {unassignedCount > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some cost rows may need recalculating</AlertTitle>
          <AlertDescription>
            {unassignedCount} grouped row{unassignedCount === 1 ? "" : "s"} could not resolve a
            variety. This usually means cost was calculated before block variety data was updated.
            Open Cost Reports in the iOS app and tap <strong>Recalculate Costs</strong> to refresh.
          </AlertDescription>
        </Alert>
      )}

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

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <FilterSelect label="Season" value={season} onChange={setSeason} options={seasons.map(String)} />
        <FilterSelect label="Block" value={paddock} onChange={setPaddock} options={paddocks} />
        <FilterSelect label="Variety" value={variety} onChange={setVariety} options={varieties} />
        <FilterSelect label="Function" value={tripFn} onChange={setTripFn} options={tripFns} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={statuses} />
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Season</TableHead>
              <TableHead>Block</TableHead>
              <TableHead>Variety</TableHead>
              <TableHead className="text-right">Treated area (ha)</TableHead>
              <TableHead className="text-right">Yield (t)</TableHead>
              <TableHead className="text-right">Labour</TableHead>
              <TableHead className="text-right">Fuel</TableHead>
              <TableHead className="text-right">Chemical</TableHead>
              <TableHead className="text-right">Seed/input</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Cost/ha</TableHead>
              <TableHead className="text-right">Cost/t</TableHead>
              <TableHead className="text-right">Trips</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground py-8">
                No cost allocations match these filters.
              </TableCell></TableRow>
            )}
            {filtered.map((g) => (
              <TableRow key={g.key} className="cursor-pointer" onClick={() => setDrill(g)}>
                <TableCell>{g.season_year ?? "—"}</TableCell>
                <TableCell className="max-w-[180px] truncate">{g.paddock_name ?? "—"}</TableCell>
                <TableCell>
                  {g.variety ? g.variety : (
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
                        <Link to="/setup/paddocks" className="underline">Block settings</Link>,
                        then recalculate costs from the iOS app.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell className="text-right">{fmtNum(g.allocation_area_ha)}</TableCell>
                <TableCell className="text-right">{fmtNum(g.yield_tonnes)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.labour_cost)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.fuel_cost)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.chemical_cost)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.input_cost)}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(g.total_cost)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.cost_per_ha)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.cost_per_tonne)}</TableCell>
                <TableCell className="text-right">{g.trip_count}</TableCell>
                <TableCell>
                  {g.status ? <Badge variant="outline">{g.status}</Badge> : "—"}
                </TableCell>
                <TableCell>
                  {g.warnings_count > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                      <AlertTriangle className="h-3 w-3" />{g.warnings_count}
                    </span>
                  ) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {drill && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {drill.paddock_name ?? "Block"}
                  {drill.variety ? ` · ${drill.variety}` : ""}
                </SheetTitle>
                <SheetDescription>
                  Season {drill.season_year ?? "—"} · {drill.trip_count} contributing trip{drill.trip_count === 1 ? "" : "s"}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-2 text-sm">
                <DetailRow label="Treated area" value={`${fmtNum(drill.allocation_area_ha)} ha`} />
                <DetailRow label="Yield" value={`${fmtNum(drill.yield_tonnes)} t`} />
                <DetailRow label="Labour" value={fmtMoney(drill.labour_cost)} />
                <DetailRow label="Fuel" value={fmtMoney(drill.fuel_cost)} />
                <DetailRow label="Chemical" value={fmtMoney(drill.chemical_cost)} />
                <DetailRow label="Seed / input" value={fmtMoney(drill.input_cost)} />
                <DetailRow label="Total" value={fmtMoney(drill.total_cost)} bold />
                <DetailRow label="Cost / ha" value={fmtMoney(drill.cost_per_ha)} />
                <DetailRow label="Cost / tonne" value={fmtMoney(drill.cost_per_tonne)} />
              </div>

              <div className="mt-6">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Contributing trip allocations
                </div>
                <div className="space-y-3">
                  {drill.contributing.map((r) => {
                    const warns = warningsList(r.warnings);
                    const stale = !!(r.calculated_at && r.trip_updated_at && r.trip_updated_at > r.calculated_at);
                    return (
                      <Card key={r.id} className="p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono text-[11px] truncate">{r.trip_id ?? "—"}</div>
                          {stale && <Badge variant="outline">Stale</Badge>}
                        </div>
                        <div className="text-muted-foreground">
                          {r.trip_function ?? "trip"} · {r.calculated_at ? new Date(r.calculated_at).toLocaleString() : "—"}
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
                          <DetailRow label="Area" value={`${fmtNum(r.allocation_area_ha)} ha`} small />
                          <DetailRow label="Total" value={fmtMoney(r.total_cost)} small bold />
                          <DetailRow label="Labour" value={fmtMoney(r.labour_cost)} small />
                          <DetailRow label="Fuel" value={fmtMoney(r.fuel_cost)} small />
                          <DetailRow label="Chemical" value={fmtMoney(r.chemical_cost)} small />
                          <DetailRow label="Input" value={fmtMoney(r.input_cost)} small />
                        </div>
                        {warns.length > 0 && (
                          <ul className="text-[11px] mt-1 space-y-0.5 list-disc list-inside text-amber-700">
                            {warns.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        )}
                      </Card>
                    );
                  })}
                </div>
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
  label, value, mono, bold, small,
}: { label: string; value: string; mono?: boolean; bold?: boolean; small?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${small ? "text-[11px]" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono text-xs" : ""} ${bold ? "font-semibold" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function csvCell(v: any): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
