// Work Task Reports — task-level roll-up report (Stage 5B).
//
// Read-only. Reuses the same roll-up formula already implemented in the
// Work Task drawer (WorkTasksPage → WorkTaskSummarySection):
//
//   manualLabourCost  = Σ work_task_labour_lines.total_cost
//   manualLabourHours = Σ work_task_labour_lines.total_hours
//   machineCharge     = Σ work_task_machine_lines.total_machine_cost
//   machineFuel       = Σ work_task_machine_lines.fuel_cost
//   manualMachineTotal = machineCharge + machineFuel
//   machineHours      = Σ duration_hours (fallback engine_hours_used)
//   linkedTripTotal   = Σ trip_cost_allocations.total_cost (joined by trip_id
//                       to trips.work_task_id = task.id)
//   linkedTripCount   = number of linked trips
//   total             = manualLabourCost + manualMachineTotal + linkedTripTotal
//
// Cost columns and dollar amounts are gated by useCanSeeCosts(). Nothing is
// written back to the database; trip_cost_allocations and Cost Reports totals
// are untouched.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Download, Info, Search, AlertTriangle, ChevronDown, ChevronRight,
} from "lucide-react";

import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { fetchList } from "@/lib/queries";
import {
  fetchWorkTasksForVineyard,
  fetchLabourLinesForVineyard,
  fetchWorkTaskPaddocksForVineyard,
  type WorkTask,
  type WorkTaskLabourLine,
  type WorkTaskPaddock,
} from "@/lib/workTasksQuery";
import {
  fetchWorkTaskMachineLinesForVineyard,
  resolveMachineLineEquipmentName,
  type WorkTaskMachineLine,
  type MachineLineEquipmentLookups,
} from "@/lib/workTaskMachineLinesQuery";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import {
  fetchTripCostAllocationsForVineyard,
  type TripCostAllocation,
} from "@/lib/tripCostAllocationsQuery";
import { useCanSeeCosts } from "@/lib/permissions";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

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
import { Checkbox } from "@/components/ui/checkbox";

interface PaddockLite { id: string; name: string | null }

const ANY = "__any__";
const OVERLAP_SOURCES = new Set(["missed_trip", "trip_failed", "correction"]);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : format(d, "PP");
};

interface TaskRow {
  task: WorkTask;
  date: string | null;
  taskType: string;
  blockNames: string[];
  blocksLabel: string;
  paddockIds: string[];
  totalAreaHa: number | null;
  labourHours: number;
  machineHours: number;
  machineEntries: number;
  linkedTripCount: number;
  manualLabourCost: number;
  machineCharge: number;
  machineFuel: number;
  manualMachineTotal: number;
  linkedTripTotal: number;
  totalCost: number;
  hasLinkedTrips: boolean;
  hasManualMachine: boolean;
  hasWarning: boolean;
  // Source records for the expandable details panel:
  labourLines: WorkTaskLabourLine[];
  machineLines: WorkTaskMachineLine[];
  taskPaddocks: WorkTaskPaddock[];
  trips: Trip[];
}

// Conversion factor used internally for cost-per-area when the vineyard is set
// to acres. Storage stays in hectares; this is display-only.
const HA_PER_AC = 0.40468564224;

export default function WorkTaskReportsPage() {
  const { selectedVineyardId } = useVineyard();
  const { toast } = useToast();
  const canSeeCosts = useCanSeeCosts();
  const fmt = useRegionFormatters();
  const money = (n: number) => fmt.currency(n);
  const areaImperial = fmt.settings.area_unit === "acres";
  const areaUnit = fmt.areaUnitLabel; // "ha" | "ac"
  const costPerAreaLabel = `Cost / ${areaUnit}`;
  const areaDisplay = (haValue: number | null) =>
    haValue == null ? "—" : fmt.area(haValue);
  const costPerAreaDisplay = (totalCost: number, haValue: number | null) => {
    if (!canSeeCosts) return "—";
    if (haValue == null || !(haValue > 0)) return "—";
    if (!Number.isFinite(totalCost)) return "—";
    const perHa = totalCost / haValue;
    const perDisplay = areaImperial ? perHa * HA_PER_AC : perHa;
    return fmt.currency(perDisplay);
  };
  const areaToDisplayUnit = (haValue: number | null): number | null => {
    if (haValue == null) return null;
    return areaImperial ? haValue / HA_PER_AC : haValue;
  };

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [taskType, setTaskType] = useState<string>(ANY);
  const [paddockId, setPaddockId] = useState<string>(ANY);
  const [hasLinked, setHasLinked] = useState<string>(ANY); // any | yes | no
  const [hasManualMachine, setHasManualMachine] = useState<string>(ANY);
  const [warningOnly, setWarningOnly] = useState(false);

  const enabled = !!selectedVineyardId;

  const paddocksQ = useQuery({
    queryKey: ["paddocks", selectedVineyardId],
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
    enabled,
  });
  const paddocks = paddocksQ.data ?? [];
  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);

  const tasksQ = useQuery({
    queryKey: ["work_tasks", selectedVineyardId, paddockIds.length],
    queryFn: () => fetchWorkTasksForVineyard(selectedVineyardId!, paddockIds),
    enabled: enabled && paddocksQ.isSuccess,
  });
  const labourQ = useQuery({
    queryKey: ["work_task_labour_lines", selectedVineyardId],
    queryFn: () => fetchLabourLinesForVineyard(selectedVineyardId!),
    enabled,
  });
  const machineQ = useQuery({
    queryKey: ["work_task_machine_lines", selectedVineyardId],
    queryFn: () => fetchWorkTaskMachineLinesForVineyard(selectedVineyardId!),
    enabled,
  });
  const wtPaddocksQ = useQuery({
    queryKey: ["work_task_paddocks", selectedVineyardId],
    queryFn: () => fetchWorkTaskPaddocksForVineyard(selectedVineyardId!),
    enabled,
  });
  const tripsQ = useQuery({
    queryKey: ["trips", selectedVineyardId, paddockIds.length],
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, paddockIds),
    enabled: enabled && paddocksQ.isSuccess,
  });
  const allocQ = useQuery({
    queryKey: ["trip_cost_allocations", selectedVineyardId],
    queryFn: () => fetchTripCostAllocationsForVineyard(selectedVineyardId!),
    enabled: enabled && canSeeCosts,
  });

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string>();
    paddocks.forEach((p) => m.set(p.id, p.name ?? "—"));
    return m;
  }, [paddocks]);

  const labourByTask = useMemo(() => {
    const m = new Map<string, WorkTaskLabourLine[]>();
    (labourQ.data ?? []).forEach((l) => {
      if (l.deleted_at) return;
      const arr = m.get(l.work_task_id) ?? [];
      arr.push(l);
      m.set(l.work_task_id, arr);
    });
    return m;
  }, [labourQ.data]);

  const machineByTask = useMemo(() => {
    const m = new Map<string, WorkTaskMachineLine[]>();
    (machineQ.data ?? []).forEach((l) => {
      if (l.deleted_at) return;
      const arr = m.get(l.work_task_id) ?? [];
      arr.push(l);
      m.set(l.work_task_id, arr);
    });
    return m;
  }, [machineQ.data]);

  const paddocksByTask = useMemo(() => {
    const m = new Map<string, WorkTaskPaddock[]>();
    (wtPaddocksQ.data ?? []).forEach((r) => {
      if (r.deleted_at) return;
      const arr = m.get(r.work_task_id) ?? [];
      arr.push(r);
      m.set(r.work_task_id, arr);
    });
    return m;
  }, [wtPaddocksQ.data]);

  const tripsByTask = useMemo(() => {
    const m = new Map<string, Trip[]>();
    (tripsQ.data?.trips ?? []).forEach((t) => {
      if (!t.work_task_id) return;
      const arr = m.get(t.work_task_id) ?? [];
      arr.push(t);
      m.set(t.work_task_id, arr);
    });
    return m;
  }, [tripsQ.data]);

  const allocByTripId = useMemo(() => {
    const m = new Map<string, TripCostAllocation[]>();
    (allocQ.data ?? []).forEach((a) => {
      if (!a.trip_id) return;
      const arr = m.get(a.trip_id) ?? [];
      arr.push(a);
      m.set(a.trip_id, arr);
    });
    return m;
  }, [allocQ.data]);

  const rows = useMemo<TaskRow[]>(() => {
    const tasks = tasksQ.data?.tasks ?? [];
    return tasks.map((task) => {
      const labour = labourByTask.get(task.id) ?? [];
      const machine = machineByTask.get(task.id) ?? [];
      const taskPaddocks = paddocksByTask.get(task.id) ?? [];
      const trips = tripsByTask.get(task.id) ?? [];

      const pIds = taskPaddocks.length
        ? taskPaddocks.map((p) => p.paddock_id)
        : task.paddock_id ? [task.paddock_id] : [];
      const blockNames = pIds
        .map((id) => paddockNameById.get(id) ?? null)
        .filter((n): n is string => !!n);
      const blocksLabel = blockNames.length
        ? blockNames.join(", ")
        : (task.paddock_name ?? "—");

      // Area roll-up (hectares, canonical). Prefer work_task_paddocks.area_ha;
      // fall back to the task's own area_ha if none of the paddock rows have a
      // value. Display unit conversion happens at render/export time via
      // useRegionFormatters().
      const paddockAreaSum = taskPaddocks.reduce(
        (s, p) => s + (p.area_ha != null ? num(p.area_ha) : 0), 0,
      );
      const anyPaddockArea = taskPaddocks.some((p) => p.area_ha != null);
      let totalAreaHa: number | null = anyPaddockArea ? paddockAreaSum : null;
      if (totalAreaHa == null && task.area_ha != null) {
        totalAreaHa = num(task.area_ha);
      }
      if (totalAreaHa != null && !(totalAreaHa > 0)) totalAreaHa = null;

      const manualLabourCost = labour.reduce((s, l) => s + num(l.total_cost), 0);
      const labourHours = labour.reduce((s, l) => s + num(l.total_hours), 0);
      const machineCharge = machine.reduce((s, l) => s + num(l.total_machine_cost), 0);
      const machineFuel = machine.reduce((s, l) => s + num(l.fuel_cost), 0);
      const machineHours = machine.reduce(
        (s, l) => s + num(l.duration_hours ?? l.engine_hours_used), 0,
      );
      const manualMachineTotal = machineCharge + machineFuel;

      let linkedTripTotal = 0;
      trips.forEach((t) => {
        (allocByTripId.get(t.id) ?? []).forEach((a) => {
          linkedTripTotal += num(a.total_cost);
        });
      });

      const hasLinkedTrips = trips.length > 0;
      const hasManualMachine = machine.length > 0;
      const overlap = hasLinkedTrips && machine.some((l) =>
        OVERLAP_SOURCES.has(String(l.entry_source ?? "")),
      );

      return {
        task,
        date: task.start_date ?? task.date ?? null,
        taskType: task.task_type ?? "—",
        blockNames,
        blocksLabel,
        paddockIds: pIds,
        totalAreaHa,
        labourHours,
        machineHours,
        machineEntries: machine.length,
        linkedTripCount: trips.length,
        manualLabourCost,
        machineCharge,
        machineFuel,
        manualMachineTotal,
        linkedTripTotal,
        totalCost: manualLabourCost + manualMachineTotal + linkedTripTotal,
        hasLinkedTrips,
        hasManualMachine,
        hasWarning: overlap,
      };
    });
  }, [tasksQ.data, labourByTask, machineByTask, paddocksByTask, tripsByTask, allocByTripId, paddockNameById]);

  const taskTypeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.task.task_type) set.add(r.task.task_type); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 86_399_999 : null;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (fromTs != null || toTs != null) {
        const ts = r.date ? new Date(r.date).getTime() : NaN;
        if (Number.isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      if (taskType !== ANY && r.task.task_type !== taskType) return false;
      if (paddockId !== ANY && !r.paddockIds.includes(paddockId)) return false;
      if (hasLinked === "yes" && !r.hasLinkedTrips) return false;
      if (hasLinked === "no" && r.hasLinkedTrips) return false;
      if (hasManualMachine === "yes" && !r.hasManualMachine) return false;
      if (hasManualMachine === "no" && r.hasManualMachine) return false;
      if (warningOnly && !r.hasWarning) return false;
      if (q) {
        const hay = [
          r.taskType,
          r.blocksLabel,
          r.task.description ?? "",
          r.task.notes ?? "",
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ad = a.date ? new Date(a.date).getTime() : 0;
      const bd = b.date ? new Date(b.date).getTime() : 0;
      return bd - ad;
    });
  }, [rows, search, from, to, taskType, paddockId, hasLinked, hasManualMachine, warningOnly]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        labourHours: acc.labourHours + r.labourHours,
        machineHours: acc.machineHours + r.machineHours,
        totalAreaHa: acc.totalAreaHa + (r.totalAreaHa ?? 0),
        anyArea: acc.anyArea || r.totalAreaHa != null,
        manualLabourCost: acc.manualLabourCost + r.manualLabourCost,
        machineCharge: acc.machineCharge + r.machineCharge,
        machineFuel: acc.machineFuel + r.machineFuel,
        linkedTripTotal: acc.linkedTripTotal + r.linkedTripTotal,
        totalCost: acc.totalCost + r.totalCost,
      }),
      { labourHours: 0, machineHours: 0, totalAreaHa: 0, anyArea: false, manualLabourCost: 0, machineCharge: 0, machineFuel: 0, linkedTripTotal: 0, totalCost: 0 },
    );
  }, [filtered]);

  const csvSafe = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const downloadCsv = () => {
    const baseCols = [
      "Date", "Task type", "Blocks", "Labour hours", "manual_machine_hours",
      "Linked trips", "Machine entries",
      "area_display", "area_unit",
      "Warning",
    ];
    const costCols = [
      "Manual labour cost", "Machine charge", "Machine fuel",
      "Linked GPS trip cost", "Total cost",
      "cost_per_area", "cost_per_area_unit",
    ];
    const header = canSeeCosts ? [...baseCols, ...costCols] : baseCols;
    const lines = [header.map(csvSafe).join(",")];
    filtered.forEach((r) => {
      const areaDisp = areaToDisplayUnit(r.totalAreaHa);
      const perHa = r.totalAreaHa && r.totalAreaHa > 0 ? r.totalCost / r.totalAreaHa : null;
      const perDisp = perHa == null ? null : (areaImperial ? perHa * HA_PER_AC : perHa);
      const base = [
        r.date ?? "",
        r.taskType,
        r.blocksLabel,
        r.labourHours.toFixed(2),
        r.machineHours.toFixed(2),
        r.linkedTripCount,
        r.machineEntries,
        areaDisp == null ? "" : areaDisp.toFixed(2),
        r.totalAreaHa == null ? "" : areaUnit,
        r.hasWarning ? "Review" : "",
      ];
      const costs = canSeeCosts ? [
        r.manualLabourCost.toFixed(2),
        r.machineCharge.toFixed(2),
        r.machineFuel.toFixed(2),
        r.linkedTripTotal.toFixed(2),
        r.totalCost.toFixed(2),
        perDisp == null ? "" : perDisp.toFixed(2),
        perDisp == null ? "" : `${fmt.settings.currency_code}/${areaUnit}`,
      ] : [];
      lines.push([...base, ...costs].map(csvSafe).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `work-task-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported", description: `${filtered.length} task${filtered.length === 1 ? "" : "s"} exported.` });
  };

  const loading =
    tasksQ.isLoading || labourQ.isLoading || machineQ.isLoading ||
    wtPaddocksQ.isLoading || tripsQ.isLoading || (canSeeCosts && allocQ.isLoading);

  return (
    <div className="p-6 space-y-4 max-w-[1600px]">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Work Task Reports</h1>
        <p className="text-sm text-muted-foreground">
          Task-level roll-up of manual labour, manual machine work and linked
          GPS trips. Read-only — totals are not written back to the database
          and existing Cost Reports are unchanged.
        </p>
        {canSeeCosts && (
          <p className="text-xs text-muted-foreground flex items-start gap-1">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Linked GPS trip costs may include operator labour, fuel, chemicals
            and inputs.
          </p>
        )}
      </header>

      <Card className="p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Task type, block, notes…"
                className="pl-7 h-9"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Task type</label>
            <Select value={taskType} onValueChange={setTaskType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any task type</SelectItem>
                {taskTypeOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Block / paddock</label>
            <Select value={paddockId} onValueChange={setPaddockId}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any block</SelectItem>
                {paddocks.map((p) => <SelectItem key={p.id} value={p.id}>{p.name ?? "—"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Has linked trips</label>
            <Select value={hasLinked} onValueChange={setHasLinked}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                <SelectItem value="yes">With linked trips</SelectItem>
                <SelectItem value="no">No linked trips</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Has manual machine work</label>
            <Select value={hasManualMachine} onValueChange={setHasManualMachine}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                <SelectItem value="yes">With manual machine work</SelectItem>
                <SelectItem value="no">No manual machine work</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex flex-col justify-end">
            <label className="text-xs text-muted-foreground">&nbsp;</label>
            <label className="flex items-center gap-2 h-9 text-sm">
              <Checkbox checked={warningOnly} onCheckedChange={(v) => setWarningOnly(!!v)} />
              Warnings only
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} task${rows.length === 1 ? "" : "s"}`}
          </div>
          <Button size="sm" onClick={downloadCsv} disabled={!filtered.length}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Export CSV
          </Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Task type</TableHead>
              <TableHead>Blocks</TableHead>
              <TableHead className="text-right">Area</TableHead>
              <TableHead className="text-right">Labour hrs</TableHead>
              <TableHead className="text-right">Machine hrs</TableHead>
              <TableHead className="text-right">Linked trips</TableHead>
              {canSeeCosts ? (
                <>
                  <TableHead className="text-right">Manual labour</TableHead>
                  <TableHead className="text-right">Machine charge</TableHead>
                  <TableHead className="text-right">Machine fuel</TableHead>
                  <TableHead className="text-right">Linked GPS trips</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">{costPerAreaLabel}</TableHead>
                </>
              ) : (
                <TableHead className="text-right">Machine entries</TableHead>
              )}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canSeeCosts ? 14 : 9} className="text-center text-sm text-muted-foreground py-8">
                  {loading ? "Loading…" : "No work tasks match the current filters."}
                </TableCell>
              </TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.task.id}>
                <TableCell className="whitespace-nowrap">{fmtDay(r.date)}</TableCell>
                <TableCell>{r.taskType}</TableCell>
                <TableCell className="max-w-[280px] truncate" title={r.blocksLabel}>{r.blocksLabel}</TableCell>
                <TableCell className="text-right tabular-nums">{areaDisplay(r.totalAreaHa)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.labourHours.toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.machineHours.toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.linkedTripCount}</TableCell>
                {canSeeCosts ? (
                  <>
                    <TableCell className="text-right tabular-nums">{money(r.manualLabourCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.machineCharge)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.machineFuel)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.linkedTripTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(r.totalCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{costPerAreaDisplay(r.totalCost, r.totalAreaHa)}</TableCell>
                  </>
                ) : (
                  <TableCell className="text-right tabular-nums">{r.machineEntries}</TableCell>
                )}
                <TableCell>
                  {r.hasWarning ? (
                    <span title="Review: linked GPS trips and manual correction/missed machine entries may overlap.">
                      <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300 gap-1">
                        <AlertTriangle className="h-3 w-3" /> Review
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {filtered.length > 0 && (
            <TableBody>
              <TableRow className="bg-muted/30">
                <TableCell colSpan={3} className="font-medium">Totals (filtered)</TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {totals.anyArea ? areaDisplay(totals.totalAreaHa) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">{totals.labourHours.toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{totals.machineHours.toFixed(2)}</TableCell>
                <TableCell />
                {canSeeCosts ? (
                  <>
                    <TableCell className="text-right tabular-nums font-medium">{money(totals.manualLabourCost)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(totals.machineCharge)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(totals.machineFuel)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(totals.linkedTripTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(totals.totalCost)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {totals.anyArea ? costPerAreaDisplay(totals.totalCost, totals.totalAreaHa) : "—"}
                    </TableCell>
                  </>
                ) : (
                  <TableCell />
                )}
                <TableCell />
              </TableRow>
            </TableBody>
          )}
        </Table>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Review: linked GPS trips and manual correction/missed machine entries
        may overlap.
      </p>
    </div>
  );
}
