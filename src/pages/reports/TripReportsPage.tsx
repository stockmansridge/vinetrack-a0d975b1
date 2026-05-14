// Trip Reports — central reporting page for all trip/job types
// (Maintenance, Spray, Seeding, Mowing, Harrowing, Canopy Work, Custom, …).
// Reuses the existing Trip Report PDF (downloadTripPdf) so output style
// matches the per-trip export from the Trips page.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, FileSpreadsheet, FileText, Info, Search, ChevronDown, ChevronRight, Check, X, StickyNote } from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { fetchList } from "@/lib/queries";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import { countTripPins } from "@/lib/tripPinCount";
import {
  downloadTripPdf,
  tripToCsvRow,
  rowsToCsv,
  downloadCsv,
} from "@/lib/tripReport";
import { useVineyardLogo } from "@/hooks/useVineyardLogo";
import { useCanSeeCosts } from "@/lib/permissions";
import { computeTripCost, type TractorLite } from "@/lib/tripCosting";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import { fetchVineyardMembersWithCategory } from "@/lib/teamMembersQuery";
import { fetchFuelPurchasesForVineyard } from "@/lib/fuelPurchasesQuery";
import { fetchSprayRecordsForVineyard } from "@/lib/sprayRecordsQuery";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { fetchSavedInputsForVineyard } from "@/lib/savedInputsQuery";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface PaddockLite { id: string; name: string | null }

const ANY = "__any__";
const MAINT = "__maint__";

// All known trip functions (matches TripsPage). "Maintenance" is a virtual
// bucket covering every non-spray function.
const TRIP_FUNCTION_LABELS: Record<string, string> = {
  spraying: "Spray",
  seeding: "Seeding",
  mowing: "Mowing",
  slashing: "Slashing",
  mulching: "Mulching",
  harrowing: "Harrowing",
  spreading: "Spreading",
  fertiliser: "Fertiliser",
  fertilising: "Fertilising",
  undervineWeeding: "Undervine weeding",
  interRowCultivation: "Inter-row cultivation",
  pruning: "Pruning",
  shootThinning: "Shoot thinning",
  canopyWork: "Canopy work",
  irrigationCheck: "Irrigation check",
  repairs: "Repairs",
  other: "Custom / Other",
};
const tripFunctionLabel = (v?: string | null) =>
  v ? TRIP_FUNCTION_LABELS[v] ?? v : null;

const tripDisplayName = (t: Trip): string => {
  if (t.trip_title?.trim()) return t.trip_title.trim();
  return tripFunctionLabel(t.trip_function) ?? t.tracking_pattern ?? t.paddock_name ?? "Trip";
};

const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : format(d, "PP");
};
const fmtDuration = (s?: string | null, e?: string | null) => {
  if (!s || !e) return "—";
  const ms = new Date(e).getTime() - new Date(s).getTime();
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

export default function TripReportsPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const { toast } = useToast();
  const { data: vineyardLogoUrl } = useVineyardLogo();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paddockId, setPaddockId] = useState<string>(ANY);
  const [tripFn, setTripFn] = useState<string>(ANY);
  const [operator, setOperator] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("all");

  const applyPeriod = (val: string) => {
    setPeriod(val);
    if (val === "all") { setFrom(""); setTo(""); return; }
    if (val === "custom") return;
    const today = new Date();
    const end = format(today, "yyyy-MM-dd");
    const start = new Date(today);
    if (val === "day") start.setDate(today.getDate() - 1);
    else if (val === "week") start.setDate(today.getDate() - 7);
    else if (val === "month") start.setMonth(today.getMonth() - 1);
    else if (val === "quarter") start.setMonth(today.getMonth() - 3);
    else if (val === "year") start.setFullYear(today.getFullYear() - 1);
    setFrom(format(start, "yyyy-MM-dd"));
    setTo(end);
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });
  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);
  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["trip-reports", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, paddockIds),
  });
  const trips = data?.trips ?? [];

  // Cost inputs — fetched only for owners/managers.
  const canSeeCosts = useCanSeeCosts();
  const costEnabled = !!selectedVineyardId && canSeeCosts;
  const { data: costCategories } = useQuery({
    queryKey: ["cost-categories", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchOperatorCategoriesForVineyard(selectedVineyardId!),
  });
  const { data: costMembers } = useQuery({
    queryKey: ["cost-members", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchVineyardMembersWithCategory(selectedVineyardId!),
  });
  const { data: costFuel } = useQuery({
    queryKey: ["cost-fuel", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchFuelPurchasesForVineyard(selectedVineyardId!),
  });
  const { data: costSpray } = useQuery({
    queryKey: ["cost-spray", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSprayRecordsForVineyard(selectedVineyardId!),
  });
  const { data: costTractors } = useQuery({
    queryKey: ["cost-tractors", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchList<TractorLite>("tractors", selectedVineyardId!),
  });
  const { data: costSavedChemicals } = useQuery({
    queryKey: ["cost-saved-chemicals", selectedVineyardId],
    enabled: costEnabled,
    queryFn: () => fetchSavedChemicalsForVineyard(selectedVineyardId!),
  });

  const computeCostFor = (t: Trip) => {
    if (!canSeeCosts) return null;
    const tractor = t.tractor_id ? (costTractors ?? []).find((x) => x.id === t.tractor_id) ?? null : null;
    return computeTripCost({
      trip: t,
      tractor,
      operatorCategories: costCategories?.categories ?? [],
      members: costMembers ?? [],
      fuelPurchases: costFuel ?? [],
      sprayRecords: costSpray?.records ?? [],
      savedChemicals: costSavedChemicals?.chemicals ?? [],
    });
  };

  const operators = useMemo(() => {
    const s = new Set<string>();
    trips.forEach((t) => t.person_name && s.add(t.person_name));
    return Array.from(s).sort();
  }, [trips]);

  const rows = useMemo(() => {
    let list = trips.slice();
    list.sort((a, b) =>
      (b.start_time ?? b.created_at ?? "").localeCompare(a.start_time ?? a.created_at ?? ""),
    );
    if (from) list = list.filter((t) => (t.start_time ?? "") >= from);
    if (to) list = list.filter((t) => (t.start_time ?? "") <= to + "T23:59:59");
    if (paddockId !== ANY) {
      list = list.filter((t) => {
        if (t.paddock_id === paddockId) return true;
        if (Array.isArray(t.paddock_ids)) return (t.paddock_ids as string[]).includes(paddockId);
        return false;
      });
    }
    if (tripFn === MAINT) {
      list = list.filter((t) => t.trip_function && t.trip_function !== "spraying");
    } else if (tripFn !== ANY) {
      list = list.filter((t) => t.trip_function === tripFn);
    }
    if (operator !== ANY) list = list.filter((t) => t.person_name === operator);
    if (status !== ANY) list = list.filter((t) => tripStatus(t) === status);
    if (search.trim()) {
      const f = search.toLowerCase();
      list = list.filter((t) =>
        [t.trip_title, tripFunctionLabel(t.trip_function), t.paddock_name, t.tracking_pattern, t.person_name]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [trips, search, from, to, paddockId, tripFn, operator, status]);

  const blockNamesFor = (t: Trip): string[] => {
    const ids = Array.isArray(t.paddock_ids) ? (t.paddock_ids as string[]) : t.paddock_id ? [t.paddock_id] : [];
    return ids.map((id) => paddockNameById.get(id) ?? null).filter((v): v is string => !!v);
  };
  const padNameFor = (t: Trip): string | null => {
    const names = blockNamesFor(t);
    if (names.length === 1) return names[0];
    if (names.length > 1) return `${names.length} blocks`;
    return t.paddock_name ?? null;
  };

  const handleExportPdf = async (t: Trip) => {
    setExportingId(t.id);
    try {
      const pinCount = await countTripPins(t);
      await downloadTripPdf(t, {
        paddockName: padNameFor(t),
        tripDisplay: tripDisplayName(t),
        tripFunctionLabel: tripFunctionLabel(t.trip_function),
        vineyardName,
        blockNames: blockNamesFor(t),
        pinCount,
        vineyardLogoUrl: vineyardLogoUrl ?? null,
        cost: computeCostFor(t),
      });
    } catch (e: any) {
      toast({ title: "PDF export failed", description: e.message, variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  const handleExportCsv = () => {
    if (!rows.length) return;
    const csvRows = rows.map((t) =>
      tripToCsvRow(
        t,
        padNameFor(t),
        tripDisplayName(t),
        tripFunctionLabel(t.trip_function),
        computeCostFor(t),
      ),
    );
    downloadCsv(`TripReports_${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(csvRows));
  };

  if (!selectedVineyardId) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center space-y-2">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="font-medium">No vineyard selected</div>
          <p className="text-sm text-muted-foreground">
            Pick a vineyard from the switcher to view Trip Reports.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-semibold">Trip Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Export per-trip reports (PDF) for every trip type — Maintenance, Spray, Seeding,
          Mowing, Harrowing, Canopy Work and Custom jobs. Each PDF includes trip details,
          rows/paths covered, pins logged, route map and VineTrack branding.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Period</div>
            <Select value={period} onValueChange={applyPeriod}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="day">Past day</SelectItem>
                <SelectItem value="week">Past week</SelectItem>
                <SelectItem value="month">Past month</SelectItem>
                <SelectItem value="quarter">Past 3 months</SelectItem>
                <SelectItem value="year">Past year</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">From</div>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPeriod("custom"); }} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">To</div>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPeriod("custom"); }} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Trip type</div>
            <Select value={tripFn} onValueChange={setTripFn}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All trip types</SelectItem>
                <SelectItem value={MAINT}>Maintenance (all non-spray)</SelectItem>
                {Object.entries(TRIP_FUNCTION_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Block / paddock</div>
            <Select value={paddockId} onValueChange={setPaddockId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All blocks</SelectItem>
                {paddocks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Operator</div>
            <Select value={operator} onValueChange={setOperator}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All operators</SelectItem>
                {operators.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Status</div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
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
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Title, block, operator…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-64"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-xs text-muted-foreground">
            {rows.length} of {trips.length} trip{trips.length === 1 ? "" : "s"}
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!rows.length}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export filtered (CSV)
          </Button>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Date</TableHead>
              <TableHead>Trip type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Block</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Distance</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Report</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={11} className="text-center text-destructive py-8">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  No trips match the current filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const fnLabel = tripFunctionLabel(t.trip_function);
              const s = tripStatus(t);
              const isOpen = expanded.has(t.id);
              const summary = summariseRows(t);
              return (
                <Fragment key={t.id}>
                  <TableRow>
                    <TableCell className="p-0 pl-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => toggleExpand(t.id)}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                    <TableCell>{fmtDay(t.start_time)}</TableCell>
                    <TableCell>{fnLabel ? <Badge variant="outline">{fnLabel}</Badge> : "—"}</TableCell>
                    <TableCell className="font-medium">{tripDisplayName(t)}</TableCell>
                    <TableCell>{padNameFor(t) ?? "—"}</TableCell>
                    <TableCell>{t.person_name ?? "—"}</TableCell>
                    <TableCell>{fmtDuration(t.start_time, t.end_time)}</TableCell>
                    <TableCell>{fmtKm(t.total_distance)}</TableCell>
                    <TableCell className="text-xs">
                      {summary.total > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Check className="h-3 w-3 text-green-600" />{summary.completed}
                          <X className="h-3 w-3 text-red-600 ml-1" />{summary.skipped}
                          <span className="text-muted-foreground ml-1">/ {summary.total}</span>
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {s === "active" ? <Badge>Active</Badge> :
                       s === "paused" ? <Badge variant="outline">Paused</Badge> :
                       <Badge variant="secondary">Completed</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleExportPdf(t)}
                        disabled={exportingId === t.id}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {exportingId === t.id ? "Generating…" : "PDF"}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={10} className="py-3">
                        <RowCompletionDetail trip={t} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4 bg-muted/30 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            Trip Reports cover every trip/job type recorded in VineTrack. Each PDF
            includes Trip Details, Rows / Paths, Pins, Route Map and a VineTrack
            footer.
          </div>
          <div>
            For spray-specific compliance reports (chemicals, rates, WHP/REI, tank mix)
            and yearly spray programs, use <strong>Spray Records</strong>.
          </div>
        </div>
      </Card>
    </div>
  );
}

// --- Row completion helpers ---------------------------------------------

interface RowEntry {
  label: string;
  completed: boolean;
  skipped: boolean;
  manual?: boolean;
}

function asArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function rowKey(item: any): string | null {
  if (item == null) return null;
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (typeof item === "object") {
    return String(
      item.id ?? item.row ?? item.row_number ?? item.rowNumber ?? item.index ?? item.path_id ?? item.pathId ?? "",
    ) || null;
  }
  return null;
}

function rowLabel(item: any): string {
  if (item == null) return "—";
  if (typeof item === "string" || typeof item === "number") return `Row ${item}`;
  if (typeof item === "object") {
    if (item.row_number != null) return `Row ${item.row_number}`;
    if (item.rowNumber != null) return `Row ${item.rowNumber}`;
    if (item.row != null) return `Row ${item.row}`;
    if (item.label) return String(item.label);
    if (item.name) return String(item.name);
    if (item.id) return `Path ${String(item.id).slice(0, 6)}`;
  }
  return "—";
}

function buildRowEntries(t: Trip): RowEntry[] {
  const seq = asArray(t.row_sequence);
  const completed = asArray(t.completed_paths);
  const skipped = asArray(t.skipped_paths);
  const manualEvents = Array.isArray(t.manual_correction_events)
    ? new Set(t.manual_correction_events.map(String))
    : new Set<string>();

  const completedKeys = new Set(completed.map(rowKey).filter(Boolean) as string[]);
  const skippedKeys = new Set(skipped.map(rowKey).filter(Boolean) as string[]);

  const base = seq.length ? seq : [...completed, ...skipped];
  const seen = new Set<string>();
  const entries: RowEntry[] = [];
  base.forEach((item) => {
    const k = rowKey(item) ?? `${entries.length}`;
    if (seen.has(k)) return;
    seen.add(k);
    entries.push({
      label: rowLabel(item),
      completed: completedKeys.has(k),
      skipped: skippedKeys.has(k),
      manual: manualEvents.has(k),
    });
  });
  return entries;
}

function summariseRows(t: Trip) {
  const entries = buildRowEntries(t);
  return {
    total: entries.length,
    completed: entries.filter((e) => e.completed).length,
    skipped: entries.filter((e) => e.skipped).length,
  };
}

function RowCompletionDetail({ trip }: { trip: Trip }) {
  const entries = buildRowEntries(trip);
  // Opportunistically read completion notes if the iOS app has synced them.
  const notes =
    (trip as any).completion_notes ??
    (trip as any).notes ??
    (trip as any).job_notes ??
    null;

  return (
    <div className="space-y-3">
      {notes && (
        <div className="flex items-start gap-2 text-xs">
          <StickyNote className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
          <div>
            <div className="font-medium text-foreground">Completion notes</div>
            <div className="text-muted-foreground whitespace-pre-wrap">{String(notes)}</div>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No row sequence recorded for this trip.
        </div>
      ) : (
        <div>
          <div className="text-xs font-medium mb-2">Row completion</div>
          <div className="flex flex-wrap gap-1.5">
            {entries.map((e, i) => {
              const status = e.completed ? "completed" : e.skipped ? "skipped" : "pending";
              return (
                <span
                  key={`${e.label}-${i}`}
                  className={
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] " +
                    (status === "completed"
                      ? "border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-300"
                      : status === "skipped"
                        ? "border-red-600/40 bg-red-500/10 text-red-700 dark:text-red-300"
                        : "border-border text-muted-foreground")
                  }
                  title={`${e.label} — ${status}${e.manual ? " (manual)" : ""}`}
                >
                  {status === "completed" ? (
                    <Check className="h-3 w-3" />
                  ) : status === "skipped" ? (
                    <X className="h-3 w-3" />
                  ) : null}
                  {e.label}
                  {e.manual && (
                    <span className="ml-1 rounded bg-background/60 px-1 text-[9px] uppercase tracking-wide">
                      Manual
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3 text-green-600" /> Completed
            </span>
            <span className="inline-flex items-center gap-1">
              <X className="h-3 w-3 text-red-600" /> Not completed / skipped
            </span>
            <span>Auto/Manual shown where the iOS app records a manual correction.</span>
          </div>
        </div>
      )}
    </div>
  );
}
