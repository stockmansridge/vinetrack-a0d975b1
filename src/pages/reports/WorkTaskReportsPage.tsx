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

interface PaddockLite { id: string; name: string | null; area_ha?: number | null }

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

/**
 * Resolve the display name for a Trip's machine/tractor.
 *
 *   trip.machine_id  → vineyard_machines.name
 *   trip.tractor_id  → tractors.name
 *
 * Falls back to a plain "Machine"/"Tractor" indicator when the referenced
 * record is missing (deleted, not yet loaded, or hidden by RLS) — keeps the
 * UI safe rather than dropping the row.
 */
function resolveTripEquipmentName(
  trip: Pick<Trip, "machine_id" | "tractor_id">,
  lookups: MachineLineEquipmentLookups,
): string {
  const findName = (
    rows: ReadonlyArray<{ id: string; name?: string | null }> | null | undefined,
    id: string | null | undefined,
  ): string | null => {
    if (!id || !rows) return null;
    const hit = rows.find((r) => r.id === id);
    const n = hit?.name?.trim();
    return n ? n : null;
  };
  if (trip.machine_id) {
    return findName(lookups.machines, trip.machine_id) ?? "Machine";
  }
  if (trip.tractor_id) {
    return findName(lookups.tractors, trip.tractor_id) ?? "Tractor";
  }
  return "—";
}

export default function WorkTaskReportsPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName = memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
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
  // Toggle column + 7 base + (cost ? 6 : 1) + status.
  const totalColSpan = 1 + 7 + (canSeeCosts ? 6 : 1) + 1;

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [taskType, setTaskType] = useState<string>(ANY);
  const [paddockId, setPaddockId] = useState<string>(ANY);
  const [hasLinked, setHasLinked] = useState<string>(ANY); // any | yes | no
  const [hasManualMachine, setHasManualMachine] = useState<string>(ANY);
  const [warningOnly, setWarningOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

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

  // Equipment lookups for resolveMachineLineEquipmentName() — used in
  // expanded row details to display human-readable equipment names.
  const vineyardMachinesQ = useQuery({
    queryKey: ["vineyard_machines-lite", selectedVineyardId],
    enabled,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("vineyard_machines", selectedVineyardId!),
  });
  const tractorsQ = useQuery({
    queryKey: ["tractors-lite", selectedVineyardId],
    enabled,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("tractors", selectedVineyardId!),
  });
  const sprayEquipmentQ = useQuery({
    queryKey: ["spray_equipment-lite", selectedVineyardId],
    enabled,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("spray_equipment", selectedVineyardId!),
  });
  const equipmentItemsQ = useQuery({
    queryKey: ["equipment_items-lite", selectedVineyardId],
    enabled,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("equipment_items", selectedVineyardId!),
  });
  const machineLookups: MachineLineEquipmentLookups = useMemo(() => ({
    machines: vineyardMachinesQ.data ?? [],
    tractors: tractorsQ.data ?? [],
    sprayEquipment: sprayEquipmentQ.data ?? [],
    equipmentItems: equipmentItemsQ.data ?? [],
  }), [vineyardMachinesQ.data, tractorsQ.data, sprayEquipmentQ.data, equipmentItemsQ.data]);

  const paddockNameById = useMemo(() => {
    const m = new Map<string, string>();
    paddocks.forEach((p) => m.set(p.id, p.name ?? "—"));
    return m;
  }, [paddocks]);

  // Legacy paddock-area fallback (matches Work Task drawer's effectiveTaskAreaHa
  // resolver — see src/pages/setup/WorkTasksPage.tsx). Some iPhone-created task
  // logs only have paddock_id and no work_task_paddocks rows, so we fall back
  // to the paddock entity's own area_ha.
  const paddockAreaById = useMemo(() => {
    const m = new Map<string, number>();
    paddocks.forEach((p) => {
      const v = p.area_ha == null ? NaN : Number(p.area_ha);
      if (Number.isFinite(v) && v > 0) m.set(p.id, v);
    });
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

      // Area roll-up (hectares, canonical). Mirrors effectiveTaskAreaHa() in
      // the Work Task drawer so report and drawer agree:
      //   1) task.area_ha if positive
      //   2) Σ work_task_paddocks.area_ha (positive values only)
      //   3) Σ paddock entity area_ha by paddock_id (legacy iPhone task logs)
      //   4) null
      // Display unit conversion happens at render/export time.
      let totalAreaHa: number | null = null;
      const storedTaskArea = task.area_ha == null ? NaN : Number(task.area_ha);
      if (Number.isFinite(storedTaskArea) && storedTaskArea > 0) {
        totalAreaHa = storedTaskArea;
      }
      if (totalAreaHa == null && taskPaddocks.length) {
        const sum = taskPaddocks.reduce(
          (s, p) => s + (Number(p.area_ha) > 0 ? Number(p.area_ha) : 0), 0,
        );
        if (sum > 0) totalAreaHa = sum;
      }
      if (totalAreaHa == null && pIds.length) {
        const sum = pIds.reduce((s, id) => s + (paddockAreaById.get(id) ?? 0), 0);
        if (sum > 0) totalAreaHa = sum;
      }

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
        labourLines: labour,
        machineLines: machine,
        taskPaddocks,
        trips,
      };
    });
  }, [tasksQ.data, labourByTask, machineByTask, paddocksByTask, tripsByTask, allocByTripId, paddockNameById, paddockAreaById]);

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

  // -------------------- PDF export --------------------
  // Renders the currently filtered task rows. Uses jsPDF + autoTable to match
  // the convention established in sprayJobsExport.ts. Display-only — does not
  // mutate any data. Regional formatters drive area/cost-per-area labels and
  // currency formatting; cost columns are gated by canSeeCosts.
  const downloadPdf = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 32;

    // Header band.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Work Task Report", margin, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(`Vineyard: ${vineyardName ?? "—"}`, margin, 58);
    doc.text(`Generated: ${fmt.dateTime(new Date())}`, pageWidth - margin, 58, { align: "right" });
    doc.setDrawColor(200);
    doc.line(margin, 66, pageWidth - margin, 66);
    doc.setTextColor(0);

    // Active filters summary.
    const filterParts: string[] = [];
    if (from || to) filterParts.push(`Date: ${from || "…"} → ${to || "…"}`);
    if (taskType !== ANY) filterParts.push(`Task type: ${taskType}`);
    if (paddockId !== ANY) {
      filterParts.push(`${fmt.blockLabel}: ${paddockNameById.get(paddockId) ?? paddockId}`);
    }
    if (hasLinked !== ANY) filterParts.push(`Linked trips: ${hasLinked === "yes" ? "with" : "without"}`);
    if (hasManualMachine !== ANY) filterParts.push(`Manual machine work: ${hasManualMachine === "yes" ? "with" : "without"}`);
    if (warningOnly) filterParts.push("Warnings only");
    const filterLine = filterParts.length ? filterParts.join("  •  ") : "No filters applied";
    doc.setFontSize(8);
    doc.setTextColor(100);
    const wrapped = doc.splitTextToSize(`Filters: ${filterLine}`, pageWidth - margin * 2);
    doc.text(wrapped, margin, 80);
    const headerBottom = 80 + wrapped.length * 10;
    doc.setTextColor(0);

    // Build columns and rows mirroring the on-screen report.
    const head: string[] = [
      "Date", "Task type", `${fmt.blocksLabel}`, `Area (${fmt.areaUnitLabel})`,
      "Labour hrs", "Machine hrs", "Linked trips",
    ];
    if (canSeeCosts) {
      head.push(
        "Manual labour", "Machine charge", "Machine fuel",
        "Linked GPS trips", "Total cost", `Cost / ${fmt.areaUnitLabel}`,
      );
    } else {
      head.push("Machine entries");
    }
    head.push("Status");

    const body: string[][] = filtered.map((r) => {
      const base = [
        r.date ? fmt.date(r.date) : "—",
        r.taskType,
        r.blocksLabel,
        areaDisplay(r.totalAreaHa),
        r.labourHours.toFixed(2),
        r.machineHours.toFixed(2),
        String(r.linkedTripCount),
      ];
      if (canSeeCosts) {
        base.push(
          money(r.manualLabourCost),
          money(r.machineCharge),
          money(r.machineFuel),
          money(r.linkedTripTotal),
          money(r.totalCost),
          costPerAreaDisplay(r.totalCost, r.totalAreaHa),
        );
      } else {
        base.push(String(r.machineEntries));
      }
      base.push(r.hasWarning ? "Review" : "—");
      return base;
    });

    // Totals row.
    const totalsRow: string[] = [
      "Totals (filtered)", "", "",
      totals.anyArea ? areaDisplay(totals.totalAreaHa) : "—",
      totals.labourHours.toFixed(2),
      totals.machineHours.toFixed(2),
      "",
    ];
    if (canSeeCosts) {
      totalsRow.push(
        money(totals.manualLabourCost),
        money(totals.machineCharge),
        money(totals.machineFuel),
        money(totals.linkedTripTotal),
        money(totals.totalCost),
        totals.anyArea ? costPerAreaDisplay(totals.totalCost, totals.totalAreaHa) : "—",
      );
    } else {
      totalsRow.push("");
    }
    totalsRow.push("");

    const numericColsCost = canSeeCosts
      ? new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      : new Set([3, 4, 5, 6, 7]);

    autoTable(doc, {
      startY: headerBottom + 8,
      head: [head],
      body,
      foot: filtered.length ? [totalsRow] : undefined,
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 3, valign: "top", overflow: "linebreak" },
      headStyles: { fillColor: [60, 90, 60], textColor: 255, halign: "left" },
      footStyles: { fillColor: [235, 235, 235], textColor: 30, fontStyle: "bold" },
      margin: { left: margin, right: margin, bottom: 50 },
      columnStyles: Object.fromEntries(
        [...numericColsCost].map((i) => [i, { halign: "right" }]),
      ),
      didDrawPage: () => {
        // Footer: warning text + page number on every page.
        const pageH = doc.internal.pageSize.getHeight();
        const pageW = doc.internal.pageSize.getWidth();
        doc.setFontSize(7);
        doc.setTextColor(110);
        const note = "Review: linked GPS trips and manual correction/missed machine entries may overlap.";
        doc.text(note, margin, pageH - 22);
        const pageNum = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
        doc.text(`Page ${pageNum}`, pageW - margin, pageH - 22, { align: "right" });
        doc.setTextColor(0);
      },
    });

    // Empty-state body.
    if (!filtered.length) {
      const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text("No work tasks match the current filters.", margin, y);
      doc.setTextColor(0);
    }
    void pageHeight; // touched by didDrawPage via doc.internal

    const safeName = (vineyardName ?? "vineyard").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    doc.save(`work-task-report-${safeName}-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({ title: "PDF exported", description: `${filtered.length} task${filtered.length === 1 ? "" : "s"} exported.` });
  };

  // -------------------- Excel export --------------------
  // Mirrors the on-screen report / PDF columns and role gating. Uses SheetJS
  // (xlsx) which is already a project dependency (see sprayJobsExport.ts).
  // Read-only — does not mutate any data. Cost columns are gated by canSeeCosts.
  const downloadExcel = async () => {
    const XLSX = await import("xlsx");
    const areaLabel = fmt.areaUnitLabel;
    const currency = fmt.settings.currency_code;

    // Meta rows above the table.
    const meta: (string | number)[][] = [
      ["Work Task Report"],
      [`Vineyard: ${vineyardName ?? "—"}`],
      [`Generated: ${fmt.dateTime(new Date())}`],
    ];
    const filterParts: string[] = [];
    if (from || to) filterParts.push(`Date: ${from || "…"} → ${to || "…"}`);
    if (taskType !== ANY) filterParts.push(`Task type: ${taskType}`);
    if (paddockId !== ANY) filterParts.push(`${fmt.blockLabel}: ${paddockNameById.get(paddockId) ?? paddockId}`);
    if (hasLinked !== ANY) filterParts.push(`Linked trips: ${hasLinked === "yes" ? "with" : "without"}`);
    if (hasManualMachine !== ANY) filterParts.push(`Manual machine work: ${hasManualMachine === "yes" ? "with" : "without"}`);
    if (warningOnly) filterParts.push("Warnings only");
    meta.push([`Filters: ${filterParts.length ? filterParts.join("  •  ") : "No filters applied"}`]);
    meta.push([]);

    const head: string[] = [
      "Date", "Task type", fmt.blocksLabel, `Area (${areaLabel})`,
      "Labour hours", "Manual machine hours", "Linked trips",
    ];
    if (canSeeCosts) {
      head.push(
        `Manual labour cost (${currency})`,
        `Machine charge (${currency})`,
        `Machine fuel (${currency})`,
        `Linked GPS trip cost (${currency})`,
        `Total cost (${currency})`,
        `Cost / ${areaLabel} (${currency}/${areaLabel})`,
      );
    } else {
      head.push("Machine entries");
    }
    head.push("Status");

    const body: (string | number)[][] = filtered.map((r) => {
      const areaDisp = areaToDisplayUnit(r.totalAreaHa);
      const perHa = r.totalAreaHa && r.totalAreaHa > 0 ? r.totalCost / r.totalAreaHa : null;
      const perDisp = perHa == null ? null : (areaImperial ? perHa * HA_PER_AC : perHa);
      const base: (string | number)[] = [
        r.date ?? "",
        r.taskType,
        r.blocksLabel,
        areaDisp == null ? "" : Number(areaDisp.toFixed(2)),
        Number(r.labourHours.toFixed(2)),
        Number(r.machineHours.toFixed(2)),
        r.linkedTripCount,
      ];
      if (canSeeCosts) {
        base.push(
          Number(r.manualLabourCost.toFixed(2)),
          Number(r.machineCharge.toFixed(2)),
          Number(r.machineFuel.toFixed(2)),
          Number(r.linkedTripTotal.toFixed(2)),
          Number(r.totalCost.toFixed(2)),
          perDisp == null ? "" : Number(perDisp.toFixed(2)),
        );
      } else {
        base.push(r.machineEntries);
      }
      base.push(r.hasWarning ? "Review" : "");
      return base;
    });

    const totalsRow: (string | number)[] = [
      "Totals (filtered)", "", "",
      totals.anyArea ? Number((areaToDisplayUnit(totals.totalAreaHa) ?? 0).toFixed(2)) : "",
      Number(totals.labourHours.toFixed(2)),
      Number(totals.machineHours.toFixed(2)),
      "",
    ];
    if (canSeeCosts) {
      const perHaTot = totals.totalAreaHa > 0 ? totals.totalCost / totals.totalAreaHa : null;
      const perDispTot = perHaTot == null ? null : (areaImperial ? perHaTot * HA_PER_AC : perHaTot);
      totalsRow.push(
        Number(totals.manualLabourCost.toFixed(2)),
        Number(totals.machineCharge.toFixed(2)),
        Number(totals.machineFuel.toFixed(2)),
        Number(totals.linkedTripTotal.toFixed(2)),
        Number(totals.totalCost.toFixed(2)),
        perDispTot == null ? "" : Number(perDispTot.toFixed(2)),
      );
    } else {
      totalsRow.push("");
    }
    totalsRow.push("");

    const footerRows: (string | number)[][] = [
      [],
      ["Review: linked GPS trips and manual correction/missed machine entries may overlap."],
    ];

    const aoa: (string | number)[][] = [
      ...meta,
      head,
      ...body,
      ...(filtered.length ? [totalsRow] : []),
      ...footerRows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Column widths.
    const widths = head.map((h) => ({ wch: Math.max(12, Math.min(28, h.length + 2)) }));
    widths[0] = { wch: 12 };
    widths[1] = { wch: 18 };
    widths[2] = { wch: 28 };
    ws["!cols"] = widths;
    // Freeze header row (meta rows = 5, header row index = 5 → freeze at row 6).
    ws["!freeze"] = { xSplit: 0, ySplit: meta.length + 1 };
    (ws as unknown as { "!freeze"?: unknown })["!freeze"];
    // SheetJS uses '!freeze' via views; set via worksheet view metadata:
    (ws as unknown as Record<string, unknown>)["!views"] = [{ state: "frozen", ySplit: meta.length + 1 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Work Task Report");
    const safeName = (vineyardName ?? "vineyard").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    XLSX.writeFile(wb, `work-task-report-${safeName}-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast({ title: "Excel exported", description: `${filtered.length} task${filtered.length === 1 ? "" : "s"} exported.` });
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
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={downloadPdf} disabled={!filtered.length}>
              <Download className="h-3.5 w-3.5 mr-1" />
              Export PDF
            </Button>
            <Button size="sm" variant="outline" onClick={downloadExcel} disabled={!filtered.length}>
              <Download className="h-3.5 w-3.5 mr-1" />
              Export Excel
            </Button>
            <Button size="sm" onClick={downloadCsv} disabled={!filtered.length}>
              <Download className="h-3.5 w-3.5 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
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
                <TableCell colSpan={totalColSpan} className="text-center text-sm text-muted-foreground py-8">
                  {loading ? "Loading…" : "No work tasks match the current filters."}
                </TableCell>
              </TableRow>
            ) : filtered.map((r) => {
              const isOpen = expanded.has(r.task.id);
              return (
                <Fragment key={r.task.id}>
                  <TableRow>
                    <TableCell className="p-1 align-middle">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={isOpen ? "Collapse details" : "Expand details"}
                        aria-expanded={isOpen}
                        onClick={() => toggleExpanded(r.task.id)}
                      >
                        {isOpen
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </TableCell>
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
                  {isOpen && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={totalColSpan} className="p-3 sm:p-4">
                        <ExpandedRowDetails
                          row={r}
                          canSeeCosts={canSeeCosts}
                          fmt={fmt}
                          areaImperial={areaImperial}
                          paddockNameById={paddockNameById}
                          machineLookups={machineLookups}
                          allocByTripId={allocByTripId}
                          money={money}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
          {filtered.length > 0 && (
            <TableBody>
              <TableRow className="bg-muted/30">
                <TableCell />
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

// ---------------------------------------------------------------------------
// Expanded row: per-task audit detail. Pure presentation — no mutations.
// ---------------------------------------------------------------------------

interface ExpandedRowDetailsProps {
  row: TaskRow;
  canSeeCosts: boolean;
  fmt: ReturnType<typeof useRegionFormatters>;
  areaImperial: boolean;
  paddockNameById: Map<string, string>;
  machineLookups: MachineLineEquipmentLookups;
  allocByTripId: Map<string, TripCostAllocation[]>;
  money: (n: number) => string;
}

function ExpandedRowDetails({
  row, canSeeCosts, fmt, paddockNameById, machineLookups, allocByTripId, money,
}: ExpandedRowDetailsProps) {
  const fmtDateTime = (v?: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "—" : format(d, "PP p");
  };
  const fmtDateShort = (v?: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "—" : format(d, "PP");
  };
  const durationHrs = (a?: string | null, b?: string | null): number | null => {
    if (!a || !b) return null;
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : null;
  };
  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const fmtHours = (n: number | null) => n == null ? "—" : `${n.toFixed(2)} h`;
  const fmtLitres = (n: number | null) => n == null ? "—" : fmt.fuel(n);

  const sectionHeader = (title: string, count: number) => (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <span className="text-[11px] text-muted-foreground">
        {count} {count === 1 ? "entry" : "entries"}
      </span>
    </div>
  );

  const emptyState = (text: string) => (
    <div className="text-xs text-muted-foreground italic py-2">{text}</div>
  );

  const paddockRows = row.taskPaddocks.length
    ? row.taskPaddocks.map((p) => ({
        id: p.id,
        name: paddockNameById.get(p.paddock_id) ?? "—",
        areaHa: p.area_ha != null ? Number(p.area_ha) : null,
      }))
    : row.paddockIds.map((id) => ({
        id,
        name: paddockNameById.get(id) ?? "—",
        areaHa: null as number | null,
      }));
  const totalAreaForShare = row.totalAreaHa && row.totalAreaHa > 0 ? row.totalAreaHa : null;

  return (
    <div className="space-y-3">
      {row.hasWarning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Review: linked GPS trips and manual correction/missed machine entries may overlap.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Labour lines */}
        <Card className="p-3">
          {sectionHeader("Labour lines", row.labourLines.length)}
          {row.labourLines.length === 0 ? emptyState("No manual labour entries recorded.") : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Workers</TableHead>
                    <TableHead className="text-right">Hrs/worker</TableHead>
                    <TableHead className="text-right">Total hrs</TableHead>
                    {canSeeCosts && <TableHead className="text-right">Rate</TableHead>}
                    {canSeeCosts && <TableHead className="text-right">Total cost</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {row.labourLines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">
                        {l.worker_type?.trim() || l.operator_category_id || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {l.worker_count ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {l.hours_per_worker != null ? Number(l.hours_per_worker).toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {l.total_hours != null ? Number(l.total_hours).toFixed(2) : "—"}
                      </TableCell>
                      {canSeeCosts && (
                        <TableCell className="text-right tabular-nums text-xs">
                          {l.hourly_rate != null ? money(Number(l.hourly_rate)) : "—"}
                        </TableCell>
                      )}
                      {canSeeCosts && (
                        <TableCell className="text-right tabular-nums text-xs">
                          {l.total_cost != null ? money(Number(l.total_cost)) : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Manual machine lines */}
        <Card className="p-3">
          {sectionHeader("Manual machine lines", row.machineLines.length)}
          {row.machineLines.length === 0 ? emptyState("No manual machine entries recorded.") : (
            <div className="space-y-2">
              {row.machineLines.map((m) => {
                const name = resolveMachineLineEquipmentName(m, machineLookups) ?? "—";
                return (
                  <div key={m.id} className="rounded-md border bg-background/50 p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{name}</span>
                      {m.entry_source && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {m.entry_source}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-muted-foreground">
                      <div>Work date: <span className="text-foreground">{fmtDateShort(m.work_date)}</span></div>
                      <div>Duration: <span className="text-foreground">{fmtHours(numOrNull(m.duration_hours))}</span></div>
                      <div>Engine hrs: <span className="text-foreground">{fmtHours(numOrNull(m.engine_hours_used))}</span></div>
                      <div>Fuel: <span className="text-foreground">{fmtLitres(numOrNull(m.fuel_litres))}</span></div>
                      {canSeeCosts && (
                        <div>Machine charge: <span className="text-foreground">{m.total_machine_cost != null ? money(Number(m.total_machine_cost)) : "—"}</span></div>
                      )}
                      {canSeeCosts && (
                        <div>Fuel cost: <span className="text-foreground">{m.fuel_cost != null ? money(Number(m.fuel_cost)) : "—"}</span></div>
                      )}
                    </div>
                    {m.notes && <div className="text-foreground/80">Note: {m.notes}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Linked GPS trips */}
        <Card className="p-3">
          {sectionHeader("Linked GPS trips", row.trips.length)}
          {row.trips.length === 0 ? emptyState("No GPS trips linked to this task.") : (
            <div className="space-y-2">
              {row.trips.map((t) => {
                const allocs = allocByTripId.get(t.id) ?? [];
                const tripTotal = allocs.reduce((s, a) => s + Number(a.total_cost ?? 0), 0);
                const labourTotal = allocs.reduce((s, a) => s + Number(a.labour_cost ?? 0), 0);
                const fuelTotal = allocs.reduce((s, a) => s + Number(a.fuel_cost ?? 0), 0);
                const chemTotal = allocs.reduce((s, a) => s + Number(a.chemical_cost ?? 0), 0);
                const inputTotal = allocs.reduce((s, a) => s + Number(a.input_cost ?? 0), 0);
                const engineDur = (t.start_engine_hours != null && t.end_engine_hours != null)
                  ? Number(t.end_engine_hours) - Number(t.start_engine_hours)
                  : null;
                const dur = engineDur != null && Number.isFinite(engineDur) && engineDur > 0
                  ? engineDur
                  : durationHrs(t.start_time, t.end_time);
                const title = t.trip_title?.trim() || t.trip_function?.trim() || "Trip";
                return (
                  <div key={t.id} className="rounded-md border bg-background/50 p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{title}</span>
                      {canSeeCosts && (
                        <span className="tabular-nums font-medium">{money(tripTotal)}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-muted-foreground">
                      <div>Start: <span className="text-foreground">{fmtDateTime(t.start_time)}</span></div>
                      <div>End: <span className="text-foreground">{fmtDateTime(t.end_time)}</span></div>
                      <div>Duration: <span className="text-foreground">{fmtHours(dur)}</span></div>
                      {(t.machine_id || t.tractor_id) && (
                        <div>Machine: <span className="text-foreground">{resolveTripEquipmentName(t, machineLookups)}</span></div>
                      )}
                      {t.person_name && (
                        <div>Operator: <span className="text-foreground">{t.person_name}</span></div>
                      )}
                    </div>
                    {canSeeCosts && allocs.length > 0 && (
                      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>Labour {money(labourTotal)}</span>
                        <span>Fuel {money(fuelTotal)}</span>
                        <span>Chem {money(chemTotal)}</span>
                        <span>Inputs {money(inputTotal)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Paddock / block breakdown */}
        <Card className="p-3">
          {sectionHeader(`${fmt.blocksLabel} breakdown`, paddockRows.length)}
          {paddockRows.length === 0 ? emptyState(`No ${fmt.blocksLabel.toLowerCase()} linked to this task.`) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{fmt.blockLabel}</TableHead>
                    <TableHead className="text-right">Area</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paddockRows.map((p) => {
                    const share = totalAreaForShare && p.areaHa != null
                      ? (p.areaHa / totalAreaForShare) * 100
                      : null;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">{p.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {p.areaHa == null ? "—" : fmt.area(p.areaHa)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {share == null ? "—" : `${share.toFixed(0)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
