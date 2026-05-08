// Live Dashboard — near-real-time view of active and recently active trips.
// Read-only; uses fetchTripsForVineyard. Auto-refreshes every 45s.
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  Activity,
  PauseCircle,
  CheckCircle2,
  Users,
  RefreshCw,
  Map as MapIcon,
} from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import { extractPathPoints, parseCorrections } from "@/lib/tripReport";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useSortableTable } from "@/lib/useSortableTable";

interface PaddockLite {
  id: string;
  name: string | null;
}

const TRIP_FUNCTION_LABELS: Record<string, string> = {
  spray: "Spray",
  mowing: "Mowing",
  slashing: "Slashing",
  harrowing: "Harrowing",
  seeding: "Seeding",
  spreading: "Spreading",
  fertiliser: "Fertiliser",
  pruning: "Pruning",
  shootThinning: "Shoot thinning",
  canopyWork: "Canopy work",
  irrigationCheck: "Irrigation check",
  repairs: "Repairs",
  other: "Other",
};
const tripFn = (v?: string | null) =>
  v ? TRIP_FUNCTION_LABELS[v] ?? v : null;

const tripDisplay = (t: Trip): string => {
  if (t.trip_title?.trim()) return t.trip_title.trim();
  return tripFn(t.trip_function) ?? t.tracking_pattern ?? "Trip";
};

type Status = "active" | "paused" | "finished" | "older";

function statusOf(t: Trip): Status {
  const ended = !!t.end_time;
  if (!ended) {
    return t.is_paused ? "paused" : "active";
  }
  const ms = new Date(t.end_time!).getTime();
  if (!isNaN(ms) && Date.now() - ms < 24 * 3600 * 1000) return "finished";
  return "older";
}

function fmtDuration(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (isNaN(s) || isNaN(e) || e < s) return "—";
  const mins = Math.floor((e - s) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtRelative(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return `${formatDistanceToNowStrict(d)} ago`;
}

function arrLen(v: any): number {
  return Array.isArray(v) ? v.length : 0;
}

function rowCounts(t: Trip): { completed: number; planned: number } {
  const completed = arrLen(t.completed_paths);
  const planned = arrLen(t.row_sequence) || completed + 1;
  return { completed, planned };
}

const StatusBadge = ({ s }: { s: Status }) => {
  const map: Record<Status, { label: string; cls: string }> = {
    active: { label: "Active", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
    paused: { label: "Paused", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
    finished: { label: "Finished", cls: "bg-blue-500/15 text-blue-700 border-blue-500/30" },
    older: { label: "Older", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[s];
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
};

// ---------- Mini route preview (SVG) ----------

function RouteMini({ trip }: { trip: Trip | null }) {
  const pts = trip ? extractPathPoints(trip.path_points) : [];
  if (!trip) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Select an active trip to preview its route.
      </Card>
    );
  }
  if (!pts.length) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Route preview available when path data exists.
      </Card>
    );
  }
  const w = 480;
  const h = 220;
  const pad = 12;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const dLat = Math.max(maxLat - minLat, 1e-6);
  const dLng = Math.max(maxLng - minLng, 1e-6);
  const proj = (lat: number, lng: number) => {
    const x = pad + ((lng - minLng) / dLng) * (w - pad * 2);
    const y = pad + (1 - (lat - minLat) / dLat) * (h - pad * 2);
    return [x, y] as const;
  };
  const path = pts
    .map((p, i) => {
      const [x, y] = proj(p.lat, p.lng);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const [sx, sy] = proj(pts[0].lat, pts[0].lng);
  const last = pts[pts.length - 1];
  const [ex, ey] = proj(last.lat, last.lng);
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <MapIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{tripDisplay(trip)}</span>
        <span className="text-muted-foreground">· {trip.paddock_name ?? "—"}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto bg-muted/30 rounded">
        <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
        <circle cx={sx} cy={sy} r={4} fill="#22a046" />
        <circle cx={ex} cy={ey} r={4} fill="#d23232" />
      </svg>
      <div className="text-xs text-muted-foreground flex justify-between">
        <span>● Start</span>
        <span>{pts.length} points</span>
        <span>● Latest</span>
      </div>
    </Card>
  );
}

// ---------- Activity feed ----------

interface FeedEvent {
  ts: string;
  trip: string;
  label: string;
}

function buildFeed(trips: Trip[]): FeedEvent[] {
  const events: FeedEvent[] = [];
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const t of trips) {
    const name = tripDisplay(t);
    if (t.start_time && new Date(t.start_time).getTime() >= cutoff) {
      events.push({ ts: t.start_time, trip: name, label: "Trip started" });
    }
    if (t.end_time && new Date(t.end_time).getTime() >= cutoff) {
      events.push({ ts: t.end_time, trip: name, label: "Trip finished" });
    }
    if (t.is_paused && t.updated_at && new Date(t.updated_at).getTime() >= cutoff) {
      events.push({ ts: t.updated_at, trip: name, label: "Trip paused" });
    }
    const corrections = parseCorrections(t.manual_correction_events);
    for (const c of corrections) {
      if (!c.timestamp) continue;
      const tms = new Date(c.timestamp).getTime();
      if (isNaN(tms) || tms < cutoff) continue;
      events.push({ ts: c.timestamp, trip: name, label: c.label });
    }
  }
  events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return events.slice(0, 30);
}

// ---------- Page ----------

const ANY = "__any__";

export default function LiveDashboardPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ??
    "Vineyard";

  const paddocksQ = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });
  const paddocks = paddocksQ.data ?? [];

  const tripsQ = useQuery({
    queryKey: ["live-trips", selectedVineyardId, paddocks.map((p) => p.id).join(",")],
    enabled: !!selectedVineyardId,
    queryFn: () =>
      fetchTripsForVineyard(selectedVineyardId!, paddocks.map((p) => p.id)),
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });
  const allTrips = tripsQ.data?.trips ?? [];
  const lastRefresh = tripsQ.dataUpdatedAt ? new Date(tripsQ.dataUpdatedAt) : null;

  // Filters
  const [search, setSearch] = useState("");
  const [opFilter, setOpFilter] = useState<string>(ANY);
  const [fnFilter, setFnFilter] = useState<string>(ANY);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");

  // Selected trip for map preview
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  // Pre-compute status per trip
  const enriched = useMemo(
    () =>
      allTrips.map((t) => ({
        trip: t,
        status: statusOf(t),
      })),
    [allTrips],
  );

  // Default filtered set: active, paused, finished today (no "older")
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enriched
      .filter(({ status }) => status !== "older")
      .filter(({ trip, status }) => {
        if (statusFilter !== "all" && status !== statusFilter) return false;
        if (opFilter !== ANY && (trip.person_name ?? "") !== opFilter) return false;
        if (fnFilter !== ANY && (trip.trip_function ?? "") !== fnFilter) return false;
        if (s) {
          const hay = `${tripDisplay(trip)} ${trip.person_name ?? ""} ${
            trip.paddock_name ?? ""
          } ${tripFn(trip.trip_function) ?? ""}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      });
  }, [enriched, search, opFilter, fnFilter, statusFilter]);

  const STATUS_ORDER: Record<Status, number> = { active: 1, paused: 2, finished: 3, older: 4 };
  type LiveSortKey = "trip" | "status" | "operator" | "block" | "started" | "duration" | "row" | "progress" | "updated";
  const { sorted: visibleSorted, getSortDirection: liveSortDir, toggleSort: liveToggle } = useSortableTable<typeof visible[number], LiveSortKey>(visible, {
    accessors: {
      trip: (v) => tripDisplay(v.trip),
      status: (v) => STATUS_ORDER[v.status],
      operator: (v) => v.trip.person_name ?? "",
      block: (v) => v.trip.paddock_name ?? "",
      started: (v) => (v.trip.start_time ? new Date(v.trip.start_time) : null),
      duration: (v) => {
        if (!v.trip.start_time) return null;
        const e = v.trip.end_time ? new Date(v.trip.end_time).getTime() : Date.now();
        return e - new Date(v.trip.start_time).getTime();
      },
      row: (v) => (v.trip.current_row_number == null ? null : Number(v.trip.current_row_number)),
      progress: (v) => {
        const c = rowCounts(v.trip);
        return c.planned > 0 ? c.completed / c.planned : null;
      },
      updated: (v) => (v.trip.updated_at ? new Date(v.trip.updated_at) : null),
    },
    initial: { key: "started", direction: "desc" },
  });

  // Auto-select first active trip if none selected
  useEffect(() => {
    if (!selectedTripId && visible.length) {
      const firstWithPath = visible.find(
        (v) => extractPathPoints(v.trip.path_points).length > 0,
      );
      setSelectedTripId((firstWithPath ?? visible[0]).trip.id);
    }
  }, [visible, selectedTripId]);

  const selectedTrip =
    visible.find((v) => v.trip.id === selectedTripId)?.trip ?? null;

  // Summary
  const summary = useMemo(() => {
    let active = 0,
      paused = 0,
      finished = 0;
    const operators = new Set<string>();
    for (const { trip, status } of enriched) {
      if (status === "active") active++;
      else if (status === "paused") paused++;
      else if (status === "finished") finished++;
      if (status !== "older" && trip.person_name) operators.add(trip.person_name);
    }
    return { active, paused, finished, operators: operators.size };
  }, [enriched]);

  // Filter option lists from data
  const operators = useMemo(() => {
    const set = new Set<string>();
    for (const { trip } of enriched) if (trip.person_name) set.add(trip.person_name);
    return Array.from(set).sort();
  }, [enriched]);
  const functions = useMemo(() => {
    const set = new Set<string>();
    for (const { trip } of enriched) if (trip.trip_function) set.add(trip.trip_function);
    return Array.from(set).sort();
  }, [enriched]);

  const feed = useMemo(() => buildFeed(allTrips), [allTrips]);

  if (!selectedVineyardId) return null;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Live Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {vineyardName} — active and recently finished work, refreshed automatically.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Last refreshed:{" "}
            {lastRefresh ? format(lastRefresh, "p") : "—"}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => tripsQ.refetch()}
            disabled={tripsQ.isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${tripsQ.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Active trips" value={summary.active} Icon={Activity} />
        <SummaryCard label="Paused trips" value={summary.paused} Icon={PauseCircle} />
        <SummaryCard label="Finished today" value={summary.finished} Icon={CheckCircle2} />
        <SummaryCard label="Operators active today" value={summary.operators} Icon={Users} />
      </div>

      {/* Filters */}
      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search trip, operator, block…"
          className="w-[220px]"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="finished">Finished today</SelectItem>
          </SelectContent>
        </Select>
        <Select value={opFilter} onValueChange={setOpFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Operator" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All operators</SelectItem>
            {operators.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fnFilter} onValueChange={setFnFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Trip type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All types</SelectItem>
            {functions.map((f) => (
              <SelectItem key={f} value={f}>{tripFn(f)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {/* Active trips + map */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trip</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Block</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Row</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tripsQ.isLoading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!tripsQ.isLoading && visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      No active or recently finished trips.
                    </TableCell>
                  </TableRow>
                )}
                {visible.map(({ trip, status }) => {
                  const counts = rowCounts(trip);
                  return (
                    <TableRow
                      key={trip.id}
                      className={`cursor-pointer ${
                        selectedTripId === trip.id ? "bg-muted/50" : ""
                      }`}
                      onClick={() => setSelectedTripId(trip.id)}
                    >
                      <TableCell className="font-medium">
                        <div>{tripDisplay(trip)}</div>
                        {trip.trip_title && (
                          <div className="text-xs text-muted-foreground">
                            {tripFn(trip.trip_function) ?? "—"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge s={status} /></TableCell>
                      <TableCell>{trip.person_name ?? "—"}</TableCell>
                      <TableCell>{trip.paddock_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {trip.start_time ? format(new Date(trip.start_time), "p") : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fmtDuration(trip.start_time, trip.end_time)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {trip.current_row_number ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {counts.completed}/{counts.planned}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {fmtRelative(trip.updated_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-4">
          <RouteMini trip={selectedTrip} />
          <Card className="p-3">
            <div className="text-sm font-medium mb-2">Recent activity (24h)</div>
            {feed.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recent events.</p>
            ) : (
              <ul className="space-y-2 max-h-[360px] overflow-auto">
                {feed.map((e, i) => (
                  <li key={i} className="text-xs border-l-2 border-primary/40 pl-2">
                    <div className="text-muted-foreground">
                      {format(new Date(e.ts), "p")} · {e.trip}
                    </div>
                    <div>{e.label}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: number;
  Icon: any;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
