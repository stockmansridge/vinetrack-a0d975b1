import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";

interface PaddockLite {
  id: string;
  name: string | null;
}

const ANY = "__any__";
const SPRAY = "__spray__";
const MAINT = "__maint__";

const TRIP_FUNCTION_LABELS: Record<string, string> = {
  slashing: "Slashing",
  mulching: "Mulching",
  harrowing: "Harrowing",
  mowing: "Mowing",
  spraying: "Spraying",
  fertilising: "Fertilising",
  undervineWeeding: "Undervine weeding",
  interRowCultivation: "Inter-row cultivation",
  pruning: "Pruning",
  shootThinning: "Shoot thinning",
  canopyWork: "Canopy work",
  irrigationCheck: "Irrigation check",
  repairs: "Repairs",
  other: "Other",
};
const tripFunctionLabel = (v?: string | null) =>
  v ? TRIP_FUNCTION_LABELS[v] ?? v : null;
const tripDisplayName = (t: Trip): string => {
  if (t.trip_title && t.trip_title.trim()) return t.trip_title.trim();
  const fn = tripFunctionLabel(t.trip_function);
  if (fn) return fn;
  if (t.tracking_pattern) return t.tracking_pattern;
  if (t.paddock_name) return t.paddock_name;
  return "—";
};

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString();
};
const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtDuration = (start?: string | null, end?: string | null) => {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtKm = (m?: number | null) =>
  m == null ? "—" : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

function tripStatus(t: Trip): "active" | "paused" | "completed" {
  if (t.is_active) return "active";
  if (t.is_paused) return "paused";
  return "completed";
}

export default function TripsPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paddockId, setPaddockId] = useState<string>(ANY);
  const [pattern, setPattern] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [tripFn, setTripFn] = useState<string>(ANY);
  const [selected, setSelected] = useState<Trip | null>(null);

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });

  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);
  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["trips", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, paddockIds),
  });

  const trips = data?.trips ?? [];

  const patterns = useMemo(() => {
    const s = new Set<string>();
    trips.forEach((t) => t.tracking_pattern && s.add(t.tracking_pattern));
    return Array.from(s).sort();
  }, [trips]);

  const rows = useMemo(() => {
    let list = trips.slice();
    list.sort((a, b) =>
      (b.start_time ?? b.created_at ?? "").localeCompare(a.start_time ?? a.created_at ?? ""),
    );
    if (from) list = list.filter((t) => (t.start_time ?? "") >= from);
    if (to) list = list.filter((t) => (t.start_time ?? "") <= to + "T23:59:59");
    if (paddockId !== ANY) list = list.filter((t) => t.paddock_id === paddockId);
    if (pattern !== ANY) list = list.filter((t) => t.tracking_pattern === pattern);
    if (status !== ANY) list = list.filter((t) => tripStatus(t) === status);
    if (tripFn === SPRAY) {
      list = list.filter((t) => t.trip_function === "spraying");
    } else if (tripFn === MAINT) {
      list = list.filter((t) => t.trip_function && t.trip_function !== "spraying");
    } else if (tripFn !== ANY) {
      list = list.filter((t) => t.trip_function === tripFn);
    }
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((t) =>
        [t.trip_title, tripFunctionLabel(t.trip_function), t.paddock_name, t.tracking_pattern, t.person_name]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [trips, filter, from, to, paddockId, pattern, status, tripFn]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[TripsPage] diagnostics", {
      selectedVineyardId,
      tripsCount: trips.length,
      recordsBySource: data?.source ?? "n/a",
      vineyardIdMatches: data?.vineyardCount ?? 0,
      paddockIdFallbackAdded: data?.paddockFallbackCount ?? 0,
      deletedExcluded: data?.deletedExcluded ?? 0,
      missingDisplayFields: {
        missingStart: data?.missingStart ?? 0,
        missingPaddock: data?.missingPaddock ?? 0,
      },
      // Schema gaps surfaced for the team:
      schemaGaps: [
        "no tractor_id / spray_equipment_id on trips",
        "no operator user FK (person_name is free text)",
        "no trip title/name column",
        "no archive flag (only deleted_at)",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Trips</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Soft-deleted trips are excluded.
        </p>
        {!isLoading && !error && (
          <p className="text-xs text-muted-foreground mt-1">
            Showing {rows.length} of {trips.length} trips for this vineyard
            {data ? ` · source: ${data.source}` : ""}
            {data && (data.paddockFallbackCount || data.paddockJsonbFallbackCount)
              ? ` (+${data.paddockFallbackCount} via paddock_id, +${data.paddockJsonbFallbackCount} via paddock_ids)`
              : ""}
          </p>
        )}
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">From</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">To</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Paddock</div>
          <Select value={paddockId} onValueChange={setPaddockId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any paddock</SelectItem>
              {paddocks.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Pattern</div>
          <Select value={pattern} onValueChange={setPattern}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any pattern</SelectItem>
              {patterns.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Status</div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Paddock, pattern, person…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Start</TableHead>
              <TableHead>Paddock</TableHead>
              <TableHead>Pattern</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Distance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={7} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No trips found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const padName = t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? null : null);
              const s = tripStatus(t);
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                  <TableCell>{fmtDate(t.start_time)}</TableCell>
                  <TableCell>{fmt(padName)}</TableCell>
                  <TableCell>{t.tracking_pattern ? <Badge variant="secondary">{t.tracking_pattern}</Badge> : "—"}</TableCell>
                  <TableCell>{fmt(t.person_name)}</TableCell>
                  <TableCell>{fmtDuration(t.start_time, t.end_time)}</TableCell>
                  <TableCell>{fmtKm(t.total_distance)}</TableCell>
                  <TableCell>
                    {s === "active" ? <Badge>Active</Badge> :
                     s === "paused" ? <Badge variant="outline">Paused</Badge> :
                     <Badge variant="secondary">Completed</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <TripSheet
        trip={selected}
        paddockNameById={paddockNameById}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}

function arrayLen(v: any): number | null {
  return Array.isArray(v) ? v.length : null;
}

function TripSheet({
  trip,
  paddockNameById,
  open,
  onOpenChange,
}: {
  trip: Trip | null;
  paddockNameById: Map<string, string | null>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const padName = trip?.paddock_name ?? (trip?.paddock_id ? paddockNameById.get(trip.paddock_id) ?? null : null);
  const points = arrayLen(trip?.path_points);
  const completed = arrayLen(trip?.completed_paths);
  const skipped = arrayLen(trip?.skipped_paths);
  const pins = arrayLen(trip?.pin_ids);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Trip — {fmtDay(trip?.start_time)}</SheetTitle>
        </SheetHeader>
        {trip && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Schedule">
              <Field label="Start" value={fmtDate(trip.start_time)} />
              <Field label="End" value={fmtDate(trip.end_time)} />
              <Field label="Duration" value={fmtDuration(trip.start_time, trip.end_time)} />
              <Field label="Status" value={tripStatus(trip)} />
            </Section>
            <Section title="Context">
              <Field label="Paddock" value={fmt(padName)} />
              <Field label="Pattern" value={fmt(trip.tracking_pattern)} />
              <Field label="Person" value={fmt(trip.person_name)} />
            </Section>
            <Section title="Coverage">
              <Field label="Total distance" value={fmtKm(trip.total_distance)} />
              <Field label="Current path distance" value={fmtKm(trip.current_path_distance)} />
              <Field label="Current row" value={fmt(trip.current_row_number)} />
              <Field label="Next row" value={fmt(trip.next_row_number)} />
              <Field label="Sequence index" value={fmt(trip.sequence_index)} />
              <Field label="Path points" value={points == null ? "—" : String(points)} />
              <Field label="Completed paths" value={completed == null ? "—" : String(completed)} />
              <Field label="Skipped paths" value={skipped == null ? "—" : String(skipped)} />
              <Field label="Pins" value={pins == null ? "—" : String(pins)} />
            </Section>
            {(trip.total_tanks != null || trip.active_tank_number != null) && (
              <Section title="Tanks">
                <Field label="Active tank" value={fmt(trip.active_tank_number)} />
                <Field label="Total tanks" value={fmt(trip.total_tanks)} />
                <Field label="Filling" value={trip.is_filling_tank ? `Yes (#${trip.filling_tank_number ?? "?"})` : "No"} />
              </Section>
            )}
            <Section title="Meta">
              <Field label="Created" value={fmtDate(trip.created_at)} />
              <Field label="Updated" value={fmtDate(trip.updated_at)} />
              <Field label="Record ID" value={trip.id} mono />
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="rounded-md border bg-card/50 p-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "text-right"}>{value}</span>
    </div>
  );
}
