import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { PageHead } from "@/components/PageHead";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportFilterBar } from "@/components/irrigation/reports/ReportFilterBar";
import { OverviewTab } from "@/components/irrigation/reports/OverviewTab";
import {
  ReportSection,
  type ReportColumn,
} from "@/components/irrigation/reports/ReportShell";
import { SessionDrillDownDialog } from "@/components/irrigation/reports/SessionDrillDownDialog";
import { useIrrigationUnits, EMPTY } from "@/lib/irrigationUnits";
import {
  DATA_QUALITY_LABEL,
  DEFAULT_REPORT_FILTERS,
  useBlockReport,
  useCalculationSourceReport,
  useDailyReport,
  useMonthlyReport,
  useRainfallReport,
  useRecordSourceReport,
  useValveReport,
  useVarietyReport,
  useVintageOverview,
  useVintageTrends,
  useWaterSourceReport,
  useWeeklyReport,
  type BlockReportRow,
  type DrillDown,
  type IrrigationReportFilters,
  type PeriodRow,
  type RainfallGrouping,
  type RainfallRow,
  type TrendRow,
  type ValveReportRow,
  type VarietyReportRow,
} from "@/lib/irrigationReportsQuery";

type TabKey =
  | "overview"
  | "trends"
  | "monthly"
  | "weekly"
  | "daily"
  | "valves"
  | "blocks"
  | "varieties"
  | "water"
  | "rainfall"
  | "sources";

export default function IrrigationReportsPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const { vintage } = useVintage();
  const u = useIrrigationUnits();

  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? "Vineyard";

  const [tab, setTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<IrrigationReportFilters>({
    ...DEFAULT_REPORT_FILTERS,
    vintage_year: vintage,
  });
  const [includeZeroDays, setIncludeZeroDays] = useState(false);
  const [includeZeroWeeks, setIncludeZeroWeeks] = useState(false);
  const [rainfallGrouping, setRainfallGrouping] = useState<RainfallGrouping>("month");
  const [trendCount, setTrendCount] = useState(5);
  const [drill, setDrill] = useState<DrillDown | null>(null);

  const vintageOptions = useMemo(
    () => [vintage + 1, vintage, vintage - 1, vintage - 2, vintage - 3, vintage - 4],
    [vintage],
  );

  const vy = selectedVineyardId;
  const overview = useVintageOverview(vy, filters, tab === "overview");
  const trends = useVintageTrends(vy, filters, trendCount, tab === "trends");
  const monthly = useMonthlyReport(vy, filters, tab === "monthly");
  const weekly = useWeeklyReport(vy, filters, includeZeroWeeks, tab === "weekly");
  const daily = useDailyReport(vy, filters, includeZeroDays, tab === "daily");
  const valves = useValveReport(vy, filters, tab === "valves");
  const blocks = useBlockReport(vy, filters, tab === "blocks");
  const varieties = useVarietyReport(vy, filters, tab === "varieties");
  const water = useWaterSourceReport(vy, filters, tab === "water");
  const rainfall = useRainfallReport(vy, filters, rainfallGrouping, tab === "rainfall");
  const calcSources = useCalculationSourceReport(vy, filters, tab === "sources");
  const recordSources = useRecordSourceReport(vy, filters, tab === "sources");

  const shared = { vineyardName, filters };

  // -- period columns shared by daily / weekly / monthly ---------------------
  const periodColumns = (label: string): ReportColumn<PeriodRow>[] => [
    {
      key: "period",
      header: label,
      cell: (r) =>
        r.period_label ??
        r.month_label ??
        (r.week_number != null ? `Week ${r.week_number}` : u.date(r.period_start ?? r.period_key)),
      exportValue: (r) => r.period_key,
    },
    {
      key: "volume",
      header: "Water",
      align: "right",
      cell: (r) => u.volume(r.total_litres),
      exportValue: (r) => r.total_litres,
    },
    {
      key: "effective",
      header: "Effective",
      align: "right",
      cell: (r) => u.volume(r.effective_litres),
      exportValue: (r) => r.effective_litres,
    },
    {
      key: "runtime",
      header: "Runtime",
      align: "right",
      cell: (r) => u.duration(r.runtime_minutes),
      exportValue: (r) => r.runtime_minutes,
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      cell: (r) => u.count(r.session_count),
      exportValue: (r) => r.session_count,
    },
    {
      key: "depth",
      header: "Depth",
      align: "right",
      cell: (r) => u.depth(r.irrigation_depth_mm),
      exportValue: (r) => r.irrigation_depth_mm,
    },
    {
      key: "rainfall",
      header: "Rainfall",
      align: "right",
      cell: (r) => u.depth(r.rainfall_mm),
      exportValue: (r) => r.rainfall_mm,
    },
    {
      key: "combined",
      header: "Combined input",
      align: "right",
      cell: (r) => u.depth(r.combined_water_input_mm),
      exportValue: (r) => r.combined_water_input_mm,
    },
  ];

  const periodChart = (rows: PeriodRow[] | null | undefined, label: string) => {
    const data = (rows ?? []).map((r) => ({
      name:
        r.period_label ??
        r.month_label ??
        (r.week_number != null ? `W${r.week_number}` : (r.period_start ?? r.period_key)),
      litres: r.total_litres ?? 0,
      rainfall: r.rainfall_mm ?? 0,
    }));
    if (data.length < 2) return null;
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} width={70} />
            <RTooltip
              formatter={(v: number, key) =>
                key === "rainfall" ? u.depth(v) : u.volume(v)
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="litres"
              name={`Water (${label})`}
              fill="hsl(var(--primary))"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHead
        title="Irrigation Reports | VineTrack"
        description="Vintage, monthly, weekly, daily, valve, block, variety, water source and rainfall irrigation reporting."
        path="/reports/irrigation"
        noindex
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Irrigation Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {vineyardName} · Vintage {filters.vintage_year ?? vintage} · every figure is calculated
            by the shared VineTrack reporting engine.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/irrigation">Irrigation Records</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/irrigation/history">History</Link>
          </Button>
        </div>
      </header>

      <ReportFilterBar
        vineyardId={vy}
        filters={filters}
        onChange={setFilters}
        vintageOptions={vintageOptions}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="valves">Valves</TabsTrigger>
          <TabsTrigger value="blocks">Blocks</TabsTrigger>
          <TabsTrigger value="varieties">Varieties</TabsTrigger>
          <TabsTrigger value="water">Water sources</TabsTrigger>
          <TabsTrigger value="rainfall">Rainfall</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            data={overview.data}
            isLoading={overview.isLoading}
            error={overview.error}
          />
        </TabsContent>

        <TabsContent value="trends" className="mt-4">
          <ReportSection<TrendRow>
            {...shared}
            title="Vintage trends"
            description="Multi-vintage comparison for this vineyard."
            fileSlug="irrigation-trends"
            envelope={trends.data}
            rows={trends.data?.rows}
            isLoading={trends.isLoading}
            error={trends.error}
            rowKey={(r) => String(r.vintage_year)}
            rowWarnings={(r) => r.warnings}
            actions={
              <Select value={String(trendCount)} onValueChange={(v) => setTrendCount(Number(v))}>
                <SelectTrigger className="h-9 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 5, 8, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Last {n} vintages
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            chart={
              (trends.data?.rows ?? []).length > 1 ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={(trends.data?.rows ?? []).map((r) => ({
                        name: String(r.vintage_year),
                        litres: r.total_litres ?? 0,
                        depth: r.irrigation_depth_mm ?? 0,
                      }))}
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={70} />
                      <RTooltip formatter={(v: number) => u.volume(v)} />
                      <Line
                        type="monotone"
                        dataKey="litres"
                        name="Water applied"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : null
            }
            columns={[
              {
                key: "vintage",
                header: "Vintage",
                cell: (r) => r.vintage_year,
                exportValue: (r) => r.vintage_year,
              },
              {
                key: "volume",
                header: "Water",
                align: "right",
                cell: (r) => u.volume(r.total_litres),
                exportValue: (r) => r.total_litres,
              },
              {
                key: "effective",
                header: "Effective",
                align: "right",
                cell: (r) => u.volume(r.effective_litres),
                exportValue: (r) => r.effective_litres,
              },
              {
                key: "sessions",
                header: "Sessions",
                align: "right",
                cell: (r) => u.count(r.session_count),
                exportValue: (r) => r.session_count,
              },
              {
                key: "runtime",
                header: "Runtime",
                align: "right",
                cell: (r) => u.duration(r.runtime_minutes),
                exportValue: (r) => r.runtime_minutes,
              },
              {
                key: "perha",
                header: `Per ${u.areaUnit}`,
                align: "right",
                cell: (r) => u.perHectare(r.litres_per_hectare),
                exportValue: (r) => r.litres_per_hectare,
              },
              {
                key: "pervine",
                header: "Per vine",
                align: "right",
                cell: (r) => u.perVine(r.litres_per_vine),
                exportValue: (r) => r.litres_per_vine,
              },
              {
                key: "depth",
                header: "Depth",
                align: "right",
                cell: (r) => u.depth(r.irrigation_depth_mm),
                exportValue: (r) => r.irrigation_depth_mm,
              },
              {
                key: "rainfall",
                header: "Rainfall",
                align: "right",
                cell: (r) => u.depth(r.rainfall_mm),
                exportValue: (r) => r.rainfall_mm,
              },
              {
                key: "quality",
                header: "Data quality",
                cell: (r) =>
                  r.data_quality ? (
                    <Badge variant="secondary" className="font-normal">
                      {DATA_QUALITY_LABEL[r.data_quality] ?? r.data_quality}
                    </Badge>
                  ) : (
                    EMPTY
                  ),
                exportValue: (r) => r.data_quality,
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="monthly" className="mt-4">
          <ReportSection<PeriodRow>
            {...shared}
            title="Monthly water use"
            description="Each month of the vintage window, including rainfall comparison."
            fileSlug="irrigation-monthly"
            envelope={monthly.data}
            rows={monthly.data?.rows}
            isLoading={monthly.isLoading}
            error={monthly.error}
            rowKey={(r) => r.period_key}
            columns={periodColumns("Month")}
            chart={periodChart(monthly.data?.rows, "month")}
            onRowClick={(r) =>
              setDrill({
                title: `Sessions · ${r.period_label ?? r.month_label ?? r.period_key}`,
                overrides: { date_from: r.period_start, date_to: r.period_end },
              })
            }
          />
        </TabsContent>

        <TabsContent value="weekly" className="mt-4">
          <ReportSection<PeriodRow>
            {...shared}
            title="Weekly water use"
            description="Vintage weeks with irrigation and rainfall."
            fileSlug="irrigation-weekly"
            envelope={weekly.data}
            rows={weekly.data?.rows}
            isLoading={weekly.isLoading}
            error={weekly.error}
            rowKey={(r) => r.period_key}
            columns={periodColumns("Week")}
            chart={periodChart(weekly.data?.rows, "week")}
            actions={
              <div className="flex items-center gap-2">
                <Switch
                  id="zero-weeks"
                  checked={includeZeroWeeks}
                  onCheckedChange={setIncludeZeroWeeks}
                />
                <Label htmlFor="zero-weeks" className="text-sm font-normal">
                  Show weeks without irrigation
                </Label>
              </div>
            }
            onRowClick={(r) =>
              setDrill({
                title: `Sessions · ${r.period_label ?? `Week ${r.week_number ?? ""}`}`,
                overrides: { date_from: r.period_start, date_to: r.period_end },
              })
            }
          />
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          <ReportSection<PeriodRow>
            {...shared}
            title="Daily water use"
            description="Every irrigation day in the filtered window."
            fileSlug="irrigation-daily"
            envelope={daily.data}
            rows={daily.data?.rows}
            isLoading={daily.isLoading}
            error={daily.error}
            rowKey={(r) => r.period_key}
            columns={periodColumns("Date")}
            chart={periodChart(daily.data?.rows, "day")}
            actions={
              <div className="flex items-center gap-2">
                <Switch
                  id="zero-days"
                  checked={includeZeroDays}
                  onCheckedChange={setIncludeZeroDays}
                />
                <Label htmlFor="zero-days" className="text-sm font-normal">
                  Show days without irrigation
                </Label>
              </div>
            }
            onRowClick={(r) =>
              setDrill({
                title: `Sessions · ${u.date(r.period_start ?? r.period_key)}`,
                overrides: {
                  date_from: r.period_start ?? r.period_key,
                  date_to: r.period_end ?? r.period_key,
                },
              })
            }
          />
        </TabsContent>

        <TabsContent value="valves" className="mt-4">
          <ReportSection<ValveReportRow>
            {...shared}
            title="Water by valve"
            description="Volume, runtime, flow behaviour and share of vineyard total."
            fileSlug="irrigation-valves"
            envelope={valves.data}
            rows={valves.data?.rows}
            isLoading={valves.isLoading}
            error={valves.error}
            rowKey={(r) => r.valve_id}
            rowWarnings={(r) => r.warnings}
            onRowClick={(r) =>
              setDrill({
                title: `Sessions · ${r.valve_name ?? "Valve"}`,
                overrides: { valve_id: r.valve_id },
              })
            }
            columns={[
              {
                key: "valve",
                header: "Valve",
                cell: (r) =>
                  r.valve_number ? `${r.valve_name ?? ""} (${r.valve_number})` : (r.valve_name ?? EMPTY),
                exportValue: (r) => r.valve_name,
              },
              {
                key: "system",
                header: "System",
                cell: (r) => r.system_name ?? EMPTY,
                exportValue: (r) => r.system_name,
              },
              {
                key: "source",
                header: "Water source",
                cell: (r) => r.water_source ?? EMPTY,
                exportValue: (r) => r.water_source,
              },
              {
                key: "volume",
                header: "Water",
                align: "right",
                cell: (r) => u.volume(r.total_litres),
                exportValue: (r) => r.total_litres,
              },
              {
                key: "share",
                header: "Share",
                align: "right",
                cell: (r) => u.percent(r.percent_of_vineyard_total),
                exportValue: (r) => r.percent_of_vineyard_total,
              },
              {
                key: "runtime",
                header: "Runtime",
                align: "right",
                cell: (r) => u.duration(r.runtime_minutes),
                exportValue: (r) => r.runtime_minutes,
              },
              {
                key: "flow",
                header: "Average flow",
                align: "right",
                cell: (r) => u.flow(r.average_flow_litres_per_hour),
                exportValue: (r) => r.average_flow_litres_per_hour,
              },
              {
                key: "sessions",
                header: "Sessions",
                align: "right",
                cell: (r) => u.count(r.session_count),
                exportValue: (r) => r.session_count,
              },
              {
                key: "blocks",
                header: "Blocks",
                align: "right",
                cell: (r) => u.count(r.blocks_supplied),
                exportValue: (r) => r.blocks_supplied,
              },
              {
                key: "last",
                header: "Last use",
                cell: (r) => u.date(r.last_use_date),
                exportValue: (r) => r.last_use_date,
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="blocks" className="mt-4">
          <ReportSection<BlockReportRow>
            {...shared}
            title="Water by block"
            description="Allocated water normalised by serviced area and vines."
            fileSlug="irrigation-blocks"
            envelope={blocks.data}
            rows={blocks.data?.rows}
            isLoading={blocks.isLoading}
            error={blocks.error}
            rowKey={(r) => r.block_id}
            rowWarnings={(r) => r.warnings}
            onRowClick={(r) =>
              setDrill({
                title: `Sessions · ${r.block_name ?? "Block"}`,
                overrides: { block_id: r.block_id },
              })
            }
            columns={[
              {
                key: "block",
                header: "Block",
                cell: (r) => r.block_name ?? EMPTY,
                exportValue: (r) => r.block_name,
              },
              {
                key: "variety",
                header: "Variety",
                cell: (r) => r.variety_name ?? EMPTY,
                exportValue: (r) => r.variety_name,
              },
              {
                key: "volume",
                header: "Water",
                align: "right",
                cell: (r) => u.volume(r.total_litres),
                exportValue: (r) => r.total_litres,
              },
              {
                key: "effective",
                header: "Effective",
                align: "right",
                cell: (r) => u.volume(r.effective_litres),
                exportValue: (r) => r.effective_litres,
              },
              {
                key: "area",
                header: "Serviced area",
                align: "right",
                cell: (r) => u.area(r.serviced_area_hectares),
                exportValue: (r) => r.serviced_area_hectares,
              },
              {
                key: "pervine",
                header: "Per vine",
                align: "right",
                cell: (r) => u.perVine(r.litres_per_vine),
                exportValue: (r) => r.litres_per_vine,
              },
              {
                key: "perha",
                header: `Per ${u.areaUnit}`,
                align: "right",
                cell: (r) => u.perHectare(r.litres_per_hectare),
                exportValue: (r) => r.litres_per_hectare,
              },
              {
                key: "depth",
                header: "Depth",
                align: "right",
                cell: (r) => u.depth(r.irrigation_depth_mm),
                exportValue: (r) => r.irrigation_depth_mm,
              },
              {
                key: "combined",
                header: "With rainfall",
                align: "right",
                cell: (r) => u.depth(r.combined_water_input_mm),
                exportValue: (r) => r.combined_water_input_mm,
              },
              {
                key: "diff",
                header: "vs previous",
                align: "right",
                cell: (r) => u.signedPercent(r.difference_percent),
                exportValue: (r) => r.difference_percent,
              },
              {
                key: "last",
                header: "Last irrigation",
                cell: (r) => u.date(r.last_irrigation_date),
                exportValue: (r) => r.last_irrigation_date,
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="varieties" className="mt-4">
          <ReportSection<VarietyReportRow>
            {...shared}
            title="Water by variety"
            description="Weighted per-vine and per-area water for each variety."
            fileSlug="irrigation-varieties"
            envelope={varieties.data}
            rows={varieties.data?.rows}
            isLoading={varieties.isLoading}
            error={varieties.error}
            rowKey={(r, i) => r.variety_id ?? `variety-${i}`}
            rowWarnings={(r) => r.warnings}
            onRowClick={(r) =>
              r.variety_id
                ? setDrill({
                    title: `Sessions · ${r.variety_name ?? "Variety"}`,
                    overrides: { variety_id: r.variety_id },
                  })
                : undefined
            }
            columns={[
              {
                key: "variety",
                header: "Variety",
                cell: (r) => r.variety_name ?? EMPTY,
                exportValue: (r) => r.variety_name,
              },
              {
                key: "blocks",
                header: "Blocks",
                align: "right",
                cell: (r) => u.count(r.block_count),
                exportValue: (r) => r.block_count,
              },
              {
                key: "volume",
                header: "Water",
                align: "right",
                cell: (r) => u.volume(r.total_litres),
                exportValue: (r) => r.total_litres,
              },
              {
                key: "area",
                header: "Serviced area",
                align: "right",
                cell: (r) => u.area(r.serviced_area_hectares),
                exportValue: (r) => r.serviced_area_hectares,
              },
              {
                key: "pervine",
                header: "Per vine",
                align: "right",
                cell: (r) => u.perVine(r.litres_per_vine),
                exportValue: (r) => r.litres_per_vine,
              },
              {
                key: "perha",
                header: `Per ${u.areaUnit}`,
                align: "right",
                cell: (r) => u.perHectare(r.litres_per_hectare),
                exportValue: (r) => r.litres_per_hectare,
              },
              {
                key: "depth",
                header: "Depth",
                align: "right",
                cell: (r) => u.depth(r.irrigation_depth_mm),
                exportValue: (r) => r.irrigation_depth_mm,
              },
              {
                key: "combined",
                header: "With rainfall",
                align: "right",
                cell: (r) => u.depth(r.combined_water_input_mm),
                exportValue: (r) => r.combined_water_input_mm,
              },
              {
                key: "diff",
                header: "vs previous",
                align: "right",
                cell: (r) => u.signedPercent(r.difference_percent),
                exportValue: (r) => r.difference_percent,
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="water" className="mt-4">
          <ReportSection
            {...shared}
            title="Water sources"
            description="Where the vintage's water came from."
            fileSlug="irrigation-water-sources"
            envelope={water.data}
            rows={water.data?.rows}
            isLoading={water.isLoading}
            error={water.error}
            rowKey={(r, i) => r.water_source ?? `source-${i}`}
            onRowClick={(r) =>
              r.water_source
                ? setDrill({
                    title: `Sessions · ${r.water_source}`,
                    overrides: { water_source: r.water_source },
                  })
                : undefined
            }
            columns={[
              {
                key: "source",
                header: "Water source",
                cell: (r) => r.water_source ?? EMPTY,
                exportValue: (r) => r.water_source,
              },
              {
                key: "systems",
                header: "Systems",
                align: "right",
                cell: (r) => u.count(r.system_count),
                exportValue: (r) => r.system_count,
              },
              {
                key: "valves",
                header: "Valves",
                align: "right",
                cell: (r) => u.count(r.valve_count),
                exportValue: (r) => r.valve_count,
              },
              {
                key: "volume",
                header: "Water",
                align: "right",
                cell: (r) => u.volume(r.total_litres),
                exportValue: (r) => r.total_litres,
              },
              {
                key: "share",
                header: "Share",
                align: "right",
                cell: (r) => u.percent(r.percent_of_vineyard_total),
                exportValue: (r) => r.percent_of_vineyard_total,
              },
              {
                key: "runtime",
                header: "Runtime",
                align: "right",
                cell: (r) => u.duration(r.runtime_minutes),
                exportValue: (r) => r.runtime_minutes,
              },
              {
                key: "sessions",
                header: "Sessions",
                align: "right",
                cell: (r) => u.count(r.session_count),
                exportValue: (r) => r.session_count,
              },
              {
                key: "last",
                header: "Last use",
                cell: (r) => u.date(r.last_use_date),
                exportValue: (r) => r.last_use_date,
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="rainfall" className="mt-4">
          <ReportSection<RainfallRow>
            {...shared}
            title="Irrigation vs rainfall"
            description="Combined water input as calculated by the reporting engine."
            fileSlug="irrigation-rainfall"
            envelope={rainfall.data}
            rows={rainfall.data?.rows}
            isLoading={rainfall.isLoading}
            error={rainfall.error}
            rowKey={(r) => r.period_key}
            actions={
              <Select
                value={rainfallGrouping}
                onValueChange={(v) => setRainfallGrouping(v as RainfallGrouping)}
              >
                <SelectTrigger className="h-9 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">By day</SelectItem>
                  <SelectItem value="week">By week</SelectItem>
                  <SelectItem value="month">By month</SelectItem>
                  <SelectItem value="vintage">Whole vintage</SelectItem>
                </SelectContent>
              </Select>
            }
            chart={
              (rainfall.data?.rows ?? []).length > 1 ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(rainfall.data?.rows ?? []).map((r) => ({
                        name: r.period_label ?? r.period_start ?? r.period_key,
                        irrigation: r.gross_irrigation_depth_mm ?? 0,
                        rainfall: r.rainfall_mm ?? 0,
                      }))}
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} width={60} />
                      <RTooltip formatter={(v: number) => u.depth(v)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="irrigation"
                        stackId="w"
                        name="Irrigation"
                        fill="hsl(var(--primary))"
                      />
                      <Bar
                        dataKey="rainfall"
                        stackId="w"
                        name="Rainfall"
                        fill="hsl(var(--muted-foreground))"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : null
            }
            columns={[
              {
                key: "period",
                header: "Period",
                cell: (r) => r.period_label ?? u.date(r.period_start ?? r.period_key),
                exportValue: (r) => r.period_key,
              },
              {
                key: "irrigation",
                header: "Irrigation depth",
                align: "right",
                cell: (r) => u.depth(r.gross_irrigation_depth_mm),
                exportValue: (r) => r.gross_irrigation_depth_mm,
              },
              {
                key: "effective",
                header: "Effective depth",
                align: "right",
                cell: (r) => u.depth(r.effective_irrigation_depth_mm),
                exportValue: (r) => r.effective_irrigation_depth_mm,
              },
              {
                key: "rain",
                header: "Rainfall",
                align: "right",
                cell: (r) => u.depth(r.rainfall_mm),
                exportValue: (r) => r.rainfall_mm,
              },
              {
                key: "combined",
                header: "Combined",
                align: "right",
                cell: (r) => u.depth(r.combined_water_input_mm),
                exportValue: (r) => r.combined_water_input_mm,
              },
              {
                key: "irrshare",
                header: "Irrigation share",
                align: "right",
                cell: (r) => u.percent(r.irrigation_percent_of_combined),
                exportValue: (r) => r.irrigation_percent_of_combined,
              },
              {
                key: "rainshare",
                header: "Rainfall share",
                align: "right",
                cell: (r) => u.percent(r.rainfall_percent_of_combined),
                exportValue: (r) => r.rainfall_percent_of_combined,
              },
              {
                key: "complete",
                header: "Rain records",
                cell: (r) =>
                  r.rainfall_data_complete == null
                    ? EMPTY
                    : r.rainfall_data_complete
                      ? "Complete"
                      : "Incomplete",
                exportValue: (r) =>
                  r.rainfall_data_complete == null
                    ? null
                    : r.rainfall_data_complete
                      ? "Complete"
                      : "Incomplete",
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="sources" className="mt-4 space-y-4">
          <ReportSection
            {...shared}
            title="How water volumes were calculated"
            description="Split of the vintage total by calculation method and measurement group."
            fileSlug="irrigation-calculation-sources"
            envelope={calcSources.data}
            rows={calcSources.data?.rows}
            isLoading={calcSources.isLoading}
            error={calcSources.error}
            rowKey={(r, i) => `${r.calculation_method ?? "unknown"}-${i}`}
            onRowClick={(r) =>
              r.calculation_method
                ? setDrill({
                    title: `Sessions · ${r.calculation_label ?? r.calculation_method}`,
                    overrides: { calculation_method: r.calculation_method },
                  })
                : undefined
            }
            columns={[
              {
                key: "method",
                header: "Calculation method",
                cell: (r) => r.calculation_label ?? r.calculation_method ?? EMPTY,
                exportValue: (r) => r.calculation_method,
              },
              {
                key: "group",
                header: "Measurement group",
                cell: (r) => r.measurement_label ?? r.measurement_group ?? EMPTY,
                exportValue: (r) => r.measurement_group,
              },
              {
                key: "sessions",
                header: "Sessions",
                align: "right",
                cell: (r) => u.count(r.session_count),
                exportValue: (r) => r.session_count,
              },
              {
                key: "volume",
                header: "Water",
                align: "right",
                cell: (r) => u.volume(r.total_litres),
                exportValue: (r) => r.total_litres,
              },
              {
                key: "share",
                header: "Share",
                align: "right",
                cell: (r) => u.percent(r.percent_of_total_litres),
                exportValue: (r) => r.percent_of_total_litres,
              },
              {
                key: "runtime",
                header: "Runtime",
                align: "right",
                cell: (r) => u.duration(r.runtime_minutes),
                exportValue: (r) => r.runtime_minutes,
              },
            ]}
          />

          <ReportSection
            {...shared}
            title="Where records came from"
            description="Manual portal and app entries, imports and automated sources."
            fileSlug="irrigation-record-sources"
            envelope={recordSources.data}
            rows={recordSources.data?.rows}
            isLoading={recordSources.isLoading}
            error={recordSources.error}
            rowKey={(r, i) => `${r.source_type ?? "unknown"}-${i}`}
            onRowClick={(r) =>
              r.source_type
                ? setDrill({
                    title: `Sessions · ${r.source_label ?? r.source_type}`,
                    overrides: { source_type: r.source_type },
                  })
                : undefined
            }
            columns={[
              {
                key: "source",
                header: "Record source",
                cell: (r) => r.source_label ?? r.source_type ?? EMPTY,
                exportValue: (r) => r.source_type,
              },
              {
                key: "group",
                header: "Group",
                cell: (r) => r.source_group ?? EMPTY,
                exportValue: (r) => r.source_group,
              },
              {
                key: "sessions",
                header: "Sessions",
                align: "right",
                cell: (r) => u.count(r.session_count),
                exportValue: (r) => r.session_count,
              },
              {
                key: "volume",
                header: "Water",
                align: "right",
                cell: (r) => u.volume(r.total_litres),
                exportValue: (r) => r.total_litres,
              },
              {
                key: "share",
                header: "Share",
                align: "right",
                cell: (r) => u.percent(r.percent_of_total_litres),
                exportValue: (r) => r.percent_of_total_litres,
              },
              {
                key: "last",
                header: "Last recorded",
                cell: (r) => u.dateTime(r.last_recorded_at),
                exportValue: (r) => r.last_recorded_at,
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      <SessionDrillDownDialog
        vineyardId={vy}
        filters={filters}
        drill={drill}
        onClose={() => setDrill(null)}
      />
    </div>
  );
}
