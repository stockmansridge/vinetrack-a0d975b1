import { VINTAGE_OPTIONS_KEY } from "@/lib/availableVintages";
import { useMemo, useState, useEffect, useRef, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { fetchList } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { fetchTripsForVineyard, softDeleteTrip, describeTripDeleteError, completeTrip, describeTripCompleteError, updateTripTitle, describeTripTitleError, type Trip } from "@/lib/tripsQuery";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { fetchWorkTasksForVineyard, workTaskShortLabel } from "@/lib/workTasksQuery";
import { Button } from "@/components/ui/button";
import TripDetailSheet from "@/components/trips/TripDetailSheet";
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
import { isSprayingTrip } from "@/lib/sprayReportV1";
import SprayTripWorksheet from "@/components/spray/SprayTripWorksheet";
import EditTripDetailsDialog from "@/components/trips/EditTripDetailsDialog";

import { downloadSprayReport } from "@/lib/sprayReportExport";
import { useSprayLinkedTripIds } from "@/lib/sprayLinkedTrips";

import { useVineyardLogo } from "@/hooks/useVineyardLogo";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { countTripPins } from "@/lib/tripPinCount";
import { useCanSeeCosts } from "@/lib/permissions";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import { fetchVineyardMembersWithCategory } from "@/lib/teamMembersQuery";
import { fetchFuelPurchasesForVineyard } from "@/lib/fuelPurchasesQuery";
import { fetchSprayRecordsForVineyard } from "@/lib/sprayRecordsQuery";
import { useTripChemicalCosting } from "@/lib/useTripChemicalCosting";
import { formatTripChemicalCost } from "@/lib/chemicalCostResolver";
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
import { tripFunctionBadgeClass, tripFunctionDotClass } from "@/lib/tripFunctionColor";
import { useVintageFilter } from "@/hooks/useVintageFilter";
import { VintageSelect } from "@/components/VintageSelect";
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

  const vintageFilter = useVintageFilter({ table: "trips", dateColumn: "start_time" });
  const vintageScopeValue = vintageFilter.scope;

  const { data, isLoading, error } = useQuery({
    queryKey: ["trips", selectedVineyardId, paddockIds.length, vintageFilter.vintage ?? "all"],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, paddockIds, vintageScopeValue),
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
      list = list.filter((t) => {
        const taskLbl = t.work_task_id ? workTaskLabelById.get(t.work_task_id) ?? "" : "";
        return [t.trip_title, tripFunctionLabel(t.trip_function), t.paddock_name, t.tracking_pattern, t.person_name, taskLbl]
          .some((v) => String(v ?? "").toLowerCase().includes(f));
      });
    }
    return list;
  }, [trips, filter, from, to, paddockId, pattern, status, tripFn, workTaskLabelById]);

  type TripSortKey = "name" | "start" | "function" | "paddock" | "pattern" | "person" | "duration" | "distance" | "status";
  const durationMs = (s?: string | null, e?: string | null) => {
    if (!s || !e) return null;
    const ms = new Date(e).getTime() - new Date(s).getTime();
    return isNaN(ms) || ms < 0 ? null : ms;
  };
  const { sorted: rowsSorted, getSortDirection, toggleSort } = useSortableTable<typeof rows[number], TripSortKey>(rows, {
    accessors: {
      name: (t) => tripDisplayName(t),
      start: (t) => (t.start_time ? new Date(t.start_time) : null),
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

  const TRIPS_COLS = ["name","start","function","paddock","pattern","person","duration","distance","status"] as const;
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
      <div className="flex flex-col items-start gap-4">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Trips</h1>
          <p className="text-sm text-muted-foreground">
            Review vineyard work completed using a tractor, vehicle or other machinery during a tracked trip. Field trips record where equipment travelled, the blocks and rows worked, operating time, distance, operator and associated job details.
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
                t.work_task_id ? workTaskLabelById.get(t.work_task_id) ?? "Task linked" : null,
              );
            });
            downloadCsv(`trips_${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(csvRows));
          }}
        >
          Export CSV
        </Button>
      </div>



      <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-end gap-3">
        <VintageSelect
          vintage={vintageFilter.vintage}
          options={vintageFilter.options}
          onChange={vintageFilter.setVintage}
        />
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">From</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">To</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Block</div>
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
                <SelectItem key={k} value={k}>
                  <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${tripFunctionDotClass(k)}`} />
                  {v}
                </SelectItem>
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
            placeholder="Block, pattern, person…"
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
                  name: "Name", start: "Start", function: "Function", paddock: "Block",
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
                name: (
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{tripDisplayName(t)}</span>
                      {t.work_task_id && (
                        <Badge variant="outline" className="w-fit text-[10px] font-normal">
                          {workTaskLabelById.get(t.work_task_id) ?? "Task linked"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                ),
                start: <TableCell>{fmtDate(t.start_time)}</TableCell>,
                function: <TableCell>{fnLabel ? <Badge variant="outline" className={tripFunctionBadgeClass(t.trip_function)}>{fnLabel}</Badge> : "—"}</TableCell>,
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

      <TripDetailSheet
        trip={selected}
        paddockNameById={paddockNameById}
        workTaskLabelById={workTaskLabelById}
        vineyardName={vineyardName}
        vineyardId={selectedVineyardId}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        onTitleSaved={(tripId, tripTitle, syncVersion) => {
          setSelected((current) =>
            current?.id === tripId
              ? { ...current, trip_title: tripTitle, sync_version: syncVersion }
              : current,
          );
        }}
      />
    </div>
  );
}

