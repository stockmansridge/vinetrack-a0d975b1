// Block (paddock) detail page — operational overview for a single block.
// Header, metric cards and tabbed activity (trips, pins, growth stages,
// work tasks) for the selected block only. READ-ONLY.
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Pencil,
  Map as MapIcon,
  Layers,
  Sprout,
  MapPin,
  SprayCan,
  ListChecks,
  Activity,
} from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { fetchOne } from "@/lib/queries";
import { deriveMetrics, parsePolygonPoints, parseRows } from "@/lib/paddockGeometry";
import { fetchTripsForVineyard } from "@/lib/tripsQuery";
import { fetchPinsForVineyard } from "@/lib/pinsQuery";
import { fetchGrowthStageRecords } from "@/lib/growthStageRecordsQuery";
import { fetchWorkTasksForVineyard } from "@/lib/workTasksQuery";
import { formatDate, formatDateTime } from "@/lib/dateFormat";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmt = (n: any, d = 0) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: d })
    : "—";

const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : formatDate(d);
};

const fmtDateTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : formatDateTime(d);
};

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

  const varieties = useMemo(() => {
    if (!paddock) return [] as { name: string; percent?: number | null }[];
    const arr = Array.isArray(paddock.variety_allocations)
      ? paddock.variety_allocations
      : [];
    return arr
      .map((v: any) => ({
        name: String(v?.variety ?? v?.name ?? "").trim(),
        percent: Number.isFinite(Number(v?.percent)) ? Number(v.percent) : null,
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
                varieties.length === 0
                  ? "—"
                  : varieties
                      .map((v) =>
                        v.percent != null ? `${v.name} (${fmt(v.percent, 0)}%)` : v.name,
                      )
                      .join(", ")
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
          </div>
          {polygonPts.length < 3 && (
            <p className="mt-3 text-xs text-muted-foreground">
              <MapIcon className="inline h-3 w-3 mr-1" />
              This block has no mapped boundary yet.
            </p>
          )}
        </CardContent>
      </Card>

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
                      <TableCell>{t.trip_title || t.trip_function || "Trip"}</TableCell>
                      <TableCell>{t.trip_function ?? "—"}</TableCell>
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
