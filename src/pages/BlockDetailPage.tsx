// Block (paddock) detail page — operational overview for a single block.
// Header, metric cards and tabbed activity (trips, pins, growth stages,
// work tasks) for the selected block only. READ-ONLY.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Pencil,
  Map as MapIcon,
  Sprout,
  MapPin,
  SprayCan,
  ListChecks,
  Activity,
} from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { fetchOne } from "@/lib/queries";
import { deriveMetrics, parsePolygonPoints, parseRows } from "@/lib/paddockGeometry";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";
import { fetchGrowthStageRecords } from "@/lib/growthStageRecordsQuery";
import { fetchWorkTasksForVineyard } from "@/lib/workTasksQuery";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { tripFunctionLabel } from "@/lib/tripFunctionLabels";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import BlockMap from "@/components/BlockMap";
import PinDetailSheet from "@/components/PinDetailSheet";
import type { PinRecord } from "@/components/PinDetailPanel";

type DateRangeKey = "7d" | "30d" | "90d" | "season" | "all";

const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "season", label: "This season" },
  { value: "all", label: "All time" },
];

function rangeStart(key: DateRangeKey): Date | null {
  const now = new Date();
  if (key === "all") return null;
  if (key === "7d") return new Date(now.getTime() - 7 * 86_400_000);
  if (key === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  if (key === "90d") return new Date(now.getTime() - 90 * 86_400_000);
  // Season: assume Southern Hemisphere viticultural season starts July 1.
  const y = now.getFullYear();
  const seasonStartYear = now.getMonth() >= 6 ? y : y - 1;
  return new Date(seasonStartYear, 6, 1);
}


const fmt = (n: any, d = 0) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: d })
    : "—";

function useBlockFormatters() {
  const rf = useRegionFormatters();
  return {
    rf,
    fmtDay: (v?: string | null) => {
      if (!v) return "—";
      const d = new Date(v);
      return isNaN(d.getTime()) ? "—" : rf.date(d);
    },
    fmtDateTime: (v?: string | null) => {
      if (!v) return "—";
      const d = new Date(v);
      return isNaN(d.getTime()) ? "—" : rf.dateTime(d);
    },
  };
}

export default function BlockDetailPage() {
  const { blockId } = useParams();
  const navigate = useNavigate();
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  const paddockQ = useQuery({
    queryKey: ["block-detail", blockId],
    enabled: !!blockId,
    queryFn: () => fetchOne<any>("paddocks", blockId!),
  });
  const paddock = paddockQ.data;

  // Access check: block must belong to currently-selected vineyard
  // (RLS will already filter, but guard for friendly message).
  const accessible =
    !!paddock && (!selectedVineyardId || paddock.vineyard_id === selectedVineyardId);

  const metrics = useMemo(
    () => (paddock ? deriveMetrics(paddock) : null),
    [paddock],
  );
  const polygonPts = useMemo(
    () => (paddock ? parsePolygonPoints(paddock.polygon_points) : []),
    [paddock],
  );

  const rowNumberRange = useMemo(() => {
    if (!paddock) return null;
    const nums = parseRows(paddock.rows)
      .map((r) => r.number)
      .filter((n): n is number => Number.isFinite(n as number));
    if (!nums.length) return null;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const f = (n: number) => (Number.isInteger(n) ? String(n) : String(n));
    return min === max ? f(min) : `${f(min)}–${f(max)}`;
  }, [paddock]);

  const irrigation = useMemo(() => {
    if (!paddock || !metrics) return null;
    // Stored: flow_per_emitter is in L/hr per emitter.
    const flowPerEmitterLhr = Number(paddock.flow_per_emitter);
    const emitterCount = metrics.emitterCount;
    const hasFlow = Number.isFinite(flowPerEmitterLhr) && flowPerEmitterLhr > 0;
    const hasEmitters = emitterCount != null && emitterCount > 0;
    if (!hasFlow && !hasEmitters) return null;
    // Block total flow in L/hr → display in kL/hr.
    const blockFlowKlhr =
      hasFlow && hasEmitters
        ? (flowPerEmitterLhr * (emitterCount as number)) / 1000
        : null;
    const emitterRateLhr = hasFlow ? flowPerEmitterLhr : null;
    return { blockFlowKlhr, emitterCount, emitterRateLhr };
  }, [paddock, metrics]);

  const varieties = useMemo(() => {

    if (!paddock) return [] as { name: string; percent?: number | null; clone?: string | null; rootstock?: string | null }[];
    const arr = Array.isArray(paddock.variety_allocations)
      ? paddock.variety_allocations
      : [];
    const clean = (v: any) => {
      if (v == null) return null;
      const t = String(v).trim();
      return t.length === 0 ? null : t;
    };
    return arr
      .map((v: any) => ({
        name: String(v?.name ?? v?.varietyName ?? v?.variety_name ?? v?.variety ?? "").trim(),
        percent: Number.isFinite(Number(v?.percent)) ? Number(v.percent) : null,
        clone: clean(v?.clone),
        rootstock: clean(v?.rootstock ?? v?.root_stock),
      }))
      .filter((v) => v.name);
  }, [paddock]);

  // Children queries — only loaded once we know the block belongs to the
  // selected vineyard. All queries are read-only.
  const enabledChildren = !!selectedVineyardId && !!paddock && accessible;

  const paddockIds = useMemo(() => (paddock ? [paddock.id] : []), [paddock]);

  const tripsQ = useQuery({
    queryKey: ["block-trips", selectedVineyardId, paddock?.id],
    enabled: enabledChildren,
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, paddockIds),
  });
  const tripsAll = tripsQ.data?.trips ?? [];
  const trips = useMemo(
    () =>
      tripsAll.filter((t) => {
        if (t.paddock_id === paddock?.id) return true;
        const ids = Array.isArray(t.paddock_ids) ? (t.paddock_ids as string[]) : [];
        return ids.includes(paddock?.id);
      }),
    [tripsAll, paddock?.id],
  );

  const pinsQ = useQuery({
    queryKey: ["block-pins", selectedVineyardId, paddock?.id],
    enabled: enabledChildren,
    queryFn: () => fetchPinsForVineyard(selectedVineyardId!, paddockIds),
  });
  const pins = useMemo(
    () => (pinsQ.data?.pins ?? []).filter((p: any) => p.paddock_id === paddock?.id),
    [pinsQ.data, paddock?.id],
  );

  const growthQ = useQuery({
    queryKey: ["block-growth", selectedVineyardId, paddock?.id],
    enabled: enabledChildren,
    queryFn: () => fetchGrowthStageRecords(selectedVineyardId!),
  });
  const growth = useMemo(
    () => (growthQ.data ?? []).filter((r) => r.paddock_id === paddock?.id),
    [growthQ.data, paddock?.id],
  );

  const tasksQ = useQuery({
    queryKey: ["block-tasks", selectedVineyardId, paddock?.id],
    enabled: enabledChildren,
    queryFn: () => fetchWorkTasksForVineyard(selectedVineyardId!, paddockIds),
  });
  const tasks = useMemo(
    () => (tasksQ.data?.tasks ?? []).filter((t) => t.paddock_id === paddock?.id),
    [tasksQ.data, paddock?.id],
  );

  // ---- Map side-panel state -------------------------------------------------
  const [panelTab, setPanelTab] = useState<"trips" | "pins">("trips");
  const [dateRange, setDateRange] = useState<DateRangeKey>("30d");
  const [pinScope, setPinScope] = useState<"open" | "range">("open");
  const [activePin, setActivePin] = useState<PinRecord | null>(null);

  const since = useMemo(() => rangeStart(dateRange), [dateRange]);

  const tripsInRange = useMemo<Trip[]>(() => {
    if (!since) return trips;
    const cutoff = since.getTime();
    return trips.filter((t) => {
      const ts = t.start_time ? new Date(t.start_time).getTime() : 0;
      return ts >= cutoff;
    });
  }, [trips, since]);

  const pinsForPanel = useMemo(() => {
    if (pinScope === "open") {
      return pins.filter((p: any) => !p.is_completed && !p.deleted_at);
    }
    if (!since) return pins;
    const cutoff = since.getTime();
    return pins.filter((p: any) => {
      const ts = p.created_at ? new Date(p.created_at).getTime() : 0;
      return ts >= cutoff;
    });
  }, [pins, pinScope, since]);

  // Map overlays follow the active tab so the map mirrors the panel scope.
  const mapTrips = panelTab === "trips" ? tripsInRange : [];
  const mapPins = panelTab === "pins" ? pinsForPanel : [];

  if (paddockQ.isLoading) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="text-muted-foreground">Loading block…</div>
      </div>
    );
  }

  if (paddockQ.error || !paddock || !accessible) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert variant="destructive">
          <AlertTitle>Block not found or access denied</AlertTitle>
          <AlertDescription>
            This block does not exist or you do not have access to its vineyard.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const blockStatus = paddock.is_archived ? "Archived" : "Active";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <BackLink />
        <Button asChild variant="outline" size="sm">
          <Link to={`/setup/paddocks/${paddock.id}`}>
            <Pencil className="h-4 w-4 mr-1" /> Edit block
          </Link>
        </Button>
      </div>

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-2xl">{paddock.name ?? "Unnamed block"}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {vineyardName ?? "—"}
              </p>
            </div>
            <Badge variant={paddock.is_archived ? "secondary" : "default"}>
              {blockStatus}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <Field
              label="Variety"
              value={
                varieties.length === 0 ? (
                  "—"
                ) : (
                  <div className="space-y-1.5">
                    {varieties.map((v, i) => (
                      <div key={i} className="text-sm leading-tight">
                        <div>
                          {v.name}
                          {v.percent != null ? ` — ${fmt(v.percent, 0)}%` : ""}
                        </div>
                        {(v.clone || v.rootstock) && (
                          <div className="text-xs text-muted-foreground">
                            {v.clone ? `Clone: ${v.clone}` : ""}
                            {v.clone && v.rootstock ? " · " : ""}
                            {v.rootstock ? `Rootstock: ${v.rootstock}` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              }
            />
            <Field
              label="Area"
              value={metrics && metrics.areaHa > 0 ? `${fmt(metrics.areaHa, 2)} ha` : "—"}
            />
            <Field label="Rows" value={metrics ? fmt(metrics.rowCount) : "—"} />
            <Field
              label="Vines"
              value={
                metrics?.vineCount != null ? fmt(metrics.vineCount) : "—"
              }
            />
            <Field
              label="Row spacing"
              value={paddock.row_width != null ? `${fmt(paddock.row_width, 2)} m` : "—"}
            />
            <Field
              label="Vine spacing"
              value={paddock.vine_spacing != null ? `${fmt(paddock.vine_spacing, 2)} m` : "—"}
            />
            <Field
              label="Planting year"
              value={paddock.planting_year ? String(paddock.planting_year) : "—"}
            />
            <Field label="Last updated" value={fmtDateTime(paddock.updated_at)} />
            {rowNumberRange && (
              <Field label="Row numbers" value={rowNumberRange} />
            )}
            {irrigation?.blockFlowKlhr != null && (
              <Field
                label="Irrigation flow rate"
                value={`${fmt(irrigation.blockFlowKlhr, 1)} kL/hr`}
              />
            )}
            {irrigation?.emitterCount != null && (
              <Field
                label="Emitters"
                value={`${fmt(irrigation.emitterCount)} emitters`}
              />
            )}
            {irrigation?.emitterRateLhr != null && (
              <Field
                label="Emitter rate"
                value={`${fmt(irrigation.emitterRateLhr, 2)} L/hr/emitter`}
              />
            )}
          </div>

          {polygonPts.length < 3 && (
            <p className="mt-3 text-xs text-muted-foreground">
              <MapIcon className="inline h-3 w-3 mr-1" />
              This block has no mapped boundary yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Block-scoped map + side panel — overview-style layout */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MapIcon className="h-4 w-4" /> Block map
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangeKey)}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <div className="grid lg:grid-cols-[1fr_360px]">
          <div className="bg-muted" style={{ height: 480 }}>
            <BlockMap
              paddock={paddock}
              pins={mapPins}
              trips={mapTrips}
              vineyardName={vineyardName}
              hideControls
              height="100%"
              onPinSelected={(id) => {
                const p = pins.find((x: any) => x.id === id);
                if (p) setActivePin(p as PinRecord);
              }}
            />
          </div>
          <div
            className="flex flex-col border-t lg:border-l lg:border-t-0"
            style={{ maxHeight: 480 }}
          >
            <Tabs
              value={panelTab}
              onValueChange={(v) => setPanelTab(v as "trips" | "pins")}
              className="flex flex-1 flex-col min-h-0"
            >
              <div className="border-b p-2">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="trips">
                    Trips ({tripsInRange.length})
                  </TabsTrigger>
                  <TabsTrigger value="pins">
                    Pins ({pinsForPanel.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="trips" className="flex-1 min-h-0 mt-0">
                <ScrollArea className="h-full">
                  {tripsInRange.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      No trips recorded for this block in the selected date range.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {[...tripsInRange]
                        .sort(
                          (a, b) =>
                            (b.start_time ? new Date(b.start_time).getTime() : 0) -
                            (a.start_time ? new Date(a.start_time).getTime() : 0),
                        )
                        .map((t) => (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/trips?paddock=${paddock.id}&trip=${t.id}`)
                              }
                              className="w-full px-3 py-2 text-left hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {t.trip_title || tripFunctionLabel(t.trip_function) || "Trip"}
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted-foreground truncate">
                                    {fmtDateTime(t.start_time)}
                                    {t.person_name ? ` · ${t.person_name}` : ""}
                                    {(t as any).tractor_name
                                      ? ` · ${(t as any).tractor_name}`
                                      : ""}
                                  </div>
                                </div>
                                {t.total_distance != null && (
                                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                                    {(t.total_distance / 1000).toFixed(2)} km
                                  </Badge>
                                )}
                              </div>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="pins" className="flex-1 min-h-0 mt-0">
                <div className="flex items-center gap-1 border-b p-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPinScope("open")}
                    className={`rounded-md px-2 py-1 ${
                      pinScope === "open"
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    All open pins
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinScope("range")}
                    className={`rounded-md px-2 py-1 ${
                      pinScope === "range"
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    In date range
                  </button>
                </div>
                <ScrollArea className="h-full">
                  {pinsForPanel.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      No pins found for this block.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {[...pinsForPanel]
                        .sort(
                          (a: any, b: any) =>
                            new Date(b.created_at ?? 0).getTime() -
                            new Date(a.created_at ?? 0).getTime(),
                        )
                        .map((p: any) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setActivePin(p as PinRecord)}
                              className="w-full px-3 py-2 text-left hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {p.title ?? p.button_name ?? "Pin"}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                    {p.category && <span>{p.category}</span>}
                                    {p.priority && <span>· {p.priority}</span>}
                                    {p.row_number != null && (
                                      <span>· Row {p.row_number}</span>
                                    )}
                                    {p.side && <span>· {p.side}</span>}
                                    <span>· {fmtDay(p.created_at)}</span>
                                  </div>
                                </div>
                                <Badge
                                  variant={p.is_completed ? "secondary" : "default"}
                                  className="shrink-0 text-[10px]"
                                >
                                  {p.is_completed ? "Done" : p.status ?? "Open"}
                                </Badge>
                              </div>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </Card>

      <PinDetailSheet
        open={!!activePin}
        onOpenChange={(o) => !o && setActivePin(null)}
        pin={activePin}
        paddockName={paddock?.name ?? null}
        vineyardName={vineyardName ?? null}
        paddockRowDirection={
          Number.isFinite(Number(paddock?.row_direction))
            ? Number(paddock.row_direction)
            : null
        }
      />




      {/* Metric cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Trips"
          Icon={Activity}
          loading={tripsQ.isLoading}
          value={trips.length}
          to={`/trips?paddock=${paddock.id}`}
        />
        <MetricCard
          label="Pins"
          Icon={MapPin}
          loading={pinsQ.isLoading}
          value={pins.length}
          to={`/pins?paddock=${paddock.id}`}
        />
        <MetricCard
          label="Growth stage records"
          Icon={Sprout}
          loading={growthQ.isLoading}
          value={growth.length}
          to={`/reports/growth-stage?paddock=${paddock.id}`}
        />
        <MetricCard
          label="Work tasks"
          Icon={ListChecks}
          loading={tasksQ.isLoading}
          value={tasks.length}
          to={`/work-tasks?paddock=${paddock.id}`}
        />
        <MetricCard
          label="Spray records"
          Icon={SprayCan}
          loading={false}
          value="—"
          hint="No per-block link"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="trips" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="pins">Pins</TabsTrigger>
          <TabsTrigger value="growth">Growth stages</TabsTrigger>
          <TabsTrigger value="tasks">Work tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="trips">
          <ActivityCard
            title="Trips"
            empty="No trips recorded for this block yet."
            loading={tripsQ.isLoading}
            count={trips.length}
            link={{ to: `/trips?paddock=${paddock.id}`, label: "Open trips list" }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Function</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...trips]
                  .sort(
                    (a, b) =>
                      (b.start_time ? new Date(b.start_time).getTime() : 0) -
                      (a.start_time ? new Date(a.start_time).getTime() : 0),
                  )
                  .slice(0, 50)
                  .map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{fmtDateTime(t.start_time)}</TableCell>
                      <TableCell>{t.trip_title || tripFunctionLabel(t.trip_function) || "Trip"}</TableCell>
                      <TableCell>{tripFunctionLabel(t.trip_function) ?? "—"}</TableCell>
                      <TableCell>{t.person_name ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {t.total_distance != null
                          ? `${(t.total_distance / 1000).toFixed(2)} km`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </ActivityCard>
        </TabsContent>

        <TabsContent value="pins">
          <ActivityCard
            title="Pins"
            empty="No pins recorded for this block yet."
            loading={pinsQ.isLoading}
            count={pins.length}
            link={{ to: `/pins?paddock=${paddock.id}`, label: "Open pins list" }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...pins]
                  .sort(
                    (a: any, b: any) =>
                      new Date(b.created_at ?? 0).getTime() -
                      new Date(a.created_at ?? 0).getTime(),
                  )
                  .slice(0, 50)
                  .map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.title ?? p.button_name ?? "—"}</TableCell>
                      <TableCell>{p.mode ?? "—"}</TableCell>
                      <TableCell>
                        {p.is_completed ? "Completed" : p.status ?? "Open"}
                      </TableCell>
                      <TableCell>{p.priority ?? "—"}</TableCell>
                      <TableCell>{fmtDay(p.created_at)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </ActivityCard>
        </TabsContent>

        <TabsContent value="growth">
          <ActivityCard
            title="Growth stage records"
            empty="No growth stage records for this block yet."
            loading={growthQ.isLoading}
            count={growth.length}
            link={{
              to: `/reports/growth-stage?paddock=${paddock.id}`,
              label: "Open growth stage records",
            }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Variety</TableHead>
                  <TableHead>E-L stage</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...growth]
                  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
                  .slice(0, 50)
                  .map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{fmtDay(r.date)}</TableCell>
                      <TableCell>{r.variety ?? "—"}</TableCell>
                      <TableCell>
                        {r.growth_stage_code ?? "—"}
                        {r.growth_stage_label ? ` · ${r.growth_stage_label}` : ""}
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {r.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </ActivityCard>
        </TabsContent>

        <TabsContent value="tasks">
          <ActivityCard
            title="Work tasks"
            empty="No work tasks recorded for this block yet."
            loading={tasksQ.isLoading}
            count={tasks.length}
            link={{
              to: `/work-tasks?paddock=${paddock.id}`,
              label: "Open work tasks",
            }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...tasks]
                  .sort(
                    (a, b) =>
                      (b.start_date ?? b.date ?? "").localeCompare(
                        a.start_date ?? a.date ?? "",
                      ),
                  )
                  .slice(0, 50)
                  .map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{fmtDay(t.start_date ?? t.date)}</TableCell>
                      <TableCell>{t.task_type ?? "—"}</TableCell>
                      <TableCell>{t.status ?? "—"}</TableCell>
                      <TableCell className="max-w-md truncate">
                        {t.description ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </ActivityCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/dashboard">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to overview
      </Link>
    </Button>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function MetricCard({
  label,
  Icon,
  value,
  loading,
  to,
  hint,
}: {
  label: string;
  Icon: any;
  value: React.ReactNode;
  loading: boolean;
  to?: string;
  hint?: string;
}) {
  const inner = (
    <Card
      className={
        to
          ? "cursor-pointer transition hover:border-primary/50 hover:shadow-md hover:bg-muted/40"
          : undefined
      }
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{loading ? "…" : value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
  if (to) {
    return (
      <Link
        to={to}
        aria-label={`${label} — open`}
        className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

function ActivityCard({
  title,
  empty,
  loading,
  count,
  link,
  children,
}: {
  title: string;
  empty: string;
  loading: boolean;
  count: number;
  link?: { to: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        {link && count > 0 && (
          <Button asChild variant="ghost" size="sm">
            <Link to={link.to}>{link.label}</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : count === 0 ? (
          <div className="text-sm text-muted-foreground">{empty}</div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
