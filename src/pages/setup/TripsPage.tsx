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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useSortableTable } from "@/lib/useSortableTable";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import { Button } from "@/components/ui/button";
import TripRouteAppleMap from "@/components/TripRouteAppleMap";
import {
  parseCorrections,
  parseSeeding,
  summarizeCoverage,
  formatCorrectionLine,
  tripToCsvRow,
  rowsToCsv,
  downloadCsv,
  downloadTripPdf,
} from "@/lib/tripReport";

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
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
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

  type TripSortKey = "start" | "name" | "function" | "paddock" | "pattern" | "person" | "duration" | "distance" | "status";
  const durationMs = (s?: string | null, e?: string | null) => {
    if (!s || !e) return null;
    const ms = new Date(e).getTime() - new Date(s).getTime();
    return isNaN(ms) || ms < 0 ? null : ms;
  };
  const { sorted: rowsSorted, getSortDirection, toggleSort } = useSortableTable<typeof rows[number], TripSortKey>(rows, {
    accessors: {
      start: (t) => (t.start_time ? new Date(t.start_time) : null),
      name: (t) => tripDisplayName(t),
      function: (t) => tripFunctionLabel(t.trip_function) ?? "",
      paddock: (t) => t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? "" : ""),
      pattern: (t) => t.tracking_pattern ?? "",
      person: (t) => t.person_name ?? "",
      duration: (t) => durationMs(t.start_time, t.end_time),
      distance: (t) => (t.total_distance == null ? null : Number(t.total_distance)),
      status: (t) => tripStatus(t),
    },
    initial: { key: "start", direction: "desc" },
  });

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
      <div className="flex items-start justify-between gap-3">
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
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => {
            const csvRows = rows.map((t) => {
              const padName = t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? null : null);
              return tripToCsvRow(t, padName, tripDisplayName(t), tripFunctionLabel(t.trip_function));
            });
            downloadCsv(`trips_${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(csvRows));
          }}
        >
          Export CSV
        </Button>
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
          <div className="text-xs text-muted-foreground">Function</div>
          <Select value={tripFn} onValueChange={setTripFn}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All functions</SelectItem>
              <SelectItem value={SPRAY}>Spraying only</SelectItem>
              <SelectItem value={MAINT}>Maintenance (non-spray)</SelectItem>
              {Object.entries(TRIP_FUNCTION_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
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
              <SortableTableHead active={getSortDirection("start")} onSort={() => toggleSort("start")}>Start</SortableTableHead>
              <SortableTableHead active={getSortDirection("name")} onSort={() => toggleSort("name")}>Name</SortableTableHead>
              <SortableTableHead active={getSortDirection("function")} onSort={() => toggleSort("function")}>Function</SortableTableHead>
              <SortableTableHead active={getSortDirection("paddock")} onSort={() => toggleSort("paddock")}>Paddock</SortableTableHead>
              <SortableTableHead active={getSortDirection("pattern")} onSort={() => toggleSort("pattern")}>Pattern</SortableTableHead>
              <SortableTableHead active={getSortDirection("person")} onSort={() => toggleSort("person")}>Person</SortableTableHead>
              <SortableTableHead active={getSortDirection("duration")} onSort={() => toggleSort("duration")}>Duration</SortableTableHead>
              <SortableTableHead active={getSortDirection("distance")} onSort={() => toggleSort("distance")}>Distance</SortableTableHead>
              <SortableTableHead active={getSortDirection("status")} onSort={() => toggleSort("status")}>Status</SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={9} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rowsSorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No trips found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rowsSorted.map((t) => {
              const padName = t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? null : null);
              const s = tripStatus(t);
              const fnLabel = tripFunctionLabel(t.trip_function);
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                  <TableCell>{fmtDate(t.start_time)}</TableCell>
                  <TableCell className="font-medium">{tripDisplayName(t)}</TableCell>
                  <TableCell>{fnLabel ? <Badge variant="outline">{fnLabel}</Badge> : "—"}</TableCell>
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
        vineyardName={vineyardName}
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
  vineyardName,
  open,
  onOpenChange,
}: {
  trip: Trip | null;
  paddockNameById: Map<string, string | null>;
  vineyardName: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const padName = trip?.paddock_name ?? (trip?.paddock_id ? paddockNameById.get(trip.paddock_id) ?? null : null);
  const points = arrayLen(trip?.path_points);
  const completed = arrayLen(trip?.completed_paths);
  const skipped = arrayLen(trip?.skipped_paths);
  const pins = arrayLen(trip?.pin_ids);
  const corrections = trip ? parseCorrections(trip.manual_correction_events) : [];
  const seeding = trip ? parseSeeding(trip.seeding_details) : null;
  const cov = trip ? summarizeCoverage(trip) : null;

  // Resolve block names from paddock_ids jsonb (if present) or scalar paddock_id
  const blockNames: string[] = (() => {
    if (!trip) return [];
    const ids = Array.isArray(trip.paddock_ids) ? (trip.paddock_ids as string[]) : [];
    if (ids.length) {
      return ids
        .map((id) => paddockNameById.get(id) ?? null)
        .filter((v): v is string => !!v);
    }
    if (padName) return [padName];
    return [];
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{trip ? tripDisplayName(trip) : "Trip"} — {fmtDay(trip?.start_time)}</SheetTitle>
        </SheetHeader>
        {trip && (
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadTripPdf(trip, {
                    paddockName: padName ?? null,
                    tripDisplay: tripDisplayName(trip),
                    tripFunctionLabel: tripFunctionLabel(trip.trip_function),
                    vineyardName,
                    blockNames,
                    pinCount: pins,
                  })
                }
              >
                Download Trip Report PDF
              </Button>
            </div>
            <Section title="Route map">
              <TripRouteAppleMap pathPoints={trip.path_points} height={280} />
            </Section>
            <Section title="Schedule">
              <Field label="Date" value={fmtDate(trip.start_time)} />
              <Field label="Start time" value={trip.start_time ? new Date(trip.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
              <Field label="Finish time" value={trip.end_time ? new Date(trip.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
              <Field label="Duration" value={fmtDuration(trip.start_time, trip.end_time)} />
              <Field label="Status" value={tripStatus(trip)} />
            </Section>
            <Section title="Job record">
              <Field label="Trip type / function" value={fmt(tripFunctionLabel(trip.trip_function))} />
              <Field label="Title / details" value={fmt(trip.trip_title)} />
              <Field label="Paddock / block" value={fmt(padName)} />
              <Field label="Pattern" value={fmt(trip.tracking_pattern)} />
              <Field label="Person" value={fmt(trip.person_name)} />
            </Section>
            <Section title="Rows / paths">
              <Field label="Rows covered" value={String(cov?.rowsCovered ?? 0)} />
              <Field label="Completed" value={String(cov?.completed ?? completed)} />
              <Field label="Partial" value={String(cov?.partial ?? 0)} />
              <Field label="Skipped" value={String(cov?.skipped ?? skipped)} />
              <Field label="Manually marked complete" value={String(cov?.manuallyMarkedComplete ?? 0)} />
              <Field label="Total distance" value={fmtKm(trip.total_distance)} />
              <Field label="Path points" value={points == null ? "—" : String(points)} />
              <Field label="Pins" value={pins == null ? "—" : String(pins)} />
            </Section>
            {corrections.length > 0 && (
              <Section title="Manual corrections">
                <ul className="space-y-1 list-disc pl-5">
                  {corrections.map((c, i) => (
                    <li key={i}>{formatCorrectionLine(c)}</li>
                  ))}
                </ul>
              </Section>
            )}
            {seeding && trip.trip_function === "seeding" && (
              <Section title="Seeding details">
                {seeding.boxes.map((b) => (
                  <Field
                    key={b.name}
                    label={b.name}
                    value={[b.contents, b.rate, b.notes].filter(Boolean).join(" · ") || "—"}
                  />
                ))}
                {seeding.sowing_depth_cm != null && (
                  <Field label="Sowing depth" value={`${seeding.sowing_depth_cm} cm`} />
                )}
                {seeding.mix_lines.map((line, i) => (
                  <Field
                    key={i}
                    label={`Mix line ${i + 1}`}
                    value={[line.name, line.percent && `${line.percent}%`, line.kg_per_ha && `${line.kg_per_ha} kg/ha`, line.supplier]
                      .filter(Boolean)
                      .join(" · ") || JSON.stringify(line.raw)}
                  />
                ))}
              </Section>
            )}
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
