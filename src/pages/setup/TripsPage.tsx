import { useMemo, useState, useEffect, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
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
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import { fetchWorkTasksForVineyard, workTaskShortLabel } from "@/lib/workTasksQuery";
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
import { useVineyardLogo } from "@/hooks/useVineyardLogo";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { countTripPins } from "@/lib/tripPinCount";
import { useCanSeeCosts } from "@/lib/permissions";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import { fetchVineyardMembersWithCategory } from "@/lib/teamMembersQuery";
import { fetchFuelPurchasesForVineyard } from "@/lib/fuelPurchasesQuery";
import { fetchSprayRecordsForVineyard } from "@/lib/sprayRecordsQuery";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { fetchSavedInputsForVineyard } from "@/lib/savedInputsQuery";
import { fetchYieldReportsForVineyard } from "@/lib/yieldReportsQuery";
import { computeTripCost, fmtCurrency, fmtHa, fmtHours, fmtTonnes, type TractorLite } from "@/lib/tripCosting";
import { computeFuelEstimate } from "@/lib/fuelEstimate";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { fetchAllVineyardMachines, resolveMachineForRecord, type VineyardMachine } from "@/lib/vineyardMachinesQuery";


interface PaddockLite {
  id: string;
  name: string | null;
}

const ANY = "__any__";
const SPRAY = "__spray__";
const MAINT = "__maint__";

import { TRIP_FUNCTION_LABELS, tripFunctionLabel } from "@/lib/tripFunctionLabels";
import {
  formatTripPatternLabel,
  formatTripNameLabel,
  formatTripDurationLabel,
} from "@/lib/tripDisplay";
const tripDisplayName = (t: Trip): string =>
  formatTripNameLabel(
    t.trip_title,
    t.tracking_pattern,
    tripFunctionLabel(t.trip_function) ?? t.paddock_name ?? null,
  );

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return formatDateTime(d);
};
const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return formatDate(d);
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtDuration = (start?: string | null, end?: string | null) =>
  formatTripDurationLabel(start, end);
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
  const [searchParams] = useSearchParams();
  const [paddockId, setPaddockId] = useState<string>(searchParams.get("paddock") ?? ANY);
  useEffect(() => {
    const p = searchParams.get("paddock");
    if (p) setPaddockId(p);
  }, [searchParams]);
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

  // Stage 4B — resolve trips.work_task_id → display label. Read-only.
  const { data: workTasksResult } = useQuery({
    queryKey: ["work_tasks", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWorkTasksForVineyard(selectedVineyardId!, paddockIds),
  });
  const workTaskLabelById = useMemo(() => {
    const m = new Map<string, string>();
    (workTasksResult?.tasks ?? []).forEach((t) => {
      const lbl = workTaskShortLabel(t);
      if (lbl) m.set(t.id, lbl);
    });
    return m;
  }, [workTasksResult]);


  // Tractors + fuel purchases (page-level) so CSV export can include fuel
  // estimate columns for every row without needing to open each trip.
  const canSeeCostsPage = useCanSeeCosts();
  const { data: pageTractors = [] } = useQuery({
    queryKey: ["trips-page-tractors", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<TractorLite>("tractors", selectedVineyardId!),
  });
  const { data: pageMachines = [] } = useQuery<VineyardMachine[]>({
    queryKey: ["trips-page-machines", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchAllVineyardMachines(selectedVineyardId!),
  });
  const { data: pageFuel = [] } = useQuery({
    queryKey: ["trips-page-fuel", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      try { return await fetchFuelPurchasesForVineyard(selectedVineyardId!); }
      catch { return []; }
    },
  });
  const pageTractorById = useMemo(() => {
    const m = new Map<string, TractorLite>();
    (pageTractors ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [pageTractors]);
  const pageMachinesById = useMemo(() => {
    const m = new Map<string, VineyardMachine>();
    (pageMachines ?? []).forEach((x) => m.set(x.id, x));
    return m;
  }, [pageMachines]);

  const trips = data?.trips ?? [];


  // Dev-only diagnostic: surface unknown trip_function raw values so we can
  // keep the portal label map aligned with new Rork/iOS values.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!trips.length) return;
    const unknown = new Map<string, number>();
    trips.forEach((t) => {
      const fn = t.trip_function;
      if (!fn) return;
      if (!Object.prototype.hasOwnProperty.call(TRIP_FUNCTION_LABELS, fn)) {
        unknown.set(fn, (unknown.get(fn) ?? 0) + 1);
      }
    });
    if (unknown.size) {
      // eslint-disable-next-line no-console
      console.warn("[trips/trip_function] unknown values not in label map", Object.fromEntries(unknown));
    }
  }, [trips]);


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

  const TRIPS_COLS = ["start","name","function","paddock","pattern","person","duration","distance","status"] as const;
  type TripsCol = (typeof TRIPS_COLS)[number];
  const { order: tripsOrder, moveColumn: tripsMove, reset: tripsReset } = useColumnOrder(
    "trips_table",
    TRIPS_COLS as unknown as string[],
    { vineyardId: selectedVineyardId },
  );

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Trips</h1>
          <p className="text-sm text-muted-foreground">
            Read-only. Soft-deleted trips are excluded.
          </p>
          {!isLoading && !error && (
            <p className="text-xs text-muted-foreground">
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
          className="rounded-lg"
          disabled={rows.length === 0}
          onClick={() => {
            const csvRows = rows.map((t) => {
              const padName = t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? null : null);
              const resolved = resolveMachineForRecord(
                { machine_id: t.machine_id, tractor_id: t.tractor_id },
                pageMachinesById,
                pageTractorById,
              );
              const tractorShape: TractorLite | null = resolved.id
                ? { id: resolved.id, name: resolved.name, fuel_usage_l_per_hour: resolved.fuel_l_per_hour }
                : null;
              const fe = computeFuelEstimate(t, tractorShape, canSeeCostsPage ? (pageFuel ?? []) : []);
              return tripToCsvRow(
                t,
                padName,
                tripDisplayName(t),
                tripFunctionLabel(t.trip_function),
                null,
                resolved.id ? resolved.name : null,
                {
                  basisLabel: fe.basisLabel,
                  basis: fe.basis,
                  engineHourDelta: fe.engineHourDelta,
                  activeHours: fe.activeHours,
                  litresPerHour: fe.litresPerHour,
                  litres: fe.litres,
                  costPerLitre: canSeeCostsPage ? fe.costPerLitre : null,
                  cost: canSeeCostsPage ? fe.cost : null,
                  warnings: fe.warnings,
                },
              );
            });
            downloadCsv(`trips_${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(csvRows));
          }}
        >
          Export CSV
        </Button>
      </div>


      <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/30 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
        Production data — read-only view. No edits, archives, or deletions are possible from this page.
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-end gap-3">
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
              {patterns.map((o) => (<SelectItem key={o} value={o}>{formatTripPatternLabel(o)}</SelectItem>))}
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

      <div className="flex justify-end">
        <ColumnSettingsMenu onReset={tripsReset} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {(tripsOrder as TripsCol[]).map((id) => {
                const labels: Record<TripsCol, string> = {
                  start: "Start", name: "Name", function: "Function", paddock: "Paddock",
                  pattern: "Pattern", person: "Person", duration: "Duration", distance: "Distance", status: "Status",
                };
                const sk: any = id;
                return (
                  <ReorderableHead key={id} columnId={id} onDropColumn={tripsMove}
                    sort={{ active: getSortDirection(sk), onSort: () => toggleSort(sk) }}>
                    {labels[id]}
                  </ReorderableHead>
                );
              })}
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
              const cellMap: Record<TripsCol, React.ReactNode> = {
                start: <TableCell>{fmtDate(t.start_time)}</TableCell>,
                name: <TableCell className="font-medium">{tripDisplayName(t)}</TableCell>,
                function: <TableCell>{fnLabel ? <Badge variant="outline">{fnLabel}</Badge> : "—"}</TableCell>,
                paddock: <TableCell>{fmt(padName)}</TableCell>,
                pattern: <TableCell>{t.tracking_pattern ? <Badge variant="secondary">{formatTripPatternLabel(t.tracking_pattern)}</Badge> : "—"}</TableCell>,
                person: <TableCell>{fmt(t.person_name)}</TableCell>,
                duration: <TableCell>{fmtDuration(t.start_time, t.end_time)}</TableCell>,
                distance: <TableCell>{fmtKm(t.total_distance)}</TableCell>,
                status: (
                  <TableCell>
                    {s === "active" ? <Badge>Active</Badge> :
                     s === "paused" ? <Badge variant="outline">Paused</Badge> :
                     <Badge variant="secondary">Completed</Badge>}
                  </TableCell>
                ),
              };
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                  {(tripsOrder as TripsCol[]).map((id) => <Fragment key={id}>{cellMap[id]}</Fragment>)}
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
        vineyardId={selectedVineyardId}
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
  vineyardId,
  open,
  onOpenChange,
}: {
  trip: Trip | null;
  paddockNameById: Map<string, string | null>;
  vineyardName: string | null;
  vineyardId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: vineyardLogoUrl } = useVineyardLogo();
  const formatters = useRegionFormatters();
  const canSeeCosts = useCanSeeCosts();
  const padName = trip?.paddock_name ?? (trip?.paddock_id ? paddockNameById.get(trip.paddock_id) ?? null : null);
  const points = arrayLen(trip?.path_points);
  const completed = arrayLen(trip?.completed_paths);
  const skipped = arrayLen(trip?.skipped_paths);
  const pins = arrayLen(trip?.pin_ids);
  const corrections = trip ? parseCorrections(trip.manual_correction_events) : [];
  const seeding = trip ? parseSeeding(trip.seeding_details) : null;
  const cov = trip ? summarizeCoverage(trip) : null;

  // Cost Summary inputs (owner/manager only) — only fetch when allowed.
  const costEnabled = !!trip && canSeeCosts && !!vineyardId;
  const { data: costCategories } = useQuery({
    queryKey: ["cost-categories", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchOperatorCategoriesForVineyard(vineyardId!),
  });
  const { data: costMembers } = useQuery({
    queryKey: ["cost-members", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchVineyardMembersWithCategory(vineyardId!),
  });
  const { data: costFuel } = useQuery({
    queryKey: ["cost-fuel", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchFuelPurchasesForVineyard(vineyardId!),
  });
  const { data: costSpray } = useQuery({
    queryKey: ["cost-spray", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSprayRecordsForVineyard(vineyardId!),
  });
  const { data: costTractors } = useQuery({
    queryKey: ["cost-tractors", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchList<TractorLite>("tractors", vineyardId!),
  });
  const { data: costSavedChemicals } = useQuery({
    queryKey: ["cost-saved-chemicals", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSavedChemicalsForVineyard(vineyardId!),
  });
  const { data: costSavedInputs } = useQuery({
    queryKey: ["cost-saved-inputs", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSavedInputsForVineyard(vineyardId!),
  });
  const { data: costPaddocks } = useQuery({
    queryKey: ["cost-paddocks-geo", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchList<{ id: string; name: string | null; polygon_points?: any }>("paddocks", vineyardId!),
  });
  const { data: costYields } = useQuery({
    queryKey: ["cost-yields", vineyardId],
    enabled: costEnabled,
    queryFn: () => fetchYieldReportsForVineyard(vineyardId!),
  });

  // Tractors for the Fuel estimate section (visible to all users — non-sensitive).
  const fuelEnabled = !!trip && !!vineyardId;
  const { data: allTractors } = useQuery({
    queryKey: ["trip-tractors", vineyardId],
    enabled: fuelEnabled,
    queryFn: () => fetchList<TractorLite>("tractors", vineyardId!),
  });
  // Fuel purchases for cost/L — may RLS to owner/manager only; failures
  // bubble up as no rows which we render as "cost unavailable".
  const { data: allFuel } = useQuery({
    queryKey: ["trip-fuel-purchases", vineyardId],
    enabled: fuelEnabled,
    queryFn: async () => {
      try { return await fetchFuelPurchasesForVineyard(vineyardId!); }
      catch { return []; }
    },
  });

  const { data: allMachines = [] } = useQuery<VineyardMachine[]>({
    queryKey: ["trip-machines", vineyardId],
    enabled: fuelEnabled,
    queryFn: () => fetchAllVineyardMachines(vineyardId!),
  });

  const allMachinesById = useMemo(() => {
    const m = new Map<string, VineyardMachine>();
    (allMachines ?? []).forEach((x) => m.set(x.id, x));
    return m;
  }, [allMachines]);
  const allTractorsById = useMemo(() => {
    const m = new Map<string, TractorLite>();
    (allTractors ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [allTractors]);

  const resolvedMachine = useMemo(() => {
    if (!trip) return null;
    return resolveMachineForRecord(
      { machine_id: trip.machine_id, tractor_id: trip.tractor_id },
      allMachinesById,
      allTractorsById,
    );
  }, [trip, allMachinesById, allTractorsById]);

  const fuelEstimate = useMemo(() => {
    if (!trip || !resolvedMachine || resolvedMachine.source === "none") return null;
    const tractorShape: TractorLite = {
      id: resolvedMachine.id ?? "",
      name: resolvedMachine.name,
      fuel_usage_l_per_hour: resolvedMachine.fuel_l_per_hour,
    };
    return computeFuelEstimate(trip, tractorShape, allFuel ?? []);
  }, [trip, resolvedMachine, allFuel]);

  const tractorName = resolvedMachine?.name ?? null;

  const cost = useMemo(() => {
    if (!trip || !canSeeCosts) return null;
    const tractor = trip.tractor_id ? (costTractors ?? []).find((t) => t.id === trip.tractor_id) ?? null : null;
    return computeTripCost({
      trip,
      tractor,
      operatorCategories: costCategories?.categories ?? [],
      members: costMembers ?? [],
      fuelPurchases: costFuel ?? [],
      sprayRecords: costSpray?.records ?? [],
      savedChemicals: costSavedChemicals?.chemicals ?? [],
      savedInputs: costSavedInputs?.inputs ?? [],
      paddocks: costPaddocks ?? [],
      historicalYields: costYields?.historical ?? [],
    });
  }, [trip, canSeeCosts, costTractors, costCategories, costMembers, costFuel, costSpray, costSavedChemicals, costSavedInputs, costPaddocks, costYields]);

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
                onClick={async () => {
                  const pinCount = await countTripPins(trip);
                  await downloadTripPdf(trip, {
                    paddockName: padName ?? null,
                    tripDisplay: tripDisplayName(trip),
                    tripFunctionLabel: tripFunctionLabel(trip.trip_function),
                    vineyardName,
                    blockNames,
                    pinCount,
                    vineyardLogoUrl: vineyardLogoUrl ?? null,
                    paddockNameById,
                    cost: canSeeCosts ? cost : null,
                    formatters,
                  });
                }}
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
              <Field label={formatters.blockLabel} value={fmt(padName)} />
              <Field label="Pattern" value={trip.tracking_pattern ? formatTripPatternLabel(trip.tracking_pattern) : "—"} />
              <Field label="Person" value={fmt(trip.person_name)} />
            </Section>
            {fuelEstimate && (
              <Section title="Fuel estimate">
                <Field label="Machine" value={fmt(tractorName)} />
                <Field label="Trip function" value={fmt(tripFunctionLabel(trip.trip_function))} />
                <Field label="Basis" value={fuelEstimate.basisLabel} />
                {fuelEstimate.basis === "engine_hours" && (
                  <Field
                    label="Engine hour delta"
                    value={fuelEstimate.engineHourDelta != null ? `${fuelEstimate.engineHourDelta.toFixed(2)} hr` : "—"}
                  />
                )}
                {fuelEstimate.basis !== "engine_hours" && (
                  <Field label="Active hours" value={fmtHours(fuelEstimate.activeHours)} />
                )}
                <Field
                  label="Fuel rate"
                  value={
                    fuelEstimate.rateMissing
                      ? "Fuel rate missing"
                      : fuelEstimate.litresPerHour != null
                        ? `${fuelEstimate.litresPerHour.toFixed(2)} L/hr`
                        : "—"
                  }
                />
                <Field
                  label="Estimated litres"
                  value={fuelEstimate.litres != null ? `${fuelEstimate.litres.toFixed(1)} L` : "—"}
                />
                {canSeeCosts && (
                  <>
                    <Field
                      label="Fuel cost/L"
                      value={fuelEstimate.costPerLitre != null ? `${fmtCurrency(fuelEstimate.costPerLitre)}/L` : "Unavailable"}
                    />
                    <Field
                      label="Estimated fuel cost"
                      value={fuelEstimate.cost != null ? fmtCurrency(fuelEstimate.cost) : "Unavailable"}
                    />
                  </>
                )}
                {fuelEstimate.warnings.length > 0 && (
                  <div className="mt-2 rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {fuelEstimate.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                    </ul>
                  </div>
                )}
              </Section>
            )}
            {canSeeCosts && cost && (
              <Section title="Estimated trip cost">
                <Field label="Active hours" value={fmtHours(cost.activeHours)} />
                <Field
                  label={`Labour${cost.labour.categoryName ? ` (${cost.labour.categoryName})` : ""}`}
                  value={
                    cost.labour.cost != null
                      ? `${fmtCurrency(cost.labour.cost)}${cost.labour.ratePerHour != null ? ` · ${fmtCurrency(cost.labour.ratePerHour)}/h` : ""}`
                      : "—"
                  }
                />
                <Field
                  label={`Fuel${cost.fuel.basisLabel ? ` (${cost.fuel.basisLabel})` : ""}`}
                  value={
                    cost.fuel.rateMissing
                      ? "Fuel rate missing"
                      : cost.fuel.litres == null
                        ? "—"
                        : `${cost.fuel.litres.toFixed(1)} L${cost.fuel.cost != null ? ` · ${fmtCurrency(cost.fuel.cost)}` : " · cost unavailable"}${cost.fuel.costPerLitre != null ? ` @ ${fmtCurrency(cost.fuel.costPerLitre)}/L` : ""}`
                  }
                />
                {cost.fuel.basis === "engine_hours" && cost.fuel.engineHourDelta != null && (
                  <Field label="Engine hour delta" value={`${cost.fuel.engineHourDelta.toFixed(2)} hr`} />
                )}
                {cost.fuel.basis === "trip_duration" && cost.fuel.hours != null && (
                  <Field label="Active hours (fuel)" value={fmtHours(cost.fuel.hours)} />
                )}
                {cost.fuel.litresPerHour != null && cost.fuel.litresPerHour > 0 && (
                  <Field label="Fuel rate" value={`${cost.fuel.litresPerHour.toFixed(2)} L/hr`} />
                )}
                <Field
                  label={`Chemicals${cost.chemicals.lineCount ? ` (${cost.chemicals.lineCount} line${cost.chemicals.lineCount === 1 ? "" : "s"})` : ""}`}
                  value={cost.chemicals.cost != null ? fmtCurrency(cost.chemicals.cost) : "—"}
                />
                {cost.inputs.lineCount > 0 && (
                  <Field
                    label={`Seed / inputs (${cost.inputs.lineCount} line${cost.inputs.lineCount === 1 ? "" : "s"})`}
                    value={cost.inputs.cost != null ? fmtCurrency(cost.inputs.cost) : "—"}
                  />
                )}
                <div className="border-t my-2" />
                <Field label="Estimated total" value={cost.total != null ? fmtCurrency(cost.total) : "—"} />
                <Field label="Treated area" value={cost.treatedAreaHa != null ? formatters.area(cost.treatedAreaHa) : "—"} />
                <Field label={`Cost per ${formatters.areaUnitLabel}`} value={cost.costPerHa != null ? `${fmtCurrency(formatters.areaUnitLabel === "ac" ? cost.costPerHa * 0.40468564224 : cost.costPerHa)} / ${formatters.areaUnitLabel}` : "Unavailable"} />
                <Field label="Yield tonnes" value={cost.yieldTonnes != null ? fmtTonnes(cost.yieldTonnes) : "Unavailable"} />
                <Field label="Cost per tonne" value={cost.costPerTonne != null ? `${fmtCurrency(cost.costPerTonne)} / t` : "Unavailable"} />
                {cost.warnings.length > 0 && (
                  <div className="mt-2 rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <div className="font-medium mb-1">Missing data</div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {cost.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                    </ul>
                  </div>
                )}
              </Section>
            )}
            <Section title="Rows / paths">
              <Field label="Rows covered" value={String(cov?.rowsCovered ?? 0)} />
              <Field label="Completed" value={String(cov?.completed ?? completed)} />
              <Field label="Partial" value={String(cov?.partial ?? 0)} />
              <Field label="Skipped" value={String(cov?.skipped ?? skipped)} />
              <Field label="Manually marked complete" value={String(cov?.manuallyMarkedComplete ?? 0)} />
              <Field label="Total distance" value={trip.total_distance == null ? "—" : formatters.distance(Number(trip.total_distance) / 1000, 2)} />
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
