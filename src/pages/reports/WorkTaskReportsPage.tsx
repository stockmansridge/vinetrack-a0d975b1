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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PaddockLite { id: string; name: string | null; area_ha?: number | null }

interface AllocContribution {
  taskId: string;
  date: string | null;
  taskType: string;
  description: string | null;
  share: number | null; // null = unallocated (no area share)
  areaHa: number | null; // hectares allocated to this block from this task
  labourHours: number;
  machineHours: number;
  linkedTripCount: number;
  manualLabourCost: number;
  machineCharge: number;
  machineFuel: number;
  linkedTripTotal: number;
  totalCost: number;
  hasOverlapWarning: boolean;
  reason: string | null; // populated for unallocated / missing-area contributions
}

interface AllocRow {
  key: string;
  paddockId: string | null;
  name: string;
  taskIds: Set<string>;
  areaHa: number;
  hasAnyArea: boolean;
  labourHours: number;
  machineHours: number;
  linkedTripCount: number;
  manualLabourCost: number;
  machineCharge: number;
  machineFuel: number;
  linkedTripTotal: number;
  totalCost: number;
  hasOverlapWarning: boolean;
  hasMissingTaskArea: boolean;
  hasMissingBlockArea: boolean;
  isUnallocated: boolean;
  contributions: AllocContribution[];
}

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

  // -------------------- Block / paddock allocation (Stage 5H) --------------------
  // Per-task area-share allocation, aggregated by block/paddock across the
  // currently filtered task set. Read-only — nothing is written back to the
  // database and the existing task-level roll-up is untouched.
  //
  // For each task in `filtered`:
  //   totalTaskAreaHa = the same area precedence used in the task summary
  //     (task.area_ha > 0  →  Σ work_task_paddocks.area_ha > 0  →  Σ paddock entity area_ha > 0  → null)
  //   for each linked paddock:
  //     paddockAreaHa = work_task_paddocks.area_ha (if > 0) else paddock.area_ha (if > 0) else null
  //     share         = paddockAreaHa / totalTaskAreaHa
  //     allocated*    = task* × share
  //
  // If totalTaskAreaHa is missing/zero, the whole task is added to an
  // "Unallocated" bucket so totals still reconcile against the task summary.
  // If a single block has no resolvable area but the task does, that block
  // contributes 0 cost and is flagged "Missing block area".
  // Allocation types are declared at module scope (see below) so the
  // AllocationContributions helper component can share them.

  const allocationRows = useMemo<AllocRow[]>(() => {
    const map = new Map<string, AllocRow>();
    const ensure = (paddockId: string | null, name: string, isUnallocated: boolean): AllocRow => {
      const key = paddockId ?? "__unallocated__";
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          paddockId,
          name,
          taskIds: new Set<string>(),
          areaHa: 0,
          hasAnyArea: false,
          labourHours: 0,
          machineHours: 0,
          linkedTripCount: 0,
          manualLabourCost: 0,
          machineCharge: 0,
          machineFuel: 0,
          linkedTripTotal: 0,
          totalCost: 0,
          hasOverlapWarning: false,
          hasMissingTaskArea: false,
          hasMissingBlockArea: false,
          isUnallocated,
          contributions: [],
        };
        map.set(key, row);
      }
      return row;
    };

    const baseContrib = (r: TaskRow): Omit<AllocContribution,
      "share" | "areaHa" | "labourHours" | "machineHours" | "linkedTripCount" |
      "manualLabourCost" | "machineCharge" | "machineFuel" | "linkedTripTotal" |
      "totalCost" | "reason"
    > => ({
      taskId: r.task.id,
      date: r.date,
      taskType: r.taskType,
      description: r.task.description ?? r.task.notes ?? null,
      hasOverlapWarning: r.hasWarning,
    });

    filtered.forEach((r) => {
      const totalHa = r.totalAreaHa && r.totalAreaHa > 0 ? r.totalAreaHa : null;

      const links: Array<{ paddockId: string; areaHa: number | null }> = r.taskPaddocks.length
        ? r.taskPaddocks.map((p) => {
            const a = Number(p.area_ha);
            const fromLink = Number.isFinite(a) && a > 0 ? a : null;
            const fallback = paddockAreaById.get(p.paddock_id) ?? null;
            return { paddockId: p.paddock_id, areaHa: fromLink ?? (fallback && fallback > 0 ? fallback : null) };
          })
        : r.paddockIds.map((id) => {
            const fallback = paddockAreaById.get(id) ?? null;
            return { paddockId: id, areaHa: fallback && fallback > 0 ? fallback : null };
          });

      // Case 1: task area unresolved → entire task → Unallocated bucket.
      if (totalHa == null) {
        const row = ensure(null, "Unallocated", true);
        row.taskIds.add(r.task.id);
        row.labourHours += r.labourHours;
        row.machineHours += r.machineHours;
        row.linkedTripCount += r.linkedTripCount;
        row.manualLabourCost += r.manualLabourCost;
        row.machineCharge += r.machineCharge;
        row.machineFuel += r.machineFuel;
        row.linkedTripTotal += r.linkedTripTotal;
        row.totalCost += r.totalCost;
        row.hasMissingTaskArea = true;
        if (r.hasWarning) row.hasOverlapWarning = true;
        row.contributions.push({
          ...baseContrib(r),
          share: null, areaHa: null,
          labourHours: r.labourHours, machineHours: r.machineHours,
          linkedTripCount: r.linkedTripCount,
          manualLabourCost: r.manualLabourCost, machineCharge: r.machineCharge,
          machineFuel: r.machineFuel, linkedTripTotal: r.linkedTripTotal,
          totalCost: r.totalCost,
          reason: "Missing task area",
        });
        return;
      }

      // Case 2: no linked paddocks → Unallocated.
      if (!links.length) {
        const row = ensure(null, "Unallocated", true);
        row.taskIds.add(r.task.id);
        row.labourHours += r.labourHours;
        row.machineHours += r.machineHours;
        row.linkedTripCount += r.linkedTripCount;
        row.manualLabourCost += r.manualLabourCost;
        row.machineCharge += r.machineCharge;
        row.machineFuel += r.machineFuel;
        row.linkedTripTotal += r.linkedTripTotal;
        row.totalCost += r.totalCost;
        if (r.hasWarning) row.hasOverlapWarning = true;
        row.contributions.push({
          ...baseContrib(r),
          share: null, areaHa: null,
          labourHours: r.labourHours, machineHours: r.machineHours,
          linkedTripCount: r.linkedTripCount,
          manualLabourCost: r.manualLabourCost, machineCharge: r.machineCharge,
          machineFuel: r.machineFuel, linkedTripTotal: r.linkedTripTotal,
          totalCost: r.totalCost,
          reason: "No linked blocks",
        });
        return;
      }

      // Case 3: per-paddock allocation by area share.
      links.forEach(({ paddockId: pid, areaHa }) => {
        const name = paddockNameById.get(pid) ?? "—";
        const row = ensure(pid, name, false);
        row.taskIds.add(r.task.id);
        if (r.hasWarning) row.hasOverlapWarning = true;

        if (areaHa == null || !(areaHa > 0)) {
          row.hasMissingBlockArea = true;
          row.linkedTripCount += r.linkedTripCount > 0 ? 1 : 0;
          row.contributions.push({
            ...baseContrib(r),
            share: null, areaHa: null,
            labourHours: 0, machineHours: 0,
            linkedTripCount: r.linkedTripCount > 0 ? 1 : 0,
            manualLabourCost: 0, machineCharge: 0, machineFuel: 0,
            linkedTripTotal: 0, totalCost: 0,
            reason: "Missing block area",
          });
          return;
        }
        const share = areaHa / totalHa;
        row.areaHa += areaHa;
        row.hasAnyArea = true;
        row.labourHours += r.labourHours * share;
        row.machineHours += r.machineHours * share;
        row.linkedTripCount += r.linkedTripCount > 0 ? 1 : 0;
        row.manualLabourCost += r.manualLabourCost * share;
        row.machineCharge += r.machineCharge * share;
        row.machineFuel += r.machineFuel * share;
        row.linkedTripTotal += r.linkedTripTotal * share;
        row.totalCost += r.totalCost * share;
        row.contributions.push({
          ...baseContrib(r),
          share, areaHa,
          labourHours: r.labourHours * share,
          machineHours: r.machineHours * share,
          linkedTripCount: r.linkedTripCount > 0 ? 1 : 0,
          manualLabourCost: r.manualLabourCost * share,
          machineCharge: r.machineCharge * share,
          machineFuel: r.machineFuel * share,
          linkedTripTotal: r.linkedTripTotal * share,
          totalCost: r.totalCost * share,
          reason: null,
        });
      });
    });

    // Sort contributions newest first within each row.
    map.forEach((row) => {
      row.contributions.sort((a, b) => {
        const ad = a.date ? new Date(a.date).getTime() : 0;
        const bd = b.date ? new Date(b.date).getTime() : 0;
        return bd - ad;
      });
    });

    // Sort: real blocks alphabetically, Unallocated last.
    return Array.from(map.values()).sort((a, b) => {
      if (a.isUnallocated && !b.isUnallocated) return 1;
      if (!a.isUnallocated && b.isUnallocated) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, paddockAreaById, paddockNameById]);


  const allocationTotals = useMemo(() => {
    return allocationRows.reduce(
      (acc, r) => ({
        areaHa: acc.areaHa + r.areaHa,
        hasAnyArea: acc.hasAnyArea || r.hasAnyArea,
        labourHours: acc.labourHours + r.labourHours,
        machineHours: acc.machineHours + r.machineHours,
        manualLabourCost: acc.manualLabourCost + r.manualLabourCost,
        machineCharge: acc.machineCharge + r.machineCharge,
        machineFuel: acc.machineFuel + r.machineFuel,
        linkedTripTotal: acc.linkedTripTotal + r.linkedTripTotal,
        totalCost: acc.totalCost + r.totalCost,
      }),
      { areaHa: 0, hasAnyArea: false, labourHours: 0, machineHours: 0, manualLabourCost: 0, machineCharge: 0, machineFuel: 0, linkedTripTotal: 0, totalCost: 0 },
    );
  }, [allocationRows]);

  const allocationStatus = (r: AllocRow): string => {
    const parts: string[] = [];
    if (r.isUnallocated || r.hasMissingTaskArea) parts.push(r.hasMissingTaskArea ? "Missing task area" : "Unallocated");
    if (r.hasMissingBlockArea) parts.push("Missing block area");
    if (r.hasOverlapWarning) parts.push("Review overlap");
    return parts.length ? parts.join(" • ") : "OK";
  };

  const downloadAllocationCsv = () => {
    const baseCols = [
      "Block", "Task count", "area_display", "area_unit",
      "Labour hours (allocated)", "Manual machine hours (allocated)",
      "Linked trips", "Status",
    ];
    const costCols = [
      "Manual labour cost", "Machine charge", "Machine fuel",
      "Linked GPS trip cost", "Total allocated cost",
      "cost_per_area", "cost_per_area_unit",
    ];
    const header = canSeeCosts ? [...baseCols, ...costCols] : baseCols;
    const lines = [header.map(csvSafe).join(",")];
    allocationRows.forEach((r) => {
      const areaDisp = r.hasAnyArea ? areaToDisplayUnit(r.areaHa) : null;
      const perHa = r.hasAnyArea && r.areaHa > 0 ? r.totalCost / r.areaHa : null;
      const perDisp = perHa == null ? null : (areaImperial ? perHa * HA_PER_AC : perHa);
      const base = [
        r.name,
        r.taskIds.size,
        areaDisp == null ? "" : areaDisp.toFixed(2),
        r.hasAnyArea ? areaUnit : "",
        r.labourHours.toFixed(2),
        r.machineHours.toFixed(2),
        r.linkedTripCount,
        allocationStatus(r),
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
    a.download = `work-task-block-allocation-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported", description: `${allocationRows.length} block row${allocationRows.length === 1 ? "" : "s"} exported.` });
  };

  // Build the filter-summary line that appears in both PDF and Excel exports.
  const buildFilterSummary = (): string => {
    const parts: string[] = [];
    if (from || to) parts.push(`Date: ${from || "…"} → ${to || "…"}`);
    if (taskType !== ANY) parts.push(`Task type: ${taskType}`);
    if (paddockId !== ANY) parts.push(`${fmt.blockLabel}: ${paddockNameById.get(paddockId) ?? paddockId}`);
    if (hasLinked !== ANY) parts.push(`Linked trips: ${hasLinked === "yes" ? "with" : "without"}`);
    if (hasManualMachine !== ANY) parts.push(`Manual machine work: ${hasManualMachine === "yes" ? "with" : "without"}`);
    if (warningOnly) parts.push("Warnings only");
    return parts.length ? parts.join("  •  ") : "No filters applied";
  };

  const allocationTitle = `Work Task ${fmt.blockLabel} Allocation`;
  const allocationExplanation = `${fmt.blockLabel} allocation is estimated by area share of each Work Task. Values are calculated for reporting and are not written back to the database.`;
  const allocationWarningNote = "Review: linked GPS trips and manual correction/missed machine entries may overlap.";

  // -------------------- Allocation PDF export --------------------
  const downloadAllocationPdf = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 32;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(allocationTitle, margin, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(`Vineyard: ${vineyardName ?? "—"}`, margin, 58);
    doc.text(`Generated: ${fmt.dateTime(new Date())}`, pageWidth - margin, 58, { align: "right" });
    doc.setDrawColor(200);
    doc.line(margin, 66, pageWidth - margin, 66);
    doc.setTextColor(0);

    doc.setFontSize(8);
    doc.setTextColor(100);
    const filterWrapped = doc.splitTextToSize(`Filters: ${buildFilterSummary()}`, pageWidth - margin * 2);
    doc.text(filterWrapped, margin, 80);
    let cursorY = 80 + filterWrapped.length * 10;
    const explanationWrapped = doc.splitTextToSize(allocationExplanation, pageWidth - margin * 2);
    doc.text(explanationWrapped, margin, cursorY + 4);
    cursorY = cursorY + 4 + explanationWrapped.length * 10;
    doc.setTextColor(0);

    const head: string[] = [
      fmt.blockLabel, "Tasks", `Area (${fmt.areaUnitLabel})`,
      "Labour hrs", "Machine hrs", "Linked trips",
    ];
    if (canSeeCosts) {
      head.push(
        "Manual labour", "Machine charge", "Machine fuel",
        "Linked GPS trips", "Total cost", `Cost / ${fmt.areaUnitLabel}`,
      );
    }
    head.push("Status");

    const body: string[][] = allocationRows.map((r) => {
      const base: string[] = [
        r.name,
        String(r.taskIds.size),
        r.hasAnyArea ? areaDisplay(r.areaHa) : "—",
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
          r.hasAnyArea ? costPerAreaDisplay(r.totalCost, r.areaHa) : "—",
        );
      }
      base.push(allocationStatus(r));
      return base;
    });

    const totalsRow: string[] = [
      "Totals (filtered)", "",
      allocationTotals.hasAnyArea ? areaDisplay(allocationTotals.areaHa) : "—",
      allocationTotals.labourHours.toFixed(2),
      allocationTotals.machineHours.toFixed(2),
      "",
    ];
    if (canSeeCosts) {
      totalsRow.push(
        money(allocationTotals.manualLabourCost),
        money(allocationTotals.machineCharge),
        money(allocationTotals.machineFuel),
        money(allocationTotals.linkedTripTotal),
        money(allocationTotals.totalCost),
        allocationTotals.hasAnyArea ? costPerAreaDisplay(allocationTotals.totalCost, allocationTotals.areaHa) : "—",
      );
    }
    totalsRow.push("");

    // Numeric columns (right-align). Base numeric: 1 (Tasks) .. 5 (Linked trips).
    const numericCols = canSeeCosts
      ? new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      : new Set([1, 2, 3, 4, 5]);

    autoTable(doc, {
      startY: cursorY + 8,
      head: [head],
      body,
      foot: allocationRows.length ? [totalsRow] : undefined,
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 3, valign: "top", overflow: "linebreak" },
      headStyles: { fillColor: [60, 90, 60], textColor: 255, halign: "left" },
      footStyles: { fillColor: [235, 235, 235], textColor: 30, fontStyle: "bold" },
      margin: { left: margin, right: margin, bottom: 50 },
      columnStyles: Object.fromEntries(
        [...numericCols].map((i) => [i, { halign: "right" }]),
      ),
      didDrawPage: () => {
        const pageH = doc.internal.pageSize.getHeight();
        const pageW = doc.internal.pageSize.getWidth();
        doc.setFontSize(7);
        doc.setTextColor(110);
        doc.text(allocationWarningNote, margin, pageH - 22);
        const pageNum = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
        doc.text(`Page ${pageNum}`, pageW - margin, pageH - 22, { align: "right" });
        doc.setTextColor(0);
      },
    });

    if (!allocationRows.length) {
      const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`No ${fmt.blockLabel.toLowerCase()} rows match the current filters.`, margin, y);
      doc.setTextColor(0);
    }

    const safeName = (vineyardName ?? "vineyard").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    doc.save(`work-task-${fmt.blockLabel.toLowerCase()}-allocation-${safeName}-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({ title: "PDF exported", description: `${allocationRows.length} row${allocationRows.length === 1 ? "" : "s"} exported.` });
  };

  // -------------------- Allocation Excel export --------------------
  const downloadAllocationExcel = async () => {
    const XLSX = await import("xlsx");
    const areaLabel = fmt.areaUnitLabel;
    const currency = fmt.settings.currency_code;

    const meta: (string | number)[][] = [
      [allocationTitle],
      [`Vineyard: ${vineyardName ?? "—"}`],
      [`Generated: ${fmt.dateTime(new Date())}`],
      [`Filters: ${buildFilterSummary()}`],
      [allocationExplanation],
      [],
    ];

    const head: string[] = [
      fmt.blockLabel, "Tasks", `Area (${areaLabel})`,
      "Labour hours (allocated)", "Manual machine hours (allocated)", "Linked trips",
    ];
    if (canSeeCosts) {
      head.push(
        `Manual labour cost (${currency})`,
        `Machine charge (${currency})`,
        `Machine fuel (${currency})`,
        `Linked GPS trip cost (${currency})`,
        `Total allocated cost (${currency})`,
        `Cost / ${areaLabel} (${currency}/${areaLabel})`,
      );
    }
    head.push("Status");

    const body: (string | number)[][] = allocationRows.map((r) => {
      const areaDisp = r.hasAnyArea ? areaToDisplayUnit(r.areaHa) : null;
      const perHa = r.hasAnyArea && r.areaHa > 0 ? r.totalCost / r.areaHa : null;
      const perDisp = perHa == null ? null : (areaImperial ? perHa * HA_PER_AC : perHa);
      const base: (string | number)[] = [
        r.name,
        r.taskIds.size,
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
      }
      base.push(allocationStatus(r));
      return base;
    });

    const totalsRow: (string | number)[] = [
      "Totals (filtered)", "",
      allocationTotals.hasAnyArea ? Number((areaToDisplayUnit(allocationTotals.areaHa) ?? 0).toFixed(2)) : "",
      Number(allocationTotals.labourHours.toFixed(2)),
      Number(allocationTotals.machineHours.toFixed(2)),
      "",
    ];
    if (canSeeCosts) {
      const perHaTot = allocationTotals.areaHa > 0 ? allocationTotals.totalCost / allocationTotals.areaHa : null;
      const perDispTot = perHaTot == null ? null : (areaImperial ? perHaTot * HA_PER_AC : perHaTot);
      totalsRow.push(
        Number(allocationTotals.manualLabourCost.toFixed(2)),
        Number(allocationTotals.machineCharge.toFixed(2)),
        Number(allocationTotals.machineFuel.toFixed(2)),
        Number(allocationTotals.linkedTripTotal.toFixed(2)),
        Number(allocationTotals.totalCost.toFixed(2)),
        perDispTot == null ? "" : Number(perDispTot.toFixed(2)),
      );
    }
    totalsRow.push("");

    const footerRows: (string | number)[][] = [
      [],
      [allocationWarningNote],
    ];

    const aoa: (string | number)[][] = [
      ...meta,
      head,
      ...body,
      ...(allocationRows.length ? [totalsRow] : []),
      ...footerRows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const widths = head.map((h) => ({ wch: Math.max(12, Math.min(28, h.length + 2)) }));
    widths[0] = { wch: 28 };
    ws["!cols"] = widths;
    (ws as unknown as Record<string, unknown>)["!views"] = [{ state: "frozen", ySplit: meta.length + 1 }];

    const wb = XLSX.utils.book_new();
    const sheetName = `${fmt.blockLabel} Allocation`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const safeName = (vineyardName ?? "vineyard").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    XLSX.writeFile(wb, `work-task-${fmt.blockLabel.toLowerCase()}-allocation-${safeName}-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast({ title: "Excel exported", description: `${allocationRows.length} row${allocationRows.length === 1 ? "" : "s"} exported.` });
  };
  // Toggle + Block + Tasks + Area + Labour + Machine + Linked + Status = 8 base; cost adds 6.
  const allocColSpan = 8 + (canSeeCosts ? 6 : 0);

  // Independent expand state for allocation rows (keyed by row.key, e.g. paddockId
  // or "__unallocated__"). Kept separate from `expanded` so opening an allocation
  // row doesn't toggle a task row in the other tab.
  const [allocExpanded, setAllocExpanded] = useState<Set<string>>(() => new Set());
  const toggleAllocExpanded = (key: string) =>
    setAllocExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const loading =
    tasksQ.isLoading || labourQ.isLoading || machineQ.isLoading ||
    wtPaddocksQ.isLoading || tripsQ.isLoading || (canSeeCosts && allocQ.isLoading);

  return (
    <div className="p-6 space-y-4 w-full">
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
        <div className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} task${rows.length === 1 ? "" : "s"}`}
        </div>
      </Card>

      <Tabs defaultValue="task-summary" className="space-y-3">
        <TabsList>
          <TabsTrigger value="task-summary">Task Summary</TabsTrigger>
          <TabsTrigger value="block-allocation">{fmt.blockLabel} Allocation</TabsTrigger>
        </TabsList>

        {/* -------------------- Task Summary tab (existing view) -------------------- */}
        <TabsContent value="task-summary" className="space-y-3 mt-0">
          <div className="flex items-center justify-end gap-2">
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

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Task type</TableHead>
                  <TableHead>{fmt.blocksLabel}</TableHead>
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
        </TabsContent>

        {/* -------------------- Block Allocation tab (Stage 5H) -------------------- */}
        <TabsContent value="block-allocation" className="space-y-3 mt-0">
          <Card className="p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {`${fmt.blockLabel} allocation is estimated by area share of each Work Task. Values are calculated for reporting and are not written back to the database.`}
            </p>
            {canSeeCosts && (
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Linked GPS trip costs may include operator labour, fuel, chemicals
                and inputs.
              </p>
            )}
          </Card>

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {loading ? "Loading…" : `${allocationRows.length} ${fmt.blockLabel.toLowerCase()} row${allocationRows.length === 1 ? "" : "s"} from ${filtered.length} task${filtered.length === 1 ? "" : "s"}`}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={downloadAllocationPdf} disabled={!allocationRows.length}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Export PDF
              </Button>
              <Button size="sm" variant="outline" onClick={downloadAllocationExcel} disabled={!allocationRows.length}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Export Excel
              </Button>
              <Button size="sm" onClick={downloadAllocationCsv} disabled={!allocationRows.length}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Export CSV
              </Button>
            </div>
          </div>

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{fmt.blockLabel}</TableHead>
                  <TableHead className="text-right">Tasks</TableHead>
                  <TableHead className="text-right">Area</TableHead>
                  <TableHead className="text-right">Labour hrs</TableHead>
                  <TableHead className="text-right">Machine hrs</TableHead>
                  <TableHead className="text-right">Linked trips</TableHead>
                  {canSeeCosts && (
                    <>
                      <TableHead className="text-right">Manual labour</TableHead>
                      <TableHead className="text-right">Machine charge</TableHead>
                      <TableHead className="text-right">Machine fuel</TableHead>
                      <TableHead className="text-right">Linked GPS trips</TableHead>
                      <TableHead className="text-right">Total allocated cost</TableHead>
                      <TableHead className="text-right">{costPerAreaLabel}</TableHead>
                    </>
                  )}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocationRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={allocColSpan} className="text-center text-sm text-muted-foreground py-8">
                      {loading ? "Loading…" : `No ${fmt.blockLabel.toLowerCase()} rows for the current filters.`}
                    </TableCell>
                  </TableRow>
                ) : allocationRows.map((r) => {
                  const status = allocationStatus(r);
                  const isReview = status !== "OK";
                  const isOpen = allocExpanded.has(r.key);
                  return (
                    <Fragment key={r.key}>
                      <TableRow className={r.isUnallocated ? "bg-muted/20" : undefined}>
                        <TableCell className="p-1 align-middle">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={isOpen ? "Collapse contributing tasks" : "Expand contributing tasks"}
                            aria-expanded={isOpen}
                            onClick={() => toggleAllocExpanded(r.key)}
                          >
                            {isOpen
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.taskIds.size}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.hasAnyArea ? areaDisplay(r.areaHa) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.labourHours.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.machineHours.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.linkedTripCount}</TableCell>
                        {canSeeCosts && (
                          <>
                            <TableCell className="text-right tabular-nums">{money(r.manualLabourCost)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(r.machineCharge)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(r.machineFuel)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(r.linkedTripTotal)}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{money(r.totalCost)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.hasAnyArea ? costPerAreaDisplay(r.totalCost, r.areaHa) : "—"}
                            </TableCell>
                          </>
                        )}
                        <TableCell>
                          {isReview ? (
                            <span title="Review: linked GPS trips and manual correction/missed machine entries may overlap.">
                              <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300 gap-1">
                                <AlertTriangle className="h-3 w-3" /> {status}
                              </Badge>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">OK</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={allocColSpan} className="p-3 sm:p-4">
                            <AllocationContributions
                              row={r}
                              canSeeCosts={canSeeCosts}
                              money={money}
                              areaDisplay={areaDisplay}
                              costPerAreaDisplay={costPerAreaDisplay}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
              {allocationRows.length > 0 && (
                <TableBody>
                  <TableRow className="bg-muted/30">
                    <TableCell />
                    <TableCell className="font-medium">Totals (filtered)</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums font-medium">
                      {allocationTotals.hasAnyArea ? areaDisplay(allocationTotals.areaHa) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{allocationTotals.labourHours.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{allocationTotals.machineHours.toFixed(2)}</TableCell>
                    <TableCell />
                    {canSeeCosts && (
                      <>
                        <TableCell className="text-right tabular-nums font-medium">{money(allocationTotals.manualLabourCost)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{money(allocationTotals.machineCharge)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{money(allocationTotals.machineFuel)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{money(allocationTotals.linkedTripTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{money(allocationTotals.totalCost)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {allocationTotals.hasAnyArea ? costPerAreaDisplay(allocationTotals.totalCost, allocationTotals.areaHa) : "—"}
                        </TableCell>
                      </>
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
        </TabsContent>
      </Tabs>
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
                        {l.worker_type?.trim() || l.worker_type_id || "—"}
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

// ---------------------------------------------------------------------------
// Block/Paddock allocation — expanded row showing which Work Tasks contributed
// to that block's allocated totals. Pure presentation — no mutations.
// Stage 5H.1.
// ---------------------------------------------------------------------------

interface AllocationContributionsProps {
  row: AllocRow;
  canSeeCosts: boolean;
  money: (n: number) => string;
  areaDisplay: (haValue: number | null) => string;
  costPerAreaDisplay: (totalCost: number, haValue: number | null) => string;
}

function AllocationContributions({
  row, canSeeCosts, money, areaDisplay, costPerAreaDisplay,
}: AllocationContributionsProps) {
  const fmtDate = (v: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "—" : format(d, "PP");
  };

  if (row.contributions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        No contributing tasks.
      </div>
    );
  }

  const anyOverlap = row.contributions.some((c) => c.hasOverlapWarning);

  return (
    <div className="space-y-3">
      {anyOverlap && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Review: linked GPS trips and manual correction/missed machine entries may overlap.</span>
        </div>
      )}

      {/* Desktop / tablet: compact table. */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Task type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Area</TableHead>
              <TableHead className="text-right">Labour hrs</TableHead>
              <TableHead className="text-right">Machine hrs</TableHead>
              <TableHead className="text-right">Linked trips</TableHead>
              {canSeeCosts && (
                <>
                  <TableHead className="text-right">Manual labour</TableHead>
                  <TableHead className="text-right">Machine charge</TableHead>
                  <TableHead className="text-right">Machine fuel</TableHead>
                  <TableHead className="text-right">Linked GPS trips</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Cost / area</TableHead>
                </>
              )}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.contributions.map((c) => {
              const statusParts: string[] = [];
              if (c.reason) statusParts.push(c.reason);
              if (c.hasOverlapWarning) statusParts.push("Review overlap");
              const status = statusParts.length ? statusParts.join(" • ") : "OK";
              const isReview = status !== "OK";
              return (
                <TableRow key={c.taskId}>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDate(c.date)}</TableCell>
                  <TableCell className="text-xs">{c.taskType}</TableCell>
                  <TableCell className="text-xs max-w-[240px] truncate" title={c.description ?? ""}>
                    {c.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {c.share == null ? "—" : `${(c.share * 100).toFixed(1)}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {c.areaHa == null ? "—" : areaDisplay(c.areaHa)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{c.labourHours.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{c.machineHours.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{c.linkedTripCount}</TableCell>
                  {canSeeCosts && (
                    <>
                      <TableCell className="text-right tabular-nums text-xs">{money(c.manualLabourCost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{money(c.machineCharge)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{money(c.machineFuel)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{money(c.linkedTripTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-medium">{money(c.totalCost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {costPerAreaDisplay(c.totalCost, c.areaHa)}
                      </TableCell>
                    </>
                  )}
                  <TableCell>
                    {isReview ? (
                      <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300 text-[10px] py-0 px-1.5">
                        {status}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">OK</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards. */}
      <div className="md:hidden space-y-2">
        {row.contributions.map((c) => {
          const statusParts: string[] = [];
          if (c.reason) statusParts.push(c.reason);
          if (c.hasOverlapWarning) statusParts.push("Review overlap");
          const status = statusParts.length ? statusParts.join(" • ") : null;
          return (
            <div key={c.taskId} className="rounded-md border bg-background/50 p-2 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.taskType}</span>
                <span className="text-muted-foreground">{fmtDate(c.date)}</span>
              </div>
              {c.description && (
                <div className="text-foreground/80 line-clamp-2">{c.description}</div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                <div>Share: <span className="text-foreground">{c.share == null ? "—" : `${(c.share * 100).toFixed(1)}%`}</span></div>
                <div>Area: <span className="text-foreground">{c.areaHa == null ? "—" : areaDisplay(c.areaHa)}</span></div>
                <div>Labour: <span className="text-foreground">{c.labourHours.toFixed(2)} h</span></div>
                <div>Machine: <span className="text-foreground">{c.machineHours.toFixed(2)} h</span></div>
                <div>Linked trips: <span className="text-foreground">{c.linkedTripCount}</span></div>
                {canSeeCosts && (
                  <>
                    <div>Manual labour: <span className="text-foreground">{money(c.manualLabourCost)}</span></div>
                    <div>Machine charge: <span className="text-foreground">{money(c.machineCharge)}</span></div>
                    <div>Machine fuel: <span className="text-foreground">{money(c.machineFuel)}</span></div>
                    <div>Linked GPS: <span className="text-foreground">{money(c.linkedTripTotal)}</span></div>
                    <div className="col-span-2">Total: <span className="text-foreground font-medium">{money(c.totalCost)}</span> · <span className="text-foreground">{costPerAreaDisplay(c.totalCost, c.areaHa)}</span></div>
                  </>
                )}
              </div>
              {status && (
                <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300 text-[10px] py-0 px-1.5">
                  {status}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
