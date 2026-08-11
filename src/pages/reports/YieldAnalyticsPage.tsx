// Yield Analytics — chart-driven production analytics for the portal.
//
// Frontend-only: consumes the existing production contract (historical yield
// records, picking_yield_totals, paddocks, unified cost dataset). No schema,
// RPC or view changes.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  Info,
  RotateCcw,
  Search,
  Settings2,
} from "lucide-react";

import { PageHead } from "@/components/PageHead";
import { useVineyard } from "@/context/VineyardContext";
import { useCanSeeCosts } from "@/lib/permissions";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { PortalNotice } from "@/components/ui/PortalNotice";
import MultiSelect from "@/components/yield/analytics/MultiSelect";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { extractHistoricalBlockRows, fetchYieldBlocks, fetchYieldReportsForVineyard } from "@/lib/yieldReportsQuery";
import { fetchPickingYieldTotals } from "@/lib/pickingRecordsQuery";
import { fetchTripCostAllocationsForVineyard } from "@/lib/tripCostAllocationsQuery";
import { usePruningActivity } from "@/lib/pruningActivityQuery";
import { buildUnifiedCostDataset } from "@/lib/unifiedCostDataset";
import {
  aggregate,
  buildYieldFacts,
  byBlock,
  byVariety,
  distinctVarieties,
  groupBy,
  pctChange,
  threeYearTrend,
  type GroupedMetrics,
  type MetricKey,
  type YieldFact,
} from "@/lib/yieldAnalytics";
import { downloadYieldAnalyticsCsv, downloadYieldAnalyticsXlsx } from "@/lib/yieldAnalyticsExport";

const HA_PER_AC = 0.40468564224;
const ALL = "__all__";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--chart-3, 210 70% 50%))",
  "hsl(var(--chart-4, 30 80% 55%))",
  "hsl(var(--chart-5, 340 70% 55%))",
  "hsl(var(--chart-6, 265 60% 60%))",
  "hsl(var(--muted-foreground))",
];

const colourFor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
const num = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp });

interface MetricOption {
  key: MetricKey;
  label: string;
  kind: "tonnes" | "rate" | "money" | "moneyPerArea";
  costOnly?: boolean;
}

const METRICS: MetricOption[] = [
  { key: "tonnes", label: "Total tonnes", kind: "tonnes" },
  { key: "tonnesPerHa", label: "Tonnes / area", kind: "rate" },
  { key: "pricePerTonne", label: "Average sale $ / tonne", kind: "money" },
  { key: "revenue", label: "Grape revenue", kind: "money" },
  { key: "revenuePerHa", label: "Grape revenue / sold area", kind: "moneyPerArea" },
  { key: "costPerHa", label: "Cost / area", kind: "moneyPerArea", costOnly: true },
  { key: "costPerTonne", label: "Cost / tonne", kind: "money", costOnly: true },
  { key: "marginPerHa", label: "Grape-sale margin / sold area", kind: "moneyPerArea", costOnly: true },
];


export default function YieldAnalyticsPage() {
  const { selectedVineyardId } = useVineyard();
  const rf = useRegionFormatters();
  const canSeeCosts = useCanSeeCosts();
  const imperial = rf.areaUnitLabel === "ac";

  // --- unit-aware formatters -------------------------------------------------
  const perArea = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : num(imperial ? v * HA_PER_AC : v);
  const areaFmt = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : `${num(imperial ? v / HA_PER_AC : v)} ${rf.areaUnitLabel}`;
  const money = (v: number | null | undefined, dp = 0) =>
    v == null || !Number.isFinite(v) ? "—" : rf.currency(v, dp);
  const moneyPerArea = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : `${rf.currency(imperial ? v * HA_PER_AC : v, 0)}/${rf.areaUnitLabel}`;

  const formatMetric = (m: MetricOption, v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return "—";
    switch (m.kind) {
      case "tonnes":
        return `${num(v)} t`;
      case "rate":
        return `${perArea(v)} t/${rf.areaUnitLabel}`;
      case "money":
        return money(v);
      case "moneyPerArea":
        return moneyPerArea(v);
    }
  };
  const metricAxisValue = (m: MetricOption, v: number | null) =>
    v == null ? null : m.kind === "rate" || m.kind === "moneyPerArea" ? (imperial ? v * HA_PER_AC : v) : v;

  // --- data ------------------------------------------------------------------
  const reportsQ = useQuery({
    queryKey: ["yield_reports", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldReportsForVineyard(selectedVineyardId!),
  });
  const blocksQ = useQuery({
    queryKey: ["yield", "blocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchYieldBlocks(selectedVineyardId!),
  });
  const pickingQ = useQuery({
    queryKey: ["picking_yield_totals", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchPickingYieldTotals(selectedVineyardId!),
  });
  const tripCostQ = useQuery({
    queryKey: ["trip_cost_allocations", selectedVineyardId],
    enabled: !!selectedVineyardId && canSeeCosts,
    queryFn: () => fetchTripCostAllocationsForVineyard(selectedVineyardId!),
  });
  const pruningQ = usePruningActivity(canSeeCosts ? selectedVineyardId : null);

  const isLoading = reportsQ.isLoading || blocksQ.isLoading || pickingQ.isLoading;
  const error = (reportsQ.error ?? blocksQ.error ?? pickingQ.error) as Error | null;

  const costRows = useMemo(() => {
    if (!canSeeCosts || !selectedVineyardId) return [];
    const ds = buildUnifiedCostDataset({
      vineyardId: selectedVineyardId,
      tripAllocations: tripCostQ.data ?? [],
      pruningRows: pruningQ.data ?? [],
    });
    return ds.rows.map((r) => ({
      vintage_year: r.vintage_year,
      block_id: r.block_id,
      variety: r.variety,
      total_cost: r.total_cost,
    }));
  }, [canSeeCosts, selectedVineyardId, tripCostQ.data, pruningQ.data]);

  const allFacts = useMemo(
    () =>
      buildYieldFacts({
        historicalRows: extractHistoricalBlockRows(reportsQ.data?.historical ?? []),
        pickingTotals: pickingQ.data ?? [],
        blocks: (blocksQ.data ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          areaHa: b.areaHa,
          varietyAllocations: b.varietyAllocations,
        })),

        costRows,
      }),
    [reportsQ.data?.historical, pickingQ.data, blocksQ.data, costRows],
  );

  const costAvailable = canSeeCosts && allFacts.some((f) => f.cost != null && f.cost > 0);
  const metricOptions = METRICS.filter((m) => !m.costOnly || costAvailable);

  // --- filters ---------------------------------------------------------------
  const vintages = useMemo(
    () =>
      Array.from(new Set(allFacts.map((f) => f.vintage).filter((v): v is number => v != null))).sort(
        (a, b) => b - a,
      ),
    [allFacts],
  );
  const latestVintage = vintages[0] ?? null;

  const [vintageMode, setVintageMode] = useState<"single" | "range">("single");
  const [vintage, setVintage] = useState<string>(ALL);
  const [rangeFrom, setRangeFrom] = useState<string>(ALL);
  const [rangeTo, setRangeTo] = useState<string>(ALL);
  const [varietyFilter, setVarietyFilter] = useState<string[]>([]);
  const [blockFilter, setBlockFilter] = useState<string[]>([]);

  const effectiveVintage = vintage === ALL ? latestVintage : Number(vintage);

  const varietyOptions = useMemo(
    () =>
      Array.from(new Set(allFacts.map((f) => f.variety?.trim() || "Unspecified")))
        .sort()
        .map((v) => ({ value: v, label: v })),
    [allFacts],
  );
  const blockOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of allFacts) map.set(f.blockId ?? f.blockName, f.blockName);
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allFacts]);

  const resetFilters = () => {
    setVintageMode("single");
    setVintage(ALL);
    setRangeFrom(ALL);
    setRangeTo(ALL);
    setVarietyFilter([]);
    setBlockFilter([]);
  };

  const dimensionFiltered = useMemo(
    () =>
      allFacts.filter((f) => {
        if (varietyFilter.length && !varietyFilter.includes(f.variety?.trim() || "Unspecified")) return false;
        if (blockFilter.length && !blockFilter.includes(f.blockId ?? f.blockName)) return false;
        return true;
      }),
    [allFacts, varietyFilter, blockFilter],
  );

  /** Facts inside the selected vintage window — drives every chart and KPI. */
  const facts = useMemo(() => {
    if (vintageMode === "range") {
      const from = rangeFrom === ALL ? -Infinity : Number(rangeFrom);
      const to = rangeTo === ALL ? Infinity : Number(rangeTo);
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      return dimensionFiltered.filter((f) => f.vintage != null && f.vintage >= lo && f.vintage <= hi);
    }
    if (vintage === ALL) return dimensionFiltered;
    return dimensionFiltered.filter((f) => f.vintage === Number(vintage));
  }, [dimensionFiltered, vintageMode, vintage, rangeFrom, rangeTo]);

  const priorFacts = useMemo(() => {
    if (vintageMode === "range" || effectiveVintage == null) return [];
    const prior = effectiveVintage - 1;
    if (!vintages.includes(prior)) return [];
    return dimensionFiltered.filter((f) => f.vintage === prior);
  }, [dimensionFiltered, vintageMode, effectiveVintage, vintages]);

  const totals = useMemo(() => aggregate(facts), [facts]);
  const priorTotals = useMemo(() => (priorFacts.length ? aggregate(priorFacts) : null), [priorFacts]);

  // --- groupings -------------------------------------------------------------
  const varietyGroups = useMemo(
    () => byVariety(facts).sort((a, b) => b.tonnes - a.tonnes),
    [facts],
  );
  const blockGroups = useMemo(() => byBlock(facts).sort((a, b) => b.tonnes - a.tonnes), [facts]);

  const [blockMetric, setBlockMetric] = useState<MetricKey>("tonnes");
  const [priceBlockSort, setPriceBlockSort] = useState<MetricKey>("pricePerTonne");
  const [varietyTrendMetric, setVarietyTrendMetric] = useState<MetricKey>("tonnes");
  const [blockTrendMetric, setBlockTrendMetric] = useState<MetricKey>("tonnesPerHa");
  const [mixMode, setMixMode] = useState<"tonnes" | "percent" | "area">("tonnes");
  const [trendVarieties, setTrendVarieties] = useState<string[]>([]);
  const [trendBlocks, setTrendBlocks] = useState<string[]>([]);

  const metricOf = (key: MetricKey) => metricOptions.find((m) => m.key === key) ?? METRICS[0];

  // Harvest disposition donut — inferred from whether a sale value is recorded.
  const dispositionRows = useMemo(
    () =>
      [
        { name: "Sold", value: totals.soldTonnes },
        { name: "Retained / internal use", value: totals.retainedTonnes },
      ].filter((r) => r.value > 1e-6),
    [totals.soldTonnes, totals.retainedTonnes],
  );

  // Donut becomes a ranked bar when there are too many varieties to read.

  const varietyPie = useMemo(() => {
    const rows = varietyGroups.filter((g) => g.tonnes > 0);
    if (rows.length <= 8) return { rows, mode: "pie" as const };
    const top = rows.slice(0, 7);
    const rest = rows.slice(7);
    const other = rest.reduce((a, r) => a + r.tonnes, 0);
    return {
      rows: [...top, { ...rest[0], key: "__other__", label: "Other", tonnes: other } as GroupedMetrics],
      mode: "bar" as const,
    };
  }, [varietyGroups]);

  // --- historical series -----------------------------------------------------
  const varietySeries = useMemo(() => {
    const m = metricOf(varietyTrendMetric);
    const picked = trendVarieties.length
      ? trendVarieties
      : varietyGroups.slice(0, 4).map((g) => g.label);
    const grouped = groupBy(
      dimensionFiltered,
      (f) => `${f.vintage ?? ""}|${(f.variety?.trim() || "Unspecified").toLowerCase()}`,
      (f) => f.variety?.trim() || "Unspecified",
    );
    const byYear = new Map<number, Record<string, number | null>>();
    for (const g of grouped) {
      const [yr, vName] = [Number(g.key.split("|")[0]), g.label];
      if (!Number.isFinite(yr)) continue;
      if (!picked.includes(vName)) continue;
      const row = byYear.get(yr) ?? {};
      row[vName] = metricAxisValue(m, g[varietyTrendMetric] ?? null);
      byYear.set(yr, row);
    }
    return {
      keys: picked,
      data: Array.from(byYear.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([vintage, values]) => ({ vintage, ...values })),
    };
  }, [dimensionFiltered, trendVarieties, varietyGroups, varietyTrendMetric, imperial]);

  const blockSeries = useMemo(() => {
    const m = metricOf(blockTrendMetric);
    const picked = trendBlocks.length ? trendBlocks : blockGroups.slice(0, 4).map((g) => g.label);
    const grouped = groupBy(
      dimensionFiltered,
      (f) => `${f.vintage ?? ""}|${(f.blockId ?? f.blockName).toLowerCase()}`,
      (f) => f.blockName,
    );
    const byYear = new Map<number, Record<string, number | null>>();
    for (const g of grouped) {
      const yr = Number(g.key.split("|")[0]);
      if (!Number.isFinite(yr) || !picked.includes(g.label)) continue;
      const row = byYear.get(yr) ?? {};
      row[g.label] = metricAxisValue(m, g[blockTrendMetric] ?? null);
      byYear.set(yr, row);
    }
    return {
      keys: picked,
      data: Array.from(byYear.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([vintage, values]) => ({ vintage, ...values })),
    };
  }, [dimensionFiltered, trendBlocks, blockGroups, blockTrendMetric, imperial]);

  const mix = useMemo(() => {
    const grouped = groupBy(
      dimensionFiltered,
      (f) => `${f.vintage ?? ""}|${(f.variety?.trim() || "Unspecified").toLowerCase()}`,
      (f) => f.variety?.trim() || "Unspecified",
    );
    const names = Array.from(new Set(grouped.map((g) => g.label))).sort();
    const byYear = new Map<number, Record<string, number>>();
    for (const g of grouped) {
      const yr = Number(g.key.split("|")[0]);
      if (!Number.isFinite(yr)) continue;
      const row = byYear.get(yr) ?? {};
      const raw = mixMode === "area" ? g.areaHa ?? 0 : g.tonnes;
      row[g.label] = (row[g.label] ?? 0) + (imperial && mixMode === "area" ? raw / HA_PER_AC : raw);
      byYear.set(yr, row);
    }
    const data = Array.from(byYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([vintage, values]) => {
        if (mixMode !== "percent") return { vintage, ...values };
        const total = Object.values(values).reduce((a, b) => a + b, 0);
        const pct: Record<string, number> = {};
        for (const [k, v] of Object.entries(values)) pct[k] = total > 0 ? (v / total) * 100 : 0;
        return { vintage, ...pct };
      });
    return { names, data };
  }, [dimensionFiltered, mixMode, imperial]);

  // --- scatter (block level, selected vintage) -------------------------------
  const scatterData = useMemo(
    () =>
      blockGroups
        .filter((g) => g.tonnesPerHa != null && g.pricePerTonne != null)
        .map((g) => ({
          x: metricAxisValue(METRICS[1], g.tonnesPerHa) ?? 0,
          y: g.pricePerTonne ?? 0,
          block: g.label,
          variety: g.detail,
          areaHa: g.areaHa,
          revenuePerHa: g.revenuePerHa,
        })),
    [blockGroups, imperial],
  );

  // --- benchmarks & three-year trends ---------------------------------------
  const propertyAvgTPerHa = totals.tonnesPerHa;
  const priorAvgTPerHa = priorTotals?.tonnesPerHa ?? null;

  const propertyThreeYear = useMemo(() => {
    if (effectiveVintage == null) return null;
    const perVintage = Array.from(
      new Set(dimensionFiltered.map((f) => f.vintage).filter((v): v is number => v != null)),
    ).map((v) => ({
      vintage: v,
      value: aggregate(dimensionFiltered.filter((f) => f.vintage === v)).tonnesPerHa,
    }));
    const t = threeYearTrend(perVintage, effectiveVintage);
    return t.threeYearAverage == null ? null : t;
  }, [dimensionFiltered, effectiveVintage]);

  // --- performance highlights ------------------------------------------------
  const highlights = useMemo(() => {
    const withRate = blockGroups.filter((g) => g.tonnesPerHa != null);
    const withRev = blockGroups.filter((g) => g.revenuePerHa != null);
    const withMargin = blockGroups.filter((g) => g.marginPerHa != null);
    const priorBlocks = new Map(byBlock(priorFacts).map((g) => [g.label, g.tonnesPerHa]));
    const deltas = withRate
      .map((g) => {
        const prior = priorBlocks.get(g.label) ?? null;
        return { label: g.label, delta: prior != null && g.tonnesPerHa != null ? g.tonnesPerHa - prior : null };
      })
      .filter((d) => d.delta != null) as { label: string; delta: number }[];
    return {
      highestYield: [...withRate].sort((a, b) => (b.tonnesPerHa ?? 0) - (a.tonnesPerHa ?? 0)).slice(0, 3),
      lowestYield: [...withRate].sort((a, b) => (a.tonnesPerHa ?? 0) - (b.tonnesPerHa ?? 0)).slice(0, 3),
      highestRevenue: [...withRev].sort((a, b) => (b.revenuePerHa ?? 0) - (a.revenuePerHa ?? 0)).slice(0, 3),
      highestMargin: costAvailable
        ? [...withMargin].sort((a, b) => (b.marginPerHa ?? 0) - (a.marginPerHa ?? 0)).slice(0, 3)
        : [],
      improved: [...deltas].sort((a, b) => b.delta - a.delta).slice(0, 3),
      declined: [...deltas].sort((a, b) => a.delta - b.delta).slice(0, 3),
    };
  }, [blockGroups, priorFacts, costAvailable]);

  // --- detailed table --------------------------------------------------------
  const [tableSearch, setTableSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("tonnes");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const allColumns = useMemo(
    () => [
      { key: "vintage", label: "Vintage" },
      { key: "block", label: "Block" },
      { key: "variety", label: "Variety" },
      { key: "area", label: rf.areaUnitLabel === "ac" ? "Acres" : "Hectares" },
      { key: "tonnes", label: "Tonnes" },
      { key: "tPerHa", label: `t/${rf.areaUnitLabel}` },
      { key: "disposition", label: "Disposition" },
      { key: "price", label: "Sale $/t" },
      { key: "revenue", label: "Grape revenue" },
      { key: "revPerHa", label: `Revenue/sold ${rf.areaUnitLabel}` },
      ...(costAvailable
        ? [
            { key: "cost", label: "Production cost" },
            { key: "costPerHa", label: `Cost/${rf.areaUnitLabel}` },
            { key: "costPerT", label: "Cost/t" },
            { key: "margin", label: "Grape-sale margin" },
            { key: "marginPerHa", label: `Margin/sold ${rf.areaUnitLabel}` },
          ]
        : []),
      { key: "source", label: "Source" },

    ],
    [rf.areaUnitLabel, costAvailable],
  );
  const [hidden, setHidden] = useState<string[]>([]);
  const visibleColumns = allColumns.filter((c) => !hidden.includes(c.key));

  const tableRows = useMemo(() => {
    const rows = facts.map((f) => {
      const tPerHa = f.areaHa && f.areaHa > 0 ? f.tonnes / f.areaHa : null;
      const price = f.pricedTonnes > 0 && f.revenue != null ? f.revenue / f.pricedTonnes : null;
      // Sold-fruit basis: hectares and cost are pro-rated to the sold share so
      // retained fruit never depresses grape-sale metrics.
      const soldFraction = f.tonnes > 0 ? Math.min(1, f.pricedTonnes / f.tonnes) : 0;
      const soldArea = f.areaHa != null ? f.areaHa * soldFraction : null;
      const revPerHa = f.revenue != null && soldArea ? f.revenue / soldArea : null;
      const costPerHa = f.cost != null && f.areaHa ? f.cost / f.areaHa : null;
      const costPerT = f.cost != null && f.tonnes > 0 ? f.cost / f.tonnes : null;
      const soldCost = f.cost != null ? f.cost * soldFraction : null;
      const margin = f.revenue != null && soldCost != null ? f.revenue - soldCost : null;

      return {
        fact: f,
        vintage: f.vintage,
        block: f.blockName,
        variety: f.variety ?? "—",
        area: f.areaHa,
        tonnes: f.tonnes,
        tPerHa,
        disposition:
          f.disposition === "sold" ? "Sold" : f.disposition === "mixed" ? "Part sold" : "Internal / retained",
        price,
        revenue: f.revenue,
        revPerHa,
        cost: f.cost,
        costPerHa,
        costPerT,
        margin,
        marginPerHa: margin != null && soldArea ? margin / soldArea : null,
        source: f.source === "detailed" ? `Picking records${f.pickCount ? ` (${f.pickCount})` : ""}` : "Manual actual yield",
      };
    });

    const needle = tableSearch.trim().toLowerCase();
    const filteredRows = needle
      ? rows.filter((r) => `${r.block} ${r.variety} ${r.vintage ?? ""}`.toLowerCase().includes(needle))
      : rows;
    return [...filteredRows].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [facts, tableSearch, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // --- shared chart bits -----------------------------------------------------
  const axisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 11,
    tickLine: false,
    axisLine: false,
  };
  const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    color: "hsl(var(--popover-foreground))",
    fontSize: 12,
  };

  const ChartCard = ({
    title,
    subtitle,
    action,
    children,
    empty,
  }: {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
    empty?: boolean;
  }) => (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {empty ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          No data for the selected filters.
        </div>
      ) : (
        children
      )}
    </Card>
  );

  const MetricSelect = ({
    value,
    onChange,
  }: {
    value: MetricKey;
    onChange: (v: MetricKey) => void;
  }) => (
    <Select value={value} onValueChange={(v) => onChange(v as MetricKey)}>
      <SelectTrigger className="h-8 w-[170px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {metricOptions.map((m) => (
          <SelectItem key={m.key} value={m.key} className="text-xs">
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const KpiCard = ({
    label,
    value,
    prior,
    current,
    hint,
  }: {
    label: string;
    value: string;
    prior?: number | null;
    current?: number | null;
    hint?: string;
  }) => {
    const change = pctChange(current ?? null, prior ?? null);
    return (
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        {change != null && effectiveVintage != null ? (
          <div
            className={`mt-1 flex items-center gap-1 text-xs ${
              change >= 0 ? "text-primary" : "text-destructive"
            }`}
          >
            {change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {change >= 0 ? "+" : ""}
            {num(change, 1)}% vs {effectiveVintage - 1}
          </div>
        ) : (
          hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        )}
      </Card>
    );
  };

  const filtersActive =
    vintage !== ALL || vintageMode === "range" || varietyFilter.length > 0 || blockFilter.length > 0;

  const rankBars = (rows: GroupedMetrics[], metric: MetricOption, onClick?: (label: string) => void) => {
    const data = rows
      .map((g) => ({ label: g.label, detail: g.detail, group: g, value: metricAxisValue(metric, g[metric.key] ?? null) }))
      .filter((d) => d.value != null)
      .sort((a, b) => (b.value as number) - (a.value as number))
      .slice(0, 15);
    return (
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 28)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis type="number" {...axisProps} />
          <YAxis type="category" dataKey="label" width={120} {...axisProps} />
          <RTooltip
            contentStyle={tooltipStyle}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const g = (payload[0].payload as any).group as GroupedMetrics;
              return (
                <div style={tooltipStyle} className="p-2 space-y-0.5">
                  <div className="font-medium">{g.label}</div>
                  {g.detail && <div className="text-muted-foreground">{g.detail}</div>}
                  <div>Area: {areaFmt(g.areaHa)}</div>
                  <div>Tonnes: {num(g.tonnes)} t</div>
                  <div>
                    Yield: {perArea(g.tonnesPerHa)} t/{rf.areaUnitLabel}
                  </div>
                  <div>Avg price: {money(g.pricePerTonne)} /t</div>
                  <div>Revenue: {money(g.revenue)}</div>
                  <div>Revenue/area: {moneyPerArea(g.revenuePerHa)}</div>
                  {costAvailable && <div>Margin/area: {moneyPerArea(g.marginPerHa)}</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={(d: any) => onClick?.(d.label)}>
            {data.map((_, i) => (
              <Cell key={i} fill={colourFor(0)} cursor={onClick ? "pointer" : "default"} />
            ))}
          </Bar>
          {metric.key === "tonnesPerHa" && propertyAvgTPerHa != null && (
            <ReferenceLine
              x={metricAxisValue(metric, propertyAvgTPerHa) ?? 0}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              label={{ value: "Property avg", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  const noData = !isLoading && !error && allFacts.length === 0;

  return (
    <div className="space-y-5">
      <PageHead
        title="Yield Analytics"
        description="Interactive yield, price and revenue analytics by block, variety and vintage."
        path="/reports/yield"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BarChart3 className="h-6 w-6 text-primary" /> Yield Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Production, productivity and commercial performance across blocks, varieties and vintages.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadYieldAnalyticsCsv(facts)} disabled={!facts.length}>
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadYieldAnalyticsXlsx(facts)} disabled={!facts.length}>
            <Download className="mr-1.5 h-4 w-4" /> Excel
          </Button>
        </div>
      </div>

      {error && (
        <PortalNotice variant="warning" compact title="Could not load yield data" description={error.message} />
      )}
      {noData && (
        <PortalNotice
          variant="info"
          compact
          title="No harvest data yet"
          description="Record actual yield or detailed picks on the Yields page — those records feed this dashboard."
        />
      )}

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Vintage mode</div>
            <Select value={vintageMode} onValueChange={(v) => setVintageMode(v as "single" | "range")}>
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single vintage</SelectItem>
                <SelectItem value="range">Multi-year range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {vintageMode === "single" ? (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Vintage</div>
              <Select value={vintage} onValueChange={setVintage}>
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All vintages</SelectItem>
                  {vintages.map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">From</div>
                <Select value={rangeFrom} onValueChange={setRangeFrom}>
                  <SelectTrigger className="h-9 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Earliest</SelectItem>
                    {vintages.map((v) => (
                      <SelectItem key={v} value={String(v)}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">To</div>
                <Select value={rangeTo} onValueChange={setRangeTo}>
                  <SelectTrigger className="h-9 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Latest</SelectItem>
                    {vintages.map((v) => (
                      <SelectItem key={v} value={String(v)}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Variety</div>
            <MultiSelect
              className="h-9 w-[190px]"
              options={varietyOptions}
              selected={varietyFilter}
              onChange={setVarietyFilter}
              placeholder="All varieties"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Block</div>
            <MultiSelect
              className="h-9 w-[190px]"
              options={blockOptions}
              selected={blockFilter}
              onChange={setBlockFilter}
              placeholder="All blocks"
            />
          </div>

          <Button variant="ghost" size="sm" onClick={resetFilters} disabled={!filtersActive}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Reset filters
          </Button>
          <Badge variant="outline" className="ml-auto font-normal">
            {facts.length} records
          </Badge>
        </div>
      </Card>

      {isLoading && <Card className="p-8 text-center text-muted-foreground">Loading yield data…</Card>}

      {!isLoading && !noData && (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Total yield"
              value={`${num(totals.tonnes)} t`}
              current={totals.tonnes}
              prior={priorTotals?.tonnes ?? null}
            />
            <KpiCard
              label="Harvested area"
              value={areaFmt(totals.areaHa)}
              current={totals.areaHa}
              prior={priorTotals?.areaHa ?? null}
            />
            <KpiCard
              label={`Average yield (t/${rf.areaUnitLabel})`}
              value={perArea(totals.tonnesPerHa)}
              current={totals.tonnesPerHa}
              prior={priorAvgTPerHa}
            />
            <KpiCard
              label="Average sale price / tonne"
              value={money(totals.pricePerTonne)}
              current={totals.pricePerTonne}
              prior={priorTotals?.pricePerTonne ?? null}
              hint={totals.pricePerTonne == null ? "No grape sale recorded" : "Based on sold fruit only"}
            />
            <KpiCard
              label="Grape revenue"
              value={money(totals.revenue)}
              current={totals.revenue}
              prior={priorTotals?.revenue ?? null}
              hint={totals.revenue == null ? "No grape sale recorded" : "Sold fruit only"}
            />
            <KpiCard
              label={`Grape revenue / sold ${rf.areaUnitLabel}`}
              value={moneyPerArea(totals.revenuePerHa)}
              current={totals.revenuePerHa}
              prior={priorTotals?.revenuePerHa ?? null}
              hint={totals.revenuePerHa == null ? "No grape sale recorded" : "Sold-fruit area basis"}
            />
          </div>

          {/* Harvest disposition — sold vs internally retained fruit */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Harvest disposition</h2>
                <p className="text-sm text-muted-foreground">
                  {num(totals.soldTonnes, 2)} t sold
                  {" | "}
                  {num(totals.retainedTonnes, 2)} t retained for internal use
                </p>
                <p className="max-w-3xl text-xs text-muted-foreground">
                  Harvest without a grape sale price is treated as retained/internal-use fruit rather than
                  missing price data. It contributes to yield and production cost metrics but not grape-sale
                  revenue. Disposition is inferred from whether a grape sale value is recorded.
                </p>
              </div>
              <div className="flex items-center gap-6">
                <div className="grid gap-2 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="text-muted-foreground">Harvested</span>
                    <span className="font-semibold">{num(totals.tonnes, 2)} t</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-muted-foreground">Sold</span>
                    <span className="font-semibold">
                      {num(totals.soldTonnes, 2)} t
                      {totals.soldShare != null && ` (${num(totals.soldShare * 100, 1)}%)`}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-muted-foreground">Retained / internal</span>
                    <span className="font-semibold">
                      {num(totals.retainedTonnes, 2)} t
                      {totals.soldShare != null && ` (${num((1 - totals.soldShare) * 100, 1)}%)`}
                    </span>
                  </div>
                </div>
                {dispositionRows.length > 1 && (
                  <ResponsiveContainer width={180} height={140}>
                    <PieChart>
                      <Pie
                        data={dispositionRows}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={34}
                        outerRadius={58}
                        paddingAngle={2}
                      >
                        {dispositionRows.map((_, i) => (
                          <Cell key={i} fill={colourFor(i)} />
                        ))}
                      </Pie>
                      <RTooltip formatter={(v: number, n: string) => [`${num(v, 2)} t`, n]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </Card>

          {costAvailable && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard label="Production cost" value={money(totals.cost)} current={totals.cost} prior={priorTotals?.cost ?? null} hint="All harvested fruit" />
              <KpiCard label={`Cost / ${rf.areaUnitLabel}`} value={moneyPerArea(totals.costPerHa)} current={totals.costPerHa} prior={priorTotals?.costPerHa ?? null} hint="All harvested area" />
              <KpiCard label="Cost / tonne" value={money(totals.costPerTonne)} current={totals.costPerTonne} prior={priorTotals?.costPerTonne ?? null} hint="Sold and retained tonnes" />
              {totals.hasRetained && (
                <KpiCard
                  label="Retained fruit cost"
                  value={money(totals.retainedCost)}
                  current={totals.retainedCost}
                  prior={priorTotals?.retainedCost ?? null}
                  hint="Cost base of internal-use fruit"
                />
              )}
              <KpiCard label="Grape-sale margin" value={money(totals.margin)} current={totals.margin} prior={priorTotals?.margin ?? null} hint="Sale revenue less sold-fruit cost" />
              <KpiCard label={`Margin / sold ${rf.areaUnitLabel}`} value={moneyPerArea(totals.marginPerHa)} current={totals.marginPerHa} prior={priorTotals?.marginPerHa ?? null} hint="Sold fruit only" />
            </div>
          )}

          {!costAvailable && (
            <PortalNotice
              variant="info"
              compact
              title="Production cost data unavailable"
              description={
                canSeeCosts
                  ? "No allocated production costs were found for the harvested blocks and vintages in view. Cost-per-tonne, cost-per-hectare and grape-sale margin metrics will appear when production cost allocations are available."
                  : "Production cost and margin metrics are visible to owners and managers only."
              }
            />
          )}


          {/* Production breakdown */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Production breakdown
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <ChartCard
                title="Yield by variety"
                subtitle="Share of total tonnes harvested"
                empty={!varietyPie.rows.length}
              >
                {varietyPie.mode === "pie" ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={varietyPie.rows}
                        dataKey="tonnes"
                        nameKey="label"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        onClick={(d: any) => setVarietyFilter([d?.label])}
                      >
                        {varietyPie.rows.map((_, i) => (
                          <Cell key={i} fill={colourFor(i)} cursor="pointer" />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <RTooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const g = payload[0].payload as GroupedMetrics;
                          const share = totals.tonnes > 0 ? (g.tonnes / totals.tonnes) * 100 : null;
                          return (
                            <div style={tooltipStyle} className="p-2 space-y-0.5">
                              <div className="font-medium">{g.label}</div>
                              <div>{num(g.tonnes)} t ({num(share, 1)}% of crop)</div>
                              <div>Area: {areaFmt(g.areaHa)}</div>
                              <div>
                                {perArea(g.tonnesPerHa)} t/{rf.areaUnitLabel}
                              </div>
                              <div>Avg price: {money(g.pricePerTonne)} /t</div>
                              <div>Crop value: {money(g.revenue)}</div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  rankBars(varietyPie.rows, METRICS[0], (label) => setVarietyFilter([label]))
                )}
              </ChartCard>

              <ChartCard
                title="Yield by block"
                subtitle="Top 15 blocks — click a bar to filter"
                empty={!blockGroups.length}
                action={<MetricSelect value={blockMetric} onChange={setBlockMetric} />}
              >
                {rankBars(blockGroups, metricOf(blockMetric), (label) => {
                  const opt = blockOptions.find((o) => o.label === label);
                  if (opt) setBlockFilter([opt.value]);
                })}
              </ChartCard>
            </div>
          </section>

          {/* Productivity */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Productivity</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <ChartCard
                title={`Yield / ${rf.areaUnitLabel} by variety`}
                subtitle="Based on the hectares of the blocks growing each variety"
                empty={!varietyGroups.length}
              >
                {rankBars(varietyGroups, METRICS[1], (label) => setVarietyFilter([label]))}
              </ChartCard>
              <ChartCard
                title={`Yield / ${rf.areaUnitLabel} by block`}
                subtitle="Dashed line marks the property average"
                empty={!blockGroups.length}
              >
                {rankBars(blockGroups, METRICS[1])}
              </ChartCard>
            </div>
          </section>

          {/* Grape sales — sold-fruit metrics only */}
          <section id="ya-sales" className="space-y-3 scroll-mt-24">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Grape sales
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <ChartCard
                title="Average sale price / tonne by variety"
                subtitle="Sale revenue ÷ sold tonnes"
                info="Sold fruit only. Fruit retained for internal use carries no sale price and is excluded."
                empty={!varietyGroups.some((g) => g.pricePerTonne != null)}
              >
                {rankBars(varietyGroups.filter((g) => g.pricePerTonne != null), METRICS[2])}
              </ChartCard>
              <ChartCard
                title="Average sale price / tonne by block"
                subtitle="Ranked by the selected measure"
                empty={!blockGroups.some((g) => g.pricePerTonne != null)}
                action={<MetricSelect value={priceBlockSort} onChange={setPriceBlockSort} />}
              >
                {rankBars(blockGroups.filter((g) => g.pricePerTonne != null), metricOf(priceBlockSort))}
              </ChartCard>
              <ChartCard
                title={`Grape revenue / sold ${rf.areaUnitLabel} by block`}
                subtitle="Commercial productivity of sold fruit"
                empty={!blockGroups.some((g) => g.revenuePerHa != null)}
              >
                {rankBars(blockGroups.filter((g) => g.revenuePerHa != null), METRICS[4])}
              </ChartCard>
              <ChartCard
                title={`Yield / ${rf.areaUnitLabel} vs sale price / tonne`}
                subtitle="One point per block — dashed lines mark the property averages"
                empty={!scatterData.length}
              >

                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ left: 8, right: 16, top: 8, bottom: 16 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={`t/${rf.areaUnitLabel}`}
                      {...axisProps}
                      label={{ value: `t/${rf.areaUnitLabel}`, position: "insideBottom", offset: -8, fontSize: 11 }}
                    />
                    <YAxis type="number" dataKey="y" name="$/t" {...axisProps} />
                    <RTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload as any;
                        return (
                          <div style={tooltipStyle} className="p-2 space-y-0.5">
                            <div className="font-medium">{d.block}</div>
                            {d.variety && <div className="text-muted-foreground">{d.variety}</div>}
                            <div>Vintage: {vintageMode === "range" ? "range" : effectiveVintage ?? "—"}</div>
                            <div>Area: {areaFmt(d.areaHa)}</div>
                            <div>
                              {num(d.x)} t/{rf.areaUnitLabel}
                            </div>
                            <div>{money(d.y)} /t</div>
                            <div>Revenue/area: {moneyPerArea(d.revenuePerHa)}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData} fill={colourFor(0)} />
                    {propertyAvgTPerHa != null && (
                      <ReferenceLine
                        x={metricAxisValue(METRICS[1], propertyAvgTPerHa) ?? 0}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="4 4"
                      />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </section>

          {/* Historical trends */}
          <section id="ya-trends" className="space-y-3 scroll-mt-24">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Historical trends
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {!multiVintage ? (
                <Card className="p-6 text-sm text-muted-foreground lg:col-span-2">
                  More vintages are required to show year-on-year trends.
                </Card>
              ) : (
              <>

              <ChartCard
                title="Variety performance over time"
                subtitle="Each selected variety is its own series"
                empty={!varietySeries.data.length}
                action={
                  <div className="flex gap-2">
                    <MultiSelect
                      className="h-8 w-[150px] text-xs"
                      options={varietyOptions}
                      selected={trendVarieties}
                      onChange={setTrendVarieties}
                      placeholder="Top 4 varieties"
                    />
                    <MetricSelect value={varietyTrendMetric} onChange={setVarietyTrendMetric} />
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={varietySeries.data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="vintage" {...axisProps} />
                    <YAxis {...axisProps} />
                    <RTooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {varietySeries.keys.map((k, i) => (
                      <Line
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stroke={colourFor(i)}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Block performance over time"
                subtitle="Compare individual blocks across vintages"
                empty={!blockSeries.data.length}
                action={
                  <div className="flex gap-2">
                    <MultiSelect
                      className="h-8 w-[150px] text-xs"
                      options={blockOptions.map((o) => ({ value: o.label, label: o.label }))}
                      selected={trendBlocks}
                      onChange={setTrendBlocks}
                      placeholder="Top 4 blocks"
                    />
                    <MetricSelect value={blockTrendMetric} onChange={setBlockTrendMetric} />
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={blockSeries.data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="vintage" {...axisProps} />
                    <YAxis {...axisProps} />
                    <RTooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {blockSeries.keys.map((k, i) => (
                      <Line key={k} type="monotone" dataKey={k} stroke={colourFor(i)} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Production mix by variety"
                subtitle="Crop composition across vintages"
                empty={!mix.data.length}
                action={
                  <Select value={mixMode} onValueChange={(v) => setMixMode(v as typeof mixMode)}>
                    <SelectTrigger className="h-8 w-[130px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tonnes" className="text-xs">Tonnes</SelectItem>
                      <SelectItem value="percent" className="text-xs">% of crop</SelectItem>
                      <SelectItem value="area" className="text-xs">Area</SelectItem>
                    </SelectContent>
                  </Select>
                }
              >
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={mix.data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="vintage" {...axisProps} />
                    <YAxis {...axisProps} />
                    <RTooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {mix.names.map((n, i) => (
                      <Bar key={n} dataKey={n} stackId="mix" fill={colourFor(i)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              </>
              )}
            </div>

            <Card className="p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Benchmarks</h3>
                <p className="text-xs text-muted-foreground">Calculated from the current filters.</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Property average</span>
                  <span className="tabular-nums">
                    {perArea(propertyAvgTPerHa)} t/{rf.areaUnitLabel}
                  </span>
                </div>
                {multiVintage && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Previous vintage {effectiveVintage != null ? effectiveVintage - 1 : ""}
                      </span>
                      <span className="tabular-nums">
                        {priorAvgTPerHa == null ? "—" : `${perArea(priorAvgTPerHa)} t/${rf.areaUnitLabel}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">3-year average</span>
                      <span className="tabular-nums">
                        {propertyThreeYear?.threeYearAverage == null
                          ? "Needs 3 vintages"
                          : `${perArea(propertyThreeYear.threeYearAverage)} t/${rf.areaUnitLabel}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Difference vs 3-year average</span>
                      <span className="tabular-nums">
                        {propertyThreeYear?.difference == null
                          ? "—"
                          : `${propertyThreeYear.difference >= 0 ? "+" : ""}${perArea(
                              propertyThreeYear.difference,
                            )} t/${rf.areaUnitLabel}`}
                      </span>
                    </div>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {multiVintage
                  ? "Averages are suppressed rather than estimated when fewer than three valid vintages exist."
                  : "Historical benchmarks will appear when additional vintages are available."}
              </p>
            </Card>
          </section>


          {/* Highlights */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Performance highlights
              </h2>
              <div className="flex rounded-md border p-0.5">
                {(["block", "variety"] as const).map((d) => (
                  <Button
                    key={d}
                    type="button"
                    size="sm"
                    variant={highlightDim === d ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setHighlightDim(d)}
                  >
                    {d === "block" ? "Blocks" : "Varieties"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <HighlightCard
                title={`Highest yield / ${rf.areaUnitLabel}`}
                items={highlights.highestYield.map((g) => ({
                  label: g.label,
                  value: `${perArea(g.tonnesPerHa)} t/${rf.areaUnitLabel}`,
                  weight: g.tonnesPerHa ?? 0,
                }))}
              />
              <HighlightCard
                title={`Lowest yield / ${rf.areaUnitLabel}`}
                items={highlights.lowestYield.map((g) => ({
                  label: g.label,
                  value: `${perArea(g.tonnesPerHa)} t/${rf.areaUnitLabel}`,
                  weight: g.tonnesPerHa ?? 0,
                }))}
              />
              <HighlightCard
                title={`Highest revenue / sold ${rf.areaUnitLabel}`}
                items={highlights.highestRevenue.map((g) => ({
                  label: g.label,
                  value: moneyPerArea(g.revenuePerHa),
                  weight: g.revenuePerHa ?? 0,
                }))}
              />
              <HighlightCard
                title="Largest year-on-year improvement"
                items={highlights.improved.map((d) => ({
                  label: d.label,
                  value: `+${perArea(d.delta)} t/${rf.areaUnitLabel}`,
                  weight: Math.abs(d.delta),
                }))}
                empty="Needs a comparable prior vintage"
              />
              <HighlightCard
                title="Largest year-on-year decline"
                items={highlights.declined.map((d) => ({
                  label: d.label,
                  value: `${perArea(d.delta)} t/${rf.areaUnitLabel}`,
                  weight: Math.abs(d.delta),
                }))}
                empty="Needs a comparable prior vintage"
              />
              {costAvailable && (
                <HighlightCard
                  title={`Highest margin / sold ${rf.areaUnitLabel}`}
                  items={highlights.highestMargin.map((g) => ({
                    label: g.label,
                    value: moneyPerArea(g.marginPerHa),
                    weight: g.marginPerHa ?? 0,
                  }))}
                />
              )}
            </div>
          </section>

          {/* Detailed table */}
          <section id="ya-data" className="space-y-3 scroll-mt-24">

            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Detailed data
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="h-9 w-56 pl-8"
                    placeholder="Search block, variety or vintage…"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Settings2 className="mr-1.5 h-4 w-4" /> Columns
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="end">
                    <div className="space-y-1">
                      {allColumns.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                          onClick={() =>
                            setHidden((h) => (h.includes(c.key) ? h.filter((k) => k !== c.key) : [...h, c.key]))
                          }
                        >
                          <input type="checkbox" readOnly checked={!hidden.includes(c.key)} />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((c) => (
                      <TableHead
                        key={c.key}
                        onClick={() => toggleSort(c.key)}
                        className="cursor-pointer whitespace-nowrap select-none"
                      >
                        {c.label}
                        {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length} className="py-8 text-center text-muted-foreground">
                        No rows for the selected filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {tableRows.map((r, i) => {
                    const cells: Record<string, React.ReactNode> = {
                      vintage: r.vintage ?? "—",
                      block: r.block,
                      variety: r.variety,
                      area: areaFmt(r.area),
                      tonnes: num(r.tonnes, 3),
                      tPerHa: perArea(r.tPerHa),
                      disposition: (
                        <Badge
                          variant={r.fact.disposition === "sold" ? "default" : "secondary"}
                          className="font-normal"
                        >
                          {r.disposition}
                        </Badge>
                      ),

                      price: money(r.price),
                      revenue: money(r.revenue),
                      revPerHa: moneyPerArea(r.revPerHa),
                      cost: money(r.cost),
                      costPerHa: moneyPerArea(r.costPerHa),
                      costPerT: money(r.costPerT),
                      margin: money(r.margin),
                      marginPerHa: moneyPerArea(r.marginPerHa),
                      source: r.source,
                    };
                    return (
                      <TableRow key={i}>
                        {visibleColumns.map((c) => (
                          <TableCell
                            key={c.key}
                            className={`whitespace-nowrap ${
                              ["block", "variety", "source", "disposition"].includes(c.key) ? "" : "tabular-nums text-right"
                            }`}
                          >

                            {cells[c.key]}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function HighlightCard({
  title,
  items,
  empty = "No data",
}: {
  title: string;
  items: { label: string; value: string; weight?: number }[];
  empty?: string;
}) {
  const max = Math.max(0, ...items.map((it) => Math.abs(it.weight ?? 0)));
  return (
    <Card className="p-4 space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {items.map((it, i) => (
            <li key={`${it.label}-${i}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">
                  {i + 1}. {it.label}
                </span>
                <span className="tabular-nums">{it.value}</span>
              </div>
              {max > 0 && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (Math.abs(it.weight ?? 0) / max) * 100)}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

