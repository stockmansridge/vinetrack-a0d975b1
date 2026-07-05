// Cost Reports — multi-tab decision-support module.
// Owner/manager only. Reads from trip_cost_allocations (iOS Supabase),
// which is RLS-restricted to owner/manager. We additionally gate the
// query and the entire page behind useCanSeeCosts().
import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Download, AlertTriangle, Info, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RTooltip, LabelList,
} from "recharts";

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
import FuelAllocationPanel from "@/components/cost/FuelAllocationPanel";
import { tripFunctionLabel } from "@/lib/tripFunctionLabels";

import { Card } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

const ANY = "__any__";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HA_PER_AC = 0.40468564224;

// Chart palette drawn from theme tokens (see index.css).
const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--chart-3, 210 70% 50%))",
  "hsl(var(--chart-4, 30 80% 55%))",
  "hsl(var(--chart-5, 340 70% 55%))",
  "hsl(var(--muted-foreground))",
];

function makeFmtMoney(rf: RegionFormatters) {
  return (v: number | null | undefined): string =>
    v == null || !isFinite(v) ? "—" : rf.currency(v, 0);
}
function makeFmtArea(rf: RegionFormatters) {
  return (haValue: number | null | undefined, dp = 2): string =>
    haValue == null || !isFinite(haValue) ? "—" : rf.area(haValue, dp);
}
function makeFmtCostPerArea(rf: RegionFormatters) {
  const imperial = rf.areaUnitLabel === "ac";
  return (perHa: number | null | undefined): string => {
    if (perHa == null || !isFinite(perHa)) return "—";
    const v = imperial ? perHa * HA_PER_AC : perHa;
    return `${rf.currency(v, 0)} / ${rf.areaUnitLabel}`;
  };
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

function topNWithOther<T extends { name: string; value: number }>(
  items: T[], n: number,
): (T & { other?: boolean })[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  if (sorted.length <= n) return sorted;
  const top = sorted.slice(0, n) as (T & { other?: boolean })[];
  const rest = sorted.slice(n);
  const otherValue = rest.reduce((s, x) => s + x.value, 0);
  top.push({ name: `Other (${rest.length})`, value: otherValue, other: true } as any);
  return top;
}

function categorizeWarning(w: string): string {
  const s = w.toLowerCase();
  if (s.includes("labour") || s.includes("labor")) return "Missing labour rate";
  if (s.includes("fuel")) return "Missing fuel rate";
  if (s.includes("chemical") || s.includes("input")) return "Missing chemical/input cost";
  if (s.includes("yield")) return "Missing yield";
  if (s.includes("area")) return "Missing treated area";
  return "Partial costing data";
}

interface GroupedRow {
  key: string;
  season_year: number | null;
  paddock_id: string | null;
  paddock_name: string | null;
  variety: string | null;
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
  status: string | null;
  trip_functions: string[];
  contributing: TripCostAllocation[];
}

function NoAccessCard() {
  return (
    <div className="p-6 w-full">
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
  const rf = useRegionFormatters();
  const fmtMoney = useMemo(() => makeFmtMoney(rf), [rf]);
  const fmtArea = useMemo(() => makeFmtArea(rf), [rf]);
  const fmtMoneyPerArea = useMemo(() => makeFmtCostPerArea(rf), [rf]);

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

  const [tab, setTab] = useState<string>("overview");
  const [season, setSeason] = useState<string>(ANY);
  const [paddock, setPaddock] = useState<string>(ANY);
  const [variety, setVariety] = useState<string>(ANY);
  const [tripFn, setTripFn] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [drill, setDrill] = useState<GroupedRow | null>(null);
  const [warningDrill, setWarningDrill] = useState<
    { type: string; records: TripCostAllocation[] } | null
  >(null);

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

  // Flat list of raw allocations behind the currently-filtered groups —
  // used for function/trend/warning aggregations.
  const filteredRaw = useMemo(
    () => filtered.flatMap((g) => g.contributing),
    [filtered],
  );

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

  // ------- aggregations for charts / per-dimension tables --------
  const byBlock = useMemo(() => {
    const map = new Map<string, {
      name: string; total: number; area: number; yieldT: number;
      trips: number; warnings: number;
    }>();
    for (const g of filtered) {
      const k = g.paddock_name ?? "—";
      let b = map.get(k);
      if (!b) { b = { name: k, total: 0, area: 0, yieldT: 0, trips: 0, warnings: 0 }; map.set(k, b); }
      b.total += g.total_cost;
      b.area += g.allocation_area_ha;
      b.yieldT += g.yield_tonnes;
      b.trips += g.trip_count;
      b.warnings += g.warnings_count;
    }
    return Array.from(map.values()).map((b) => ({
      ...b,
      costPerHa: b.area > 0 ? b.total / b.area : null,
      costPerT: b.yieldT > 0 ? b.total / b.yieldT : null,
    }));
  }, [filtered]);

  const byVariety = useMemo(() => {
    const map = new Map<string, {
      name: string; total: number; area: number; yieldT: number; trips: number;
    }>();
    for (const g of filtered) {
      const k = g.variety ?? "Unassigned";
      let b = map.get(k);
      if (!b) { b = { name: k, total: 0, area: 0, yieldT: 0, trips: 0 }; map.set(k, b); }
      b.total += g.total_cost;
      b.area += g.allocation_area_ha;
      b.yieldT += g.yield_tonnes;
      b.trips += g.trip_count;
    }
    return Array.from(map.values()).map((b) => ({
      ...b,
      costPerHa: b.area > 0 ? b.total / b.area : null,
      costPerT: b.yieldT > 0 ? b.total / b.yieldT : null,
    }));
  }, [filtered]);

  const byFunction = useMemo(() => {
    const map = new Map<string, {
      fn: string; label: string; total: number; warnings: number; tripSet: Set<string>;
    }>();
    for (const r of filteredRaw) {
      const fn = r.trip_function ?? "unknown";
      let b = map.get(fn);
      if (!b) {
        b = { fn, label: tripFunctionLabel(fn) ?? fn, total: 0, warnings: 0, tripSet: new Set() };
        map.set(fn, b);
      }
      b.total += Number(r.total_cost ?? 0);
      b.warnings += warningsList(r.warnings).length;
      if (r.trip_id) b.tripSet.add(r.trip_id);
    }
    return Array.from(map.values())
      .map((b) => ({ fn: b.fn, label: b.label, total: b.total, warnings: b.warnings, trips: b.tripSet.size }))
      .sort((a, b) => b.total - a.total);
  }, [filteredRaw]);

  const categoryTotals = useMemo(() => {
    let labour = 0, fuel = 0, chemical = 0, input = 0;
    for (const g of filtered) {
      labour += g.labour_cost; fuel += g.fuel_cost;
      chemical += g.chemical_cost; input += g.input_cost;
    }
    const list = [
      { name: "Labour", value: labour },
      { name: "Fuel", value: fuel },
      { name: "Chemical", value: chemical },
      { name: "Seed / input", value: input },
    ].filter((c) => c.value > 0);
    return list;
  }, [filtered]);

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredRaw) {
      const iso = r.calculated_at ?? r.created_at ?? null;
      if (!iso) continue;
      const d = new Date(iso);
      if (isNaN(d.getTime())) continue;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(k, (map.get(k) ?? 0) + Number(r.total_cost ?? 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cost]) => ({ month, cost }));
  }, [filteredRaw]);

  const warningsByType = useMemo(() => {
    const map = new Map<string, {
      type: string; count: number; records: TripCostAllocation[]; seen: Set<string>;
    }>();
    for (const r of filteredRaw) {
      for (const w of warningsList(r.warnings)) {
        const type = categorizeWarning(w);
        let b = map.get(type);
        if (!b) { b = { type, count: 0, records: [], seen: new Set() }; map.set(type, b); }
        b.count += 1;
        if (!b.seen.has(r.id)) { b.seen.add(r.id); b.records.push(r); }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filteredRaw]);

  // ------- Data table wiring (unchanged behaviour) --------
  const COST_COLS = ["season","block","variety","area","yield","labour","fuel","chemical","input","total","cost_ha","cost_t","trips","status","warnings"] as const;
  type CostCol = (typeof COST_COLS)[number];
  const { order: cOrder, moveColumn: cMove, reset: cReset } = useColumnOrder(
    "cost_reports_table",
    COST_COLS as unknown as string[],
    { vineyardId: selectedVineyardId },
  );
  const { sorted: filteredSorted, getSortDirection: cDir, toggleSort: cToggle } = useSortableTable<typeof filtered[number], CostCol>(filtered, {
    accessors: {
      season: (g) => g.season_year ?? null,
      block: (g) => g.paddock_name ?? "",
      variety: (g) => g.variety ?? "",
      area: (g) => g.allocation_area_ha,
      yield: (g) => g.yield_tonnes,
      labour: (g) => g.labour_cost,
      fuel: (g) => g.fuel_cost,
      chemical: (g) => g.chemical_cost,
      input: (g) => g.input_cost,
      total: (g) => g.total_cost,
      cost_ha: (g) => g.cost_per_ha,
      cost_t: (g) => g.cost_per_tonne,
      trips: (g) => g.trip_count,
      status: (g) => g.status ?? "",
      warnings: (g) => g.warnings_count,
    },
  });

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

  // Drill actions: set filter + jump to the appropriate tab.
  function drillToTable(patch: { paddock?: string; variety?: string; tripFn?: string }) {
    if (patch.paddock !== undefined) setPaddock(patch.paddock);
    if (patch.variety !== undefined) setVariety(patch.variety);
    if (patch.tripFn !== undefined) setTripFn(patch.tripFn);
    setTab("table");
  }

  const topBlocksByCostPerHa = topNWithOther(
    byBlock
      .filter((b) => b.costPerHa != null)
      .map((b) => ({ name: b.name, value: b.costPerHa as number, total: b.total, trips: b.trips, warnings: b.warnings })),
    10,
  );
  const topBlocksByTotal = topNWithOther(
    byBlock.map((b) => ({ name: b.name, value: b.total, costPerHa: b.costPerHa, trips: b.trips, warnings: b.warnings })),
    10,
  );
  const topVarietyByCostPerHa = topNWithOther(
    byVariety
      .filter((v) => v.costPerHa != null)
      .map((v) => ({ name: v.name, value: v.costPerHa as number, total: v.total, trips: v.trips })),
    10,
  );
  const topVarietyByCostPerT = topNWithOther(
    byVariety
      .filter((v) => v.costPerT != null)
      .map((v) => ({ name: v.name, value: v.costPerT as number, total: v.total, yieldT: v.yieldT })),
    10,
  );
  const functionChartData = topNWithOther(
    byFunction.map((f) => ({ name: f.label, value: f.total, fn: f.fn, trips: f.trips, warnings: f.warnings })),
    10,
  );

  return (
    <TooltipProvider delayDuration={150}>
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cost Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Decision-support view of trip cost allocations. Filters apply
            across every tab.
          </p>
        </div>
      </div>

      {selectedVineyardId && <CostingSetupWizard vineyardId={selectedVineyardId} />}

      {showMissingBanner && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some costing inputs are missing</AlertTitle>
          <AlertDescription>
            Complete the setup checklist above to improve cost/ha and cost/tonne accuracy.
            {summary.warns > 0 && (
              <> {summary.warns} allocation warning{summary.warns === 1 ? "" : "s"} were flagged — see the Warnings tab.</>
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
            variety. Open Cost Reports in the iOS app and tap{" "}
            <strong>Recalculate Costs</strong> to refresh.
          </AlertDescription>
        </Alert>
      )}

      {/* Global filter bar — applies to every tab */}
      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <FilterSelect label="Season" value={season} onChange={setSeason} options={seasons.map(String)} />
        <FilterSelect label={rf.blockLabel} value={paddock} onChange={setPaddock} options={paddocks} />
        <FilterSelect label="Variety" value={variety} onChange={setVariety} options={varieties} />
        <FilterSelect label="Function" value={tripFn} onChange={setTripFn} options={tripFns} renderLabel={(v) => tripFunctionLabel(v) ?? v} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={statuses} />
        {(season !== ANY || paddock !== ANY || variety !== ANY || tripFn !== ANY || status !== ANY) && (
          <Button
            variant="ghost" size="sm"
            onClick={() => { setSeason(ANY); setPaddock(ANY); setVariety(ANY); setTripFn(ANY); setStatus(ANY); }}
          >
            Clear filters
          </Button>
        )}
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="blocks">{rf.blockLabel}s</TabsTrigger>
          <TabsTrigger value="varieties">Varieties</TabsTrigger>
          <TabsTrigger value="functions">Functions</TabsTrigger>
          <TabsTrigger value="equipment">Equipment &amp; Fuel</TabsTrigger>
          <TabsTrigger value="warnings">
            Warnings
            {summary.warns > 0 && (
              <Badge variant="outline" className="ml-2 text-amber-700 border-amber-400">
                {summary.warns}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="table">Data table</TabsTrigger>
        </TabsList>

        {/* ------------------ OVERVIEW ------------------ */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <SummaryCard label="Total cost" value={fmtMoney(summary.total)} />
            <SummaryCard
              label="Treated area"
              value={fmtArea(summary.area)}
              info={`Accumulated mapped ${rf.blockLabel.toLowerCase()} area from included jobs/trips. A block treated N times contributes N times.`}
            />
            <SummaryCard
              label={`Cost / ${rf.areaUnitLabel}`}
              value={fmtMoneyPerArea(summary.costPerHa)}
              info="Total cost divided by cumulative treated area."
            />
            <SummaryCard label="Yield" value={`${fmtNum(summary.yieldT)} t`} />
            <SummaryCard label="Cost / tonne" value={fmtMoney(summary.costPerTonne)} />
            <SummaryCard label="Trips" value={String(summary.tripCount)} />
            <SummaryCard label="Warnings" value={String(summary.warns)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard
              title="Monthly cost trend"
              subtitle="Based on when each allocation was calculated"
              empty={monthlyTrend.length === 0 ? "No dated allocations yet — costs will chart here once trips are calculated." : null}
            >
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={monthlyTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => rf.currency(v, 0)} width={70} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: any) => fmtMoney(Number(v))}
                  />
                  <Line type="monotone" dataKey="cost" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Cost by function"
              subtitle="Click a bar to drill into those records"
              empty={functionChartData.length === 0 ? "No function-tagged allocations in this filter." : null}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={functionChartData} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => rf.currency(v, 0)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: any, _n, p: any) => [
                      fmtMoney(Number(v)),
                      p?.payload?.trips != null ? `${p.payload.trips} trip${p.payload.trips === 1 ? "" : "s"}` : "cost",
                    ]}
                  />
                  <Bar dataKey="value" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]}
                    onClick={(d: any) => { if (d?.fn) drillToTable({ tripFn: d.fn }); }}
                    style={{ cursor: "pointer" }} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Cost split by category"
              subtitle="Labour · Fuel · Chemical · Input"
              empty={categoryTotals.length === 0 ? "No cost data yet." : null}
            >
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: any) => fmtMoney(Number(v))}
                  />
                  <Pie data={categoryTotals} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {categoryTotals.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 text-xs">
                {categoryTotals.map((c, i) => (
                  <span key={c.name} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    {c.name} · <span className="font-medium">{fmtMoney(c.value)}</span>
                  </span>
                ))}
              </div>
            </ChartCard>

            <ChartCard
              title={`Highest cost ${rf.blockLabel.toLowerCase()}s (cost / ${rf.areaUnitLabel})`}
              subtitle="Top 10 shown — click to drill in"
              empty={topBlocksByCostPerHa.length === 0 ? `No ${rf.blockLabel.toLowerCase()} cost data yet.` : null}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topBlocksByCostPerHa} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => rf.currency(v, 0)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: any, _n, p: any) => [
                      fmtMoneyPerArea(Number(v)),
                      `total ${fmtMoney(p?.payload?.total)} · ${p?.payload?.trips ?? 0} trips · ${p?.payload?.warnings ?? 0} warnings`,
                    ]}
                  />
                  <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]}
                    onClick={(d: any) => { if (d?.name && !d?.other) drillToTable({ paddock: d.name }); }}
                    style={{ cursor: "pointer" }} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </TabsContent>

        {/* ------------------ BLOCKS ------------------ */}
        <TabsContent value="blocks" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title={`Cost / ${rf.areaUnitLabel} by ${rf.blockLabel.toLowerCase()}`} subtitle="Top 10">
              <HBar data={topBlocksByCostPerHa} valueFmt={(v) => fmtMoneyPerArea(v)}
                onClickBar={(d) => !d.other && drillToTable({ paddock: d.name })} />
            </ChartCard>
            <ChartCard title={`Total cost by ${rf.blockLabel.toLowerCase()}`} subtitle="Top 10">
              <HBar data={topBlocksByTotal} valueFmt={(v) => fmtMoney(v)}
                onClickBar={(d) => !d.other && drillToTable({ paddock: d.name })} />
            </ChartCard>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{rf.blockLabel}</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Area ({rf.areaUnitLabel})</TableHead>
                  <TableHead className="text-right">Cost/{rf.areaUnitLabel}</TableHead>
                  <TableHead className="text-right">Yield (t)</TableHead>
                  <TableHead className="text-right">Cost/t</TableHead>
                  <TableHead className="text-right">Trips</TableHead>
                  <TableHead className="text-right">Warnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byBlock.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No {rf.blockLabel.toLowerCase()} data for these filters.
                  </TableCell></TableRow>
                )}
                {byBlock.sort((a, b) => b.total - a.total).map((b) => (
                  <TableRow key={b.name} className="cursor-pointer" onClick={() => drillToTable({ paddock: b.name })}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-right">{fmtMoney(b.total)}</TableCell>
                    <TableCell className="text-right">{fmtArea(b.area)}</TableCell>
                    <TableCell className="text-right">{fmtMoneyPerArea(b.costPerHa)}</TableCell>
                    <TableCell className="text-right">{fmtNum(b.yieldT)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(b.costPerT)}</TableCell>
                    <TableCell className="text-right">{b.trips}</TableCell>
                    <TableCell className="text-right">
                      {b.warnings > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />{b.warnings}
                        </span>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ------------------ VARIETIES ------------------ */}
        <TabsContent value="varieties" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title={`Cost / ${rf.areaUnitLabel} by variety`} subtitle="Top 10">
              <HBar data={topVarietyByCostPerHa} valueFmt={(v) => fmtMoneyPerArea(v)}
                onClickBar={(d) => !d.other && drillToTable({ variety: d.name })} />
            </ChartCard>
            <ChartCard title="Cost / tonne by variety"
              subtitle="Only varieties with yield data"
              empty={topVarietyByCostPerT.length === 0 ? "No yield data recorded for these filters." : null}>
              <HBar data={topVarietyByCostPerT} valueFmt={(v) => fmtMoney(v)}
                onClickBar={(d) => !d.other && drillToTable({ variety: d.name })} />
            </ChartCard>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variety</TableHead>
                  <TableHead className="text-right">Treated area</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Cost/{rf.areaUnitLabel}</TableHead>
                  <TableHead className="text-right">Yield (t)</TableHead>
                  <TableHead className="text-right">Cost/t</TableHead>
                  <TableHead className="text-right">Trips</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byVariety.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No variety data for these filters.
                  </TableCell></TableRow>
                )}
                {byVariety.sort((a, b) => b.total - a.total).map((v) => (
                  <TableRow key={v.name} className="cursor-pointer" onClick={() => drillToTable({ variety: v.name })}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell className="text-right">{fmtArea(v.area)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(v.total)}</TableCell>
                    <TableCell className="text-right">{fmtMoneyPerArea(v.costPerHa)}</TableCell>
                    <TableCell className="text-right">{fmtNum(v.yieldT)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(v.costPerT)}</TableCell>
                    <TableCell className="text-right">{v.trips}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ------------------ FUNCTIONS ------------------ */}
        <TabsContent value="functions" className="space-y-6">
          <ChartCard title="Cost by operation / function"
            subtitle="Includes Spray, Maintenance, Seeding/Cover Crop, Fuel, Irrigation, Repairs and Work Tasks where present. Click to drill in."
            empty={functionChartData.length === 0 ? "No function-tagged allocations." : null}>
            <HBar data={functionChartData} valueFmt={(v) => fmtMoney(v)}
              onClickBar={(d: any) => d.fn && drillToTable({ tripFn: d.fn })} />
          </ChartCard>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Function</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Trips</TableHead>
                  <TableHead className="text-right">Warnings</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {byFunction.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No function-tagged allocations.
                  </TableCell></TableRow>
                )}
                {byFunction.map((f) => (
                  <TableRow key={f.fn} className="cursor-pointer" onClick={() => drillToTable({ tripFn: f.fn })}>
                    <TableCell className="font-medium">{f.label}</TableCell>
                    <TableCell className="text-right">{fmtMoney(f.total)}</TableCell>
                    <TableCell className="text-right">{f.trips}</TableCell>
                    <TableCell className="text-right">
                      {f.warnings > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />{f.warnings}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">View records →</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ------------------ EQUIPMENT & FUEL ------------------ */}
        <TabsContent value="equipment" className="space-y-6">
          <Card className="p-4 flex items-start gap-3">
            <BarChart3 className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Fuel breakdown by tractor, function, {rf.blockLabel.toLowerCase()} or operator.
              Records missing engine-hour or fuel-rate data are surfaced inline
              in the table below and exportable via CSV.
            </div>
          </Card>
          {selectedVineyardId && <FuelAllocationPanel vineyardId={selectedVineyardId} />}
        </TabsContent>

        {/* ------------------ WARNINGS ------------------ */}
        <TabsContent value="warnings" className="space-y-4">
          {warningsByType.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No warnings flagged on the currently-filtered allocations. Complete
              the setup checklist above if cost/ha or cost/tonne look off.
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {warningsByType.map((w) => (
                <Card
                  key={w.type}
                  className="p-4 flex items-start justify-between gap-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => setWarningDrill({ type: w.type, records: w.records })}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <div className="font-medium">{w.type}</div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {w.count} warning{w.count === 1 ? "" : "s"} across{" "}
                      {w.records.length} allocation{w.records.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Badge variant="outline">View →</Badge>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ------------------ DATA TABLE ------------------ */}
        <TabsContent value="table" className="space-y-3">
          <div className="flex justify-end gap-2">
            <ColumnSettingsMenu onReset={cReset} />
            <Button onClick={exportCsv} variant="outline" size="sm" disabled={filtered.length === 0}>
              <Download className="h-4 w-4 mr-2" />Export CSV
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  {(cOrder as CostCol[]).map((id) => {
                    const labels: Record<CostCol, string> = {
                      season: "Season", block: rf.blockLabel, variety: "Variety",
                      area: `Treated area (${rf.areaUnitLabel})`, yield: "Yield (t)",
                      labour: "Labour", fuel: "Fuel", chemical: "Chemical", input: "Seed/input",
                      total: "Total", cost_ha: `Cost/${rf.areaUnitLabel}`, cost_t: "Cost/t",
                      trips: "Trips", status: "Status", warnings: "Warnings",
                    };
                    const rightCols = new Set<CostCol>(["area","yield","labour","fuel","chemical","input","total","cost_ha","cost_t","trips"]);
                    const align: "left" | "right" = rightCols.has(id) ? "right" : "left";
                    return (
                      <ReorderableHead key={id} columnId={id} onDropColumn={cMove} align={align}
                        sort={{ active: cDir(id), onSort: () => cToggle(id) }}>
                        {labels[id]}
                      </ReorderableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                )}
                {!isLoading && filteredSorted.length === 0 && (
                  <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground py-8">
                    No cost allocations match these filters.
                  </TableCell></TableRow>
                )}
                {filteredSorted.map((g) => {
                  const cellMap: Record<CostCol, React.ReactNode> = {
                    season: <TableCell>{g.season_year ?? "—"}</TableCell>,
                    block: <TableCell className="max-w-[180px] truncate">{g.paddock_name ?? "—"}</TableCell>,
                    variety: (
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
                              This block has no variety allocation, or it could
                              not be matched. Fix it in{" "}
                              <Link to="/setup/paddocks" className="underline">Block settings</Link>{" "}
                              and recalculate.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    ),
                    area: <TableCell className="text-right">{fmtArea(g.allocation_area_ha)}</TableCell>,
                    yield: <TableCell className="text-right">{fmtNum(g.yield_tonnes)}</TableCell>,
                    labour: <TableCell className="text-right">{fmtMoney(g.labour_cost)}</TableCell>,
                    fuel: <TableCell className="text-right">{fmtMoney(g.fuel_cost)}</TableCell>,
                    chemical: <TableCell className="text-right">{fmtMoney(g.chemical_cost)}</TableCell>,
                    input: <TableCell className="text-right">{fmtMoney(g.input_cost)}</TableCell>,
                    total: <TableCell className="text-right font-medium">{fmtMoney(g.total_cost)}</TableCell>,
                    cost_ha: <TableCell className="text-right">{fmtMoneyPerArea(g.cost_per_ha)}</TableCell>,
                    cost_t: <TableCell className="text-right">{fmtMoney(g.cost_per_tonne)}</TableCell>,
                    trips: <TableCell className="text-right">{g.trip_count}</TableCell>,
                    status: <TableCell>{g.status ? <Badge variant="outline">{g.status}</Badge> : "—"}</TableCell>,
                    warnings: (
                      <TableCell>
                        {g.warnings_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                            <AlertTriangle className="h-3 w-3" />{g.warnings_count}
                          </span>
                        ) : "—"}
                      </TableCell>
                    ),
                  };
                  return (
                    <TableRow key={g.key} className="cursor-pointer" onClick={() => setDrill(g)}>
                      {(cOrder as CostCol[]).map((id) => <Fragment key={id}>{cellMap[id]}</Fragment>)}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Row drill sheet (unchanged) */}
      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {drill && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {drill.paddock_name ?? rf.blockLabel}
                  {drill.variety ? ` · ${drill.variety}` : ""}
                </SheetTitle>
                <SheetDescription>
                  Season {drill.season_year ?? "—"} · {drill.trip_count} contributing trip{drill.trip_count === 1 ? "" : "s"}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-2 text-sm">
                <DetailRow label="Treated area" value={fmtArea(drill.allocation_area_ha)} />
                <DetailRow label="Yield" value={`${fmtNum(drill.yield_tonnes)} t`} />
                <DetailRow label="Labour" value={fmtMoney(drill.labour_cost)} />
                <DetailRow label="Fuel" value={fmtMoney(drill.fuel_cost)} />
                <DetailRow label="Chemical" value={fmtMoney(drill.chemical_cost)} />
                <DetailRow label="Seed / input" value={fmtMoney(drill.input_cost)} />
                <DetailRow label="Total" value={fmtMoney(drill.total_cost)} bold />
                <DetailRow label={`Cost / ${rf.areaUnitLabel}`} value={fmtMoneyPerArea(drill.cost_per_ha)} />
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
                          {tripFunctionLabel(r.trip_function) ?? "trip"} · {r.calculated_at ? rf.dateTime(r.calculated_at) : "—"}
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
                          <DetailRow label="Area" value={fmtArea(r.allocation_area_ha)} small />
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

      {/* Warning-type drill sheet */}
      <Sheet open={!!warningDrill} onOpenChange={(o) => !o && setWarningDrill(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {warningDrill && (
            <>
              <SheetHeader>
                <SheetTitle>{warningDrill.type}</SheetTitle>
                <SheetDescription>
                  {warningDrill.records.length} affected allocation{warningDrill.records.length === 1 ? "" : "s"}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3">
                {warningDrill.records.map((r) => {
                  const warns = warningsList(r.warnings);
                  return (
                    <Card key={r.id} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">
                          {r.paddock_name ?? "—"}
                          {r.variety ? ` · ${r.variety}` : ""}
                        </div>
                        <Badge variant="outline">{tripFunctionLabel(r.trip_function ?? "") ?? "—"}</Badge>
                      </div>
                      <div className="text-muted-foreground">
                        Season {r.season_year ?? "—"} · total {fmtMoney(Number(r.total_cost ?? 0))}
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
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  );
}

// ---------- small presentational helpers ----------

function ChartCard({
  title, subtitle, empty, children,
}: { title: string; subtitle?: string; empty?: string | null; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-medium">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
      </div>
      {empty ? (
        <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground text-center px-6">
          {empty}
        </div>
      ) : children}
    </Card>
  );
}

function HBar({
  data, valueFmt, onClickBar,
}: {
  data: Array<{ name: string; value: number; other?: boolean } & Record<string, any>>;
  valueFmt: (v: number) => string;
  onClickBar?: (d: any) => void;
}) {
  if (data.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        No data.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 28 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => valueFmt(Number(v))} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
        <RTooltip
          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
          formatter={(v: any) => valueFmt(Number(v))}
        />
        <Bar
          dataKey="value"
          fill={CHART_COLORS[0]}
          radius={[0, 4, 4, 0]}
          onClick={(d: any) => onClickBar?.(d)}
          style={{ cursor: onClickBar ? "pointer" : "default" }}
        >
          <LabelList dataKey="value" position="right" formatter={(v: any) => valueFmt(Number(v))}
            style={{ fill: "hsl(var(--foreground))", fontSize: 10 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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
  label, value, onChange, options, renderLabel,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; renderLabel?: (v: string) => string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{renderLabel ? renderLabel(o) : o}</SelectItem>)}
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
