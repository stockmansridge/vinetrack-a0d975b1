// Compact analytics for the Pruning Activity Report.
//
// Presentation only — every figure comes from the same filtered allocation
// rows that drive the KPI cards and the detailed table, aggregated by the pure
// helpers in @/lib/pruningActivityCharts (labour hours/cost counted once per
// activity via the allocation split).
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCanSeeCosts } from "@/lib/permissions";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { PruningActivityRow } from "@/lib/pruningActivityQuery";
import {
  buildBlockProductivity,
  buildDailyPruningSeries,
  overallVinesPerHour,
  rankBlocks,
  type BlockMetric,
  type BlockProductivityPoint,
} from "@/lib/pruningActivityCharts";

type ProgressMetric = "vines" | "hours" | "vinesPerHour";
type ProgressMode = "daily" | "cumulative";

const EMPTY = "No pruning activity matches the selected filters.";

function Toggle({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <Button
          key={o.key}
          type="button"
          size="sm"
          variant={value === o.key ? "secondary" : "ghost"}
          className="h-7 px-2 text-xs"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[180px] items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
      {EMPTY}
    </div>
  );
}

export default function PruningActivityCharts({
  rows,
  blockLabel,
}: {
  rows: PruningActivityRow[];
  blockLabel: string;
}) {
  const fmt = useRegionFormatters();
  const canSeeCosts = useCanSeeCosts();
  const [metric, setMetric] = useState<ProgressMetric>("vines");
  const [mode, setMode] = useState<ProgressMode>("daily");
  const [blockMetric, setBlockMetric] = useState<BlockMetric>("vinesPerHour");

  const series = useMemo(() => buildDailyPruningSeries(rows), [rows]);
  const blocks = useMemo(() => buildBlockProductivity(rows), [rows]);
  const average = useMemo(() => overallVinesPerHour(rows), [rows]);

  const effectiveBlockMetric: BlockMetric =
    blockMetric === "costPerVine" && !canSeeCosts ? "vinesPerHour" : blockMetric;
  const ranked = useMemo(
    () => rankBlocks(blocks, effectiveBlockMetric).slice(0, 8),
    [blocks, effectiveBlockMetric],
  );

  // Vines / labour hour is a ratio — a running total is meaningless.
  const modeAvailable = metric !== "vinesPerHour";
  const activeMode: ProgressMode = modeAvailable ? mode : "daily";
  const activeKey =
    activeMode === "cumulative"
      ? metric === "hours"
        ? "cumulativeHours"
        : "cumulativeVines"
      : metric;

  const metricLabel =
    metric === "hours" ? "Labour hours" : metric === "vinesPerHour" ? "Vines / labour hour" : "Vines pruned";

  const blockMetricLabel: Record<BlockMetric, string> = {
    vinesPerHour: "Vines / labour hour",
    vines: "Vines pruned",
    hours: "Labour hours",
    costPerVine: "Cost / vine",
  };

  const num = (n: number, digits = 0) =>
    Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

  const ProgressTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as (typeof series)[number];
    return (
      <div className="rounded border bg-popover p-2 text-xs shadow-md">
        <div className="font-medium">{p.label}</div>
        <div>Vines pruned: {num(p.vines)}</div>
        <div>Labour hours: {num(p.hours, 2)}</div>
        <div>Vines / hr: {p.vinesPerHour == null ? "—" : num(p.vinesPerHour)}</div>
        {activeMode === "cumulative" && (
          <div className="mt-1 border-t pt-1">
            Cumulative vines: {num(p.cumulativeVines)}
          </div>
        )}
      </div>
    );
  };

  const BlockTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as BlockProductivityPoint;
    return (
      <div className="rounded border bg-popover p-2 text-xs shadow-md">
        <div className="font-medium">{p.block}</div>
        {p.varieties.length > 0 && (
          <div className="text-muted-foreground">{p.varieties.join(", ")}</div>
        )}
        <div>Vines pruned: {num(p.vines)}</div>
        <div>Labour hours: {num(p.hours, 2)}</div>
        <div>Vines / hr: {p.vinesPerHour == null ? "—" : num(p.vinesPerHour)}</div>
        {canSeeCosts && (
          <>
            <div>Labour cost: {p.cost > 0 ? fmt.currency(p.cost) : "—"}</div>
            <div>Cost / vine: {p.costPerVine == null ? "—" : fmt.currency(p.costPerVine)}</div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {/* -------------------- Pruning progress -------------------- */}
      <Card className="p-3 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Pruning progress</h2>
            <p className="text-[11px] text-muted-foreground">
              Pruning activity across the selected season
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle
              label="Progress metric"
              value={metric}
              onChange={(v) => setMetric(v as ProgressMetric)}
              options={[
                { key: "vines", label: "Vines pruned" },
                { key: "hours", label: "Labour hours" },
                { key: "vinesPerHour", label: "Vines / hr" },
              ]}
            />
            {modeAvailable && (
              <Toggle
                label="Daily or cumulative"
                value={activeMode}
                onChange={(v) => setMode(v as ProgressMode)}
                options={[
                  { key: "daily", label: "Daily" },
                  { key: "cumulative", label: "Cumulative" },
                ]}
              />
            )}
          </div>
        </div>

        <div className="mt-2">
          {series.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="pruningProgressFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  allowDecimals={metric !== "vines"}
                />
                <RTooltip content={<ProgressTooltip />} />
                <Area
                  type="monotone"
                  dataKey={activeKey}
                  name={metricLabel}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#pruningProgressFill)"
                  connectNulls={false}
                  dot={series.length <= 30}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* -------------------- Productivity by block -------------------- */}
      <Card className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Productivity by {blockLabel.toLowerCase()}</h2>
            <p className="text-[11px] text-muted-foreground">
              {blockMetricLabel[effectiveBlockMetric]}
              {effectiveBlockMetric === "costPerVine" ? " — lowest first" : " — highest first"}
            </p>
          </div>
        </div>
        <div className="mt-1">
          <Toggle
            label="Block metric"
            value={effectiveBlockMetric}
            onChange={(v) => setBlockMetric(v as BlockMetric)}
            options={[
              { key: "vinesPerHour", label: "Vines / hr" },
              { key: "vines", label: "Vines" },
              { key: "hours", label: "Hours" },
              ...(canSeeCosts ? [{ key: "costPerVine", label: "Cost / vine" }] : []),
            ]}
          />
        </div>

        <div className="mt-2">
          {ranked.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, ranked.length * 26 + 30)}>
              <BarChart
                data={ranked}
                layout="vertical"
                margin={{ top: 4, right: 12, bottom: 0, left: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="block"
                  width={92}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <RTooltip content={<BlockTooltip />} cursor={{ fillOpacity: 0.08 }} />
                {effectiveBlockMetric === "vinesPerHour" && average != null && (
                  <ReferenceLine
                    x={average}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    label={{
                      value: `Report average: ${num(average)} vines/hr`,
                      position: "insideTopRight",
                      fontSize: 9,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                  />
                )}
                <Bar
                  dataKey={effectiveBlockMetric}
                  name={blockMetricLabel[effectiveBlockMetric]}
                  fill="hsl(var(--primary))"
                  radius={[0, 3, 3, 0]}
                  barSize={14}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
