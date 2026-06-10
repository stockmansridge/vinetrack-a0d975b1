import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { fetchList } from "@/lib/queries";
import { fetchOperatorCategoriesForVineyard, type OperatorCategory } from "@/lib/operatorCategoriesQuery";
import { useCanSeeCosts, canSeeCosts as canSeeCostsFn } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  SheetFooter,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useSortableTable } from "@/lib/useSortableTable";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { Fragment } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Download } from "lucide-react";
import {
  fetchWorkTasksForVineyard,
  fetchLabourLinesForVineyard,
  fetchWorkTaskPaddocksForVineyard,
  syncWorkTaskPaddocks,
  createWorkTask,
  updateWorkTask,
  createLabourLine,
  updateLabourLine,
  softDeleteLabourLine,
  type WorkTask,
  type WorkTaskLabourLine,
  type WorkTaskPaddock,
  type UpsertLabourLineInput,
} from "@/lib/workTasksQuery";
import {
  fetchWorkTaskTypesForVineyard,
  createWorkTaskType,
  mergeTaskTypeNames,
  type WorkTaskType,
} from "@/lib/workTaskTypesQuery";
import { fetchTripsForVineyard, type Trip } from "@/lib/tripsQuery";
import {
  fetchWorkTaskMachineLinesForVineyard,
  resolveMachineLineEquipmentName,
  createWorkTaskMachineLine,
  updateWorkTaskMachineLine,
  softDeleteWorkTaskMachineLine,
  describeMachineLineWriteError,
  type WorkTaskMachineLine,
  type WorkTaskMachineEquipmentSource,
} from "@/lib/workTaskMachineLinesQuery";
import {
  formatTripNameLabel,
  formatTripFunctionLabel,
  formatTripDurationLabel,
} from "@/lib/tripDisplay";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";

interface PaddockLite {
  id: string;
  name: string | null;
  area_ha?: number | null;
  // Full paddock row is loaded via fetchList("paddocks"); we keep extras as
  // any-shaped so deriveMetrics() can read polygon_points / rows / overrides.
  [key: string]: any;
}

/** Resolve the effective area (ha) for a paddock — prefer the stored
 *  area_ha column, then fall back to polygon-derived area. Returns 0 when
 *  neither source produces a positive area. */
function paddockAreaHa(p: PaddockLite | undefined | null): number {
  if (!p) return 0;
  const stored = p.area_ha != null ? Number(p.area_ha) : NaN;
  if (Number.isFinite(stored) && stored > 0) return stored;
  try {
    const derived = deriveMetrics(p).areaHa;
    return Number.isFinite(derived) && derived > 0 ? derived : 0;
  } catch {
    return 0;
  }
}

const ANY = "__any__";
const NONE = "__none__";

// Aligned with iOS Task Log model: Task Log entries are historical records of
// completed work. "planned" is intentionally omitted so new entries do not
// trigger iOS overdue alerts. Scheduling statuses can be re-introduced once
// iOS exposes a scheduled-task workflow.
const STATUS_OPTIONS = ["completed", "in_progress", "on_hold", "cancelled"];
// Fallback/seed list shown when no synced rows exist. Kept in sync with iOS defaults.
const DEFAULT_TASK_TYPES = [
  "Pruning",
  "Spraying",
  "Mowing",
  "Slashing",
  "Trimming",
  "Leaf plucking",
  "Shoot thinning",
  "Wire lifting",
  "Irrigation",
  "Fertilising",
  "Harvesting",
  "Planting",
  "Replanting",
  "Trellis repair",
  "Weeding",
  "Mulching",
  "Soil work",
  "Inspection",
  "Other",
];

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const num = (v: any, digits = 2) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(digits);

const mkFmtDate = (rf: RegionFormatters) => (v?: string | null) => {
  if (!v) return "—";
  return rf.date(v) || "—";
};
const mkMoney = (rf: RegionFormatters) => (v: any) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : rf.currency(Number(v));
const mkDateRangeLabel = (rf: RegionFormatters) => {
  const fd = mkFmtDate(rf);
  return (t: WorkTask) => {
    const s = t.start_date ?? t.date ?? null;
    const e = t.end_date ?? null;
    if (!s && !e) return "—";
    if (s && e && s !== e) return `${fd(s)} → ${fd(e)}`;
    return fd(s ?? e);
  };
};
const effectiveStart = (t: WorkTask) => t.start_date ?? t.date ?? null;
const effectiveEnd = (t: WorkTask) => t.end_date ?? t.start_date ?? t.date ?? null;

export default function WorkTasksPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const rf = useRegionFormatters();
  const fmtDate = mkFmtDate(rf);
  const money = mkMoney(rf);
  const dateRangeLabel = mkDateRangeLabel(rf);
  const areaUnit = rf.areaUnitLabel;
  const qc = useQueryClient();

  const canSoftDelete = currentRole === "owner" || currentRole === "manager" || currentRole === "supervisor";
  const canSeeCosts = useCanSeeCosts();

  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchParams] = useSearchParams();
  const initialPaddock = searchParams.get("paddock") ?? ANY;
  const [paddockId, setPaddockId] = useState<string>(initialPaddock);
  useEffect(() => {
    const p = searchParams.get("paddock");
    if (p) setPaddockId(p);
  }, [searchParams]);
  const [taskType, setTaskType] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [workerType, setWorkerType] = useState<string>(ANY);
  const [labourFilter, setLabourFilter] = useState<string>(ANY); // any|has|missing
  const [selected, setSelected] = useState<WorkTask | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: paddocks = [] } = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<PaddockLite>("paddocks", selectedVineyardId!),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["operator-categories", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchOperatorCategoriesForVineyard(selectedVineyardId!).then((r) => r.categories),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });


  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);
  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);
  const paddockById = useMemo(() => {
    const m = new Map<string, PaddockLite>();
    paddocks.forEach((p) => m.set(p.id, p));
    return m;
  }, [paddocks]);
  const categoryById = useMemo(() => {
    const m = new Map<string, OperatorCategory>();
    (Array.isArray(categories) ? categories : []).forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["work_tasks", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWorkTasksForVineyard(selectedVineyardId!, paddockIds),
  });

  const { data: labourLines = [] } = useQuery({
    queryKey: ["work_task_labour_lines", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchLabourLinesForVineyard(selectedVineyardId!),
  });

  const { data: taskPaddocks = [] } = useQuery({
    queryKey: ["work_task_paddocks", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWorkTaskPaddocksForVineyard(selectedVineyardId!),
  });

  const { data: syncedTaskTypes = [] } = useQuery({
    queryKey: ["work_task_types", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWorkTaskTypesForVineyard(selectedVineyardId!),
    staleTime: 0,
    refetchOnMount: "always",
  });

  // SQL 102 — trips can now link back to a work task via work_task_id.
  // Read-only awareness only at this stage; no linking UI.
  const { data: tripsResult } = useQuery({
    queryKey: ["trips", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchTripsForVineyard(selectedVineyardId!, paddockIds),
  });
  const trips: Trip[] = tripsResult?.trips ?? [];

  // SQL 103 — manually-entered machine usage attached to a work task.
  const { data: machineLines = [] } = useQuery({
    queryKey: ["work_task_machine_lines", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWorkTaskMachineLinesForVineyard(selectedVineyardId!),
  });

  // Equipment lookups for resolveMachineLineEquipmentName().
  const { data: vineyardMachines = [] } = useQuery({
    queryKey: ["vineyard_machines-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("vineyard_machines", selectedVineyardId!),
  });
  const { data: tractorsList = [] } = useQuery({
    queryKey: ["tractors-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("tractors", selectedVineyardId!),
  });
  const { data: sprayEquipmentList = [] } = useQuery({
    queryKey: ["spray_equipment-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("spray_equipment", selectedVineyardId!),
  });
  const { data: equipmentItemsList = [] } = useQuery({
    queryKey: ["equipment_items-lite", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<{ id: string; name?: string | null }>("equipment_items", selectedVineyardId!),
  });
  const machineLookups = useMemo(
    () => ({
      machines: vineyardMachines,
      tractors: tractorsList,
      sprayEquipment: sprayEquipmentList,
      equipmentItems: equipmentItemsList,
    }),
    [vineyardMachines, tractorsList, sprayEquipmentList, equipmentItemsList],
  );

  const tripsByTask = useMemo(() => {
    const m = new Map<string, Trip[]>();
    trips.forEach((t) => {
      if (!t.work_task_id) return;
      const arr = m.get(t.work_task_id) ?? [];
      arr.push(t);
      m.set(t.work_task_id, arr);
    });
    return m;
  }, [trips]);

  const machineLinesByTask = useMemo(() => {
    const m = new Map<string, WorkTaskMachineLine[]>();
    machineLines.forEach((l) => {
      if (l.deleted_at) return;
      const arr = m.get(l.work_task_id) ?? [];
      arr.push(l);
      m.set(l.work_task_id, arr);
    });
    return m;
  }, [machineLines]);

  const tasks = data?.tasks ?? [];

  const paddocksByTask = useMemo(() => {
    const m = new Map<string, WorkTaskPaddock[]>();
    taskPaddocks.forEach((p) => {
      const arr = m.get(p.work_task_id) ?? [];
      arr.push(p);
      m.set(p.work_task_id, arr);
    });
    return m;
  }, [taskPaddocks]);

  const linesByTask = useMemo(() => {
    const m = new Map<string, WorkTaskLabourLine[]>();
    labourLines.forEach((l) => {
      if (!l.work_task_id) return;
      const arr = m.get(l.work_task_id) ?? [];
      arr.push(l);
      m.set(l.work_task_id, arr);
    });
    return m;
  }, [labourLines]);

  const totalsByTask = useMemo(() => {
    const m = new Map<string, { hours: number; cost: number; missingRate: boolean; workerTypes: Set<string> }>();
    labourLines.forEach((l) => {
      const t = m.get(l.work_task_id) ?? { hours: 0, cost: 0, missingRate: false, workerTypes: new Set<string>() };
      t.hours += Number(l.total_hours ?? 0) || 0;
      if (l.total_cost != null) t.cost += Number(l.total_cost) || 0;
      else if (l.worker_count && l.hours_per_worker) t.missingRate = true;
      if (l.worker_type) t.workerTypes.add(l.worker_type);
      m.set(l.work_task_id, t);
    });
    return m;
  }, [labourLines]);

  const taskTypes = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => t.task_type && s.add(t.task_type));
    return Array.from(s).sort();
  }, [tasks]);

  const workerTypes = useMemo(() => {
    const s = new Set<string>();
    labourLines.forEach((l) => l.worker_type && s.add(l.worker_type));
    return Array.from(s).sort();
  }, [labourLines]);

  // Selected paddock IDs per task (join rows preferred, fallback to task.paddock_id).
  const taskPaddockIds = useMemo(() => {
    const m = new Map<string, string[]>();
    tasks.forEach((t) => {
      const join = paddocksByTask.get(t.id);
      if (join && join.length) m.set(t.id, join.map((j) => j.paddock_id));
      else if (t.paddock_id) m.set(t.id, [t.paddock_id]);
      else m.set(t.id, []);
    });
    return m;
  }, [tasks, paddocksByTask]);

  const taskPaddockNames = (taskId: string): string => {
    const ids = taskPaddockIds.get(taskId) ?? [];
    if (!ids.length) return "";
    return ids
      .map((id) => paddockNameById.get(id) ?? id.slice(0, 8))
      .filter(Boolean)
      .join(", ");
  };

  /**
   * Effective area resolver for a task.
   * 1) task.area_ha if positive
   * 2) sum of work_task_paddocks.area_ha for the task (if any present)
   * 3) sum of paddockAreaHa() for taskPaddockIds (covers legacy rows where
   *    iPhone-created task logs only have paddock_id and no area_ha)
   * 4) null
   */
  const effectiveTaskAreaHa = (t: WorkTask): number | null => {
    const stored = t.area_ha == null ? NaN : Number(t.area_ha);
    if (Number.isFinite(stored) && stored > 0) return stored;
    const joinRows = paddocksByTask.get(t.id) ?? [];
    if (joinRows.length) {
      const sum = joinRows.reduce((s, r) => s + (Number(r.area_ha) > 0 ? Number(r.area_ha) : 0), 0);
      if (sum > 0) return sum;
    }
    const ids = taskPaddockIds.get(t.id) ?? [];
    if (ids.length) {
      const sum = ids.reduce((s, id) => s + paddockAreaHa(paddockById.get(id)), 0);
      if (sum > 0) return sum;
    }
    return null;
  };

  const filtered = useMemo(() => {
    let list = tasks.slice();
    if (from) list = list.filter((t) => (effectiveEnd(t) ?? "") >= from);
    if (to) list = list.filter((t) => (effectiveStart(t) ?? "") <= to);
    if (paddockId !== ANY)
      list = list.filter((t) => (taskPaddockIds.get(t.id) ?? []).includes(paddockId));
    if (taskType !== ANY) list = list.filter((t) => t.task_type === taskType);
    if (status !== ANY) list = list.filter((t) => (t.status ?? "") === status);
    if (workerType !== ANY) {
      list = list.filter((t) => (totalsByTask.get(t.id)?.workerTypes ?? new Set()).has(workerType));
    }
    if (labourFilter === "has") list = list.filter((t) => (linesByTask.get(t.id)?.length ?? 0) > 0);
    if (labourFilter === "missing") list = list.filter((t) => (linesByTask.get(t.id)?.length ?? 0) === 0);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((t) =>
        [t.task_type, taskPaddockNames(t.id), t.notes, t.description, t.status, t.date]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filter, from, to, paddockId, taskType, status, workerType, labourFilter, linesByTask, totalsByTask, taskPaddockIds]);

  // Dev-only sync diagnostic: keep visibility on rows that still need
  // area_ha hydration after Rork's iPhone fix lands.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!tasks.length) return;
    let withArea = 0;
    let recoveredFromPaddock = 0;
    let stillMissing = 0;
    tasks.forEach((t) => {
      const stored = t.area_ha == null ? NaN : Number(t.area_ha);
      if (Number.isFinite(stored) && stored > 0) {
        withArea++;
        return;
      }
      const eff = effectiveTaskAreaHa(t);
      if (eff != null && eff > 0) recoveredFromPaddock++;
      else stillMissing++;
    });
    // eslint-disable-next-line no-console
    console.info("[work_tasks/area] diagnostic", {
      total: tasks.length,
      withAreaHa: withArea,
      recoveredFromPaddock,
      stillMissing,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, paddocksByTask, taskPaddockIds, paddockById]);


  type SortKey = "date" | "paddock" | "task_type" | "status" | "area_ha" | "hours" | "cost" | "finalized";
  const accessors = useMemo(
    () => ({
      date: (r: WorkTask) => effectiveStart(r),
      paddock: (r: WorkTask) => taskPaddockNames(r.id),
      task_type: (r: WorkTask) => r.task_type ?? "",
      status: (r: WorkTask) => r.status ?? "",
      area_ha: (r: WorkTask) => {
        const v = effectiveTaskAreaHa(r);
        return v == null ? null : v;
      },
      hours: (r: WorkTask) => totalsByTask.get(r.id)?.hours ?? 0,
      cost: (r: WorkTask) => totalsByTask.get(r.id)?.cost ?? 0,
      finalized: (r: WorkTask) => (r.is_finalized ? 1 : 0),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paddockNameById, totalsByTask, taskPaddockIds, paddocksByTask, paddockById],
  );

  const { sorted: rows, getSortDirection, toggleSort } = useSortableTable<WorkTask, SortKey>(filtered, {
    accessors,
    initial: { key: "date", direction: "desc" },
  });

  const WT_COLS = ["date","paddock","task_type","status","area_ha","hours",...(canSeeCosts ? ["cost"] : []),"notes"] as const;
  type WtCol = "date"|"paddock"|"task_type"|"status"|"area_ha"|"hours"|"cost"|"notes";
  const { order: wtOrder, moveColumn: wtMove, reset: wtReset } = useColumnOrder(
    "work_tasks_table",
    WT_COLS as unknown as string[],
    { vineyardId: selectedVineyardId },
  );

  const exportCsv = () => {
    const headers = canSeeCosts
      ? ["Task ID","Start","End","Blocks","Task type","Status","Area ha (total)","Total hours","Total cost","Cost per ha","Worker types","Description","Notes"]
      : ["Task ID","Start","End","Blocks","Task type","Status","Area ha (total)","Total hours","Worker types","Description","Notes"];
    const lines = [headers.join(",")];
    rows.forEach((t) => {
      const tot = totalsByTask.get(t.id);
      const padNames = taskPaddockNames(t.id);
      const areaHa = effectiveTaskAreaHa(t);
      const costPerHa = areaHa && tot?.cost ? (tot.cost / areaHa).toFixed(2) : "";
      const base = [
        t.id,
        effectiveStart(t) ?? "",
        effectiveEnd(t) ?? "",
        padNames,
        t.task_type ?? "",
        t.status ?? "",
        areaHa == null ? "" : areaHa.toFixed(4),
        tot?.hours?.toFixed(2) ?? "0",
      ];
      const tail = [
        Array.from(tot?.workerTypes ?? []).join("; "),
        (t.description ?? "").replace(/\s+/g, " "),
        (t.notes ?? "").replace(/\s+/g, " "),
      ];
      const cells = (canSeeCosts
        ? [...base, tot?.cost?.toFixed(2) ?? "", costPerHa, ...tail]
        : [...base, ...tail]
      ).map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `work-tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Work Tasks</h1>
          <p className="text-sm text-muted-foreground">
            View and manage task logs for completed vineyard work.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Task Log
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Filter label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Filter>
        <Filter label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Filter>
        <Filter label="Block">
          <Select value={paddockId} onValueChange={setPaddockId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {paddocks.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</SelectItem>))}
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Task type">
          <Select value={taskType} onValueChange={setTaskType}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {taskTypes.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Status">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {STATUS_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Worker type">
          <Select value={workerType} onValueChange={setWorkerType}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {workerTypes.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Labour lines">
          <Select value={labourFilter} onValueChange={setLabourFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              <SelectItem value="has">Has lines</SelectItem>
              <SelectItem value="missing">Missing lines</SelectItem>
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Search">
          <Input
            placeholder="Type, block, notes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
        </Filter>
      </div>

      <div className="flex justify-end">
        <ColumnSettingsMenu onReset={wtReset} />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {(wtOrder as WtCol[]).map((id) => {
                if (id === "cost" && !canSeeCosts) return null;
                const align: "left" | "right" = (id === "area_ha" || id === "hours" || id === "cost") ? "right" : "left";
                const labels: Record<WtCol, string> = {
                  date: "Date / range", paddock: "Blocks", task_type: "Type", status: "Status",
                  area_ha: "Area", hours: "Hours", cost: "Cost", notes: "Notes",
                };
                const sortable = id !== "notes";
                return (
                  <ReorderableHead key={id} columnId={id} onDropColumn={wtMove} align={align}
                    sort={sortable ? { active: getSortDirection(id as SortKey), onSort: () => toggleSort(id as SortKey) } : undefined}>
                    {labels[id]}
                  </ReorderableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={canSeeCosts ? 8 : 7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={canSeeCosts ? 8 : 7} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canSeeCosts ? 8 : 7} className="text-center text-muted-foreground py-8">
                  No work tasks found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const padIds = taskPaddockIds.get(t.id) ?? [];
              const padNamesFull = taskPaddockNames(t.id);
              const blockCellLabel =
                padIds.length === 0
                  ? "No block"
                  : padIds.length === 1
                    ? (padNamesFull || "—")
                    : `${padIds.length} blocks`;
              const tot = totalsByTask.get(t.id);
              const summary = (t.description ?? t.notes ?? "").trim();
              const linkedTripsCount = tripsByTask.get(t.id)?.length ?? 0;
              const machineLineCount = machineLinesByTask.get(t.id)?.length ?? 0;
              const relIndicator = (linkedTripsCount > 0 || machineLineCount > 0) ? (
                <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
                  {linkedTripsCount > 0 && <span>Trips: {linkedTripsCount}</span>}
                  {linkedTripsCount > 0 && machineLineCount > 0 && <span>·</span>}
                  {machineLineCount > 0 && <span>Machine: {machineLineCount}</span>}
                </div>
              ) : null;
              const cellMap: Record<WtCol, React.ReactNode> = {
                date: <TableCell>{dateRangeLabel(t)}</TableCell>,
                paddock: <TableCell title={padNamesFull || undefined}>{blockCellLabel}</TableCell>,
                task_type: (
                  <TableCell>
                    {t.task_type ? <Badge variant="secondary">{t.task_type}</Badge> : "—"}
                    {relIndicator}
                  </TableCell>
                ),
                status: <TableCell>{t.status ? <Badge variant="outline">{t.status}</Badge> : "—"}</TableCell>,
                area_ha: <TableCell className="text-right">{(() => { const v = effectiveTaskAreaHa(t); return v == null ? "—" : rf.area(v); })()}</TableCell>,
                hours: <TableCell className="text-right">{num(tot?.hours ?? 0)}</TableCell>,
                cost: (
                  <TableCell className="text-right">
                    {tot?.cost ? money(tot.cost) : tot?.missingRate ? <span className="text-xs text-muted-foreground">add rates</span> : "—"}
                  </TableCell>
                ),
                notes: <TableCell className="max-w-[18rem] truncate text-xs text-muted-foreground">{summary || "—"}</TableCell>,
              };
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                  {(wtOrder as WtCol[]).map((id) => {
                    if (id === "cost" && !canSeeCosts) return null;
                    return <Fragment key={id}>{cellMap[id]}</Fragment>;
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <WorkTaskDrawer
        key={selected?.id ?? "new"}
        task={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        paddocks={paddocks}
        existingPaddocks={selected ? paddocksByTask.get(selected.id) ?? [] : []}
        categories={categories}
        syncedTaskTypes={syncedTaskTypes}
        labourLines={selected ? linesByTask.get(selected.id) ?? [] : []}
        linkedTrips={selected ? tripsByTask.get(selected.id) ?? [] : []}
        machineLines={selected ? machineLinesByTask.get(selected.id) ?? [] : []}
        machineLookups={machineLookups}
        canSoftDelete={canSoftDelete}
        userId={user?.id ?? null}
        vineyardId={selectedVineyardId}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["work_tasks"] });
          qc.invalidateQueries({ queryKey: ["work_task_labour_lines"] });
          qc.invalidateQueries({ queryKey: ["work_task_paddocks"] });
          qc.invalidateQueries({ queryKey: ["work_task_types"] });
        }}
      />

      <WorkTaskDrawer
        key={createOpen ? "create-open" : "create-closed"}
        task={null}
        open={createOpen}
        onOpenChange={setCreateOpen}
        paddocks={paddocks}
        existingPaddocks={[]}
        categories={categories}
        syncedTaskTypes={syncedTaskTypes}
        labourLines={[]}
        linkedTrips={[]}
        machineLines={[]}
        machineLookups={machineLookups}
        canSoftDelete={canSoftDelete}
        userId={user?.id ?? null}
        vineyardId={selectedVineyardId}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["work_tasks"] });
          qc.invalidateQueries({ queryKey: ["work_task_labour_lines"] });
          qc.invalidateQueries({ queryKey: ["work_task_paddocks"] });
          qc.invalidateQueries({ queryKey: ["work_task_types"] });
        }}
      />
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

interface DrawerProps {
  task: WorkTask | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  paddocks: PaddockLite[];
  existingPaddocks: WorkTaskPaddock[];
  categories: OperatorCategory[];
  syncedTaskTypes: WorkTaskType[];
  labourLines: WorkTaskLabourLine[];
  linkedTrips: Trip[];
  machineLines: WorkTaskMachineLine[];
  machineLookups: {
    machines: ReadonlyArray<{ id: string; name?: string | null }>;
    tractors: ReadonlyArray<{ id: string; name?: string | null }>;
    sprayEquipment: ReadonlyArray<{ id: string; name?: string | null }>;
    equipmentItems: ReadonlyArray<{ id: string; name?: string | null }>;
  };
  canSoftDelete: boolean;
  userId: string | null;
  vineyardId: string | null;
  onSaved: () => void;
}

function WorkTaskDrawer({
  task, open, onOpenChange, paddocks, existingPaddocks, categories, syncedTaskTypes, labourLines, linkedTrips, machineLines, machineLookups, canSoftDelete, userId, vineyardId, onSaved,
}: DrawerProps) {
  const isNew = !task;
  const rf = useRegionFormatters();
  const fmtDate = mkFmtDate(rf);
  const money = mkMoney(rf);
  const dateRangeLabel = mkDateRangeLabel(rf);
  const areaUnit = rf.areaUnitLabel;

  // Initial selection: prefer join rows, fallback to legacy single paddock_id.
  const initialPaddockIds = useMemo(() => {
    if (existingPaddocks.length) return existingPaddocks.map((r) => r.paddock_id);
    if (task?.paddock_id) return [task.paddock_id];
    return [];
  }, [existingPaddocks, task?.paddock_id]);

  const [paddockIds, setPaddockIds] = useState<string[]>(initialPaddockIds);
  const [paddocksOpen, setPaddocksOpen] = useState(false);
  const [taskType, setTaskType] = useState<string>(task?.task_type ?? "");
  const [status, setStatus] = useState<string>(task?.status ?? "");
  const [startDate, setStartDate] = useState<string>(task?.start_date ?? task?.date ?? "");
  const [endDate, setEndDate] = useState<string>(task?.end_date ?? "");
  const [description, setDescription] = useState<string>(task?.description ?? "");
  const [notes, setNotes] = useState<string>(task?.notes ?? "");
  const [isFinalized, setIsFinalized] = useState<boolean>(!!task?.is_finalized);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(task?.id ?? null);

  useEffect(() => { setSavedTaskId(task?.id ?? null); }, [task?.id]);

  const togglePaddock = (id: string) => {
    setPaddockIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectedPaddocks = useMemo(
    () => paddockIds.map((id) => paddocks.find((p) => p.id === id)).filter(Boolean) as PaddockLite[],
    [paddockIds, paddocks],
  );
  const paddockAreas = useMemo(
    () => selectedPaddocks.map((p) => ({ paddock: p, areaHa: paddockAreaHa(p) })),
    [selectedPaddocks],
  );
  const paddockMissingArea = paddockAreas.some(({ areaHa }) => !(areaHa > 0));
  const totalAreaHa = paddockAreas.reduce((sum, x) => sum + x.areaHa, 0);
  const areaHaDisplay = selectedPaddocks.length
    ? Number(totalAreaHa.toFixed(4)).toString()
    : "";

  const saveTask = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard selected");
      const padNames = selectedPaddocks.map((p) => p.name ?? p.id.slice(0, 8)).join(", ");
      const input = {
        id: task?.id,
        vineyard_id: vineyardId,
        // Keep first paddock id populated for backward compatibility with iOS
        // clients that read work_tasks.paddock_id directly.
        paddock_id: paddockIds[0] ?? null,
        paddock_name: padNames || null,
        task_type: taskType.trim() || null,
        status: status || null,
        start_date: startDate || null,
        end_date: endDate || null,
        date: startDate || task?.date || null,
        // Preserve existing area_ha when no paddocks are selected on edit,
        // so legacy iPhone-created rows aren't accidentally cleared.
        area_ha: selectedPaddocks.length ? totalAreaHa : (task?.area_ha ?? null),
        description,
        notes,
        is_finalized: isFinalized,
        user_id: userId,
        current_sync_version: task?.sync_version ?? 0,
      };
      const saved = isNew ? await createWorkTask(input) : await updateWorkTask(input);

      // Reconcile join table.
      await syncWorkTaskPaddocks({
        workTaskId: saved.id,
        vineyardId,
        selections: paddockAreas.map(({ paddock, areaHa }) => ({
          paddock_id: paddock.id,
          area_ha: areaHa > 0 ? areaHa : null,
        })),
        existing: existingPaddocks,
        userId,
      });

      return saved;
    },
    onSuccess: (saved) => {
      setSavedTaskId(saved.id);
      toast({ title: isNew ? "Task log created" : "Task log updated" });
      onSaved();
      if (!isNew) onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const drawerCanSeeCosts = useCanSeeCosts();
  const visibleLines = labourLines.filter((l) => !l.deleted_at);
  const totalHours = visibleLines.reduce((s, l) => s + (Number(l.total_hours ?? 0) || 0), 0);
  const totalCost = visibleLines.reduce((s, l) => s + (l.total_cost == null ? 0 : Number(l.total_cost) || 0), 0);
  const missingRate = visibleLines.some((l) => l.total_cost == null && l.worker_count && l.hours_per_worker);
  const areaNum = totalAreaHa > 0 ? totalAreaHa : null;
  const costPerHa = areaNum && totalCost ? totalCost / areaNum : null;

  const paddocksLabel = paddockIds.length === 0
    ? "No block"
    : paddockIds.length === 1
      ? selectedPaddocks[0]?.name ?? paddockIds[0].slice(0, 8)
      : `${paddockIds.length} blocks`;

  // Per-block cost breakdown (proportional by area).
  const blockBreakdown = useMemo(() => {
    if (!paddockAreas.length || totalAreaHa <= 0) return [];
    return paddockAreas.map(({ paddock, areaHa }) => {
      const share = areaHa > 0 ? areaHa / totalAreaHa : 0;
      const allocHours = totalHours * share;
      const allocCost = totalCost * share;
      const cph = areaHa > 0 ? allocCost / areaHa : null;
      return {
        id: paddock.id,
        name: paddock.name ?? paddock.id.slice(0, 8),
        areaHa,
        share,
        allocHours,
        allocCost,
        costPerHa: cph,
      };
    });
  }, [paddockAreas, totalAreaHa, totalHours, totalCost]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isNew ? "New Task Log" : `Edit Task Log — ${dateRangeLabel(task!)}`}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Section title="Task">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Blocks">
                  <Popover open={paddocksOpen} onOpenChange={setPaddocksOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal">
                        <span className="truncate">{paddocksLabel}</span>
                        <span className="text-xs text-muted-foreground">{paddockIds.length}/{paddocks.length}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 max-h-80 overflow-y-auto p-2" align="start">
                      {paddocks.length === 0 && (
                        <p className="text-sm text-muted-foreground p-2">No blocks.</p>
                      )}
                      {paddocks.map((p) => {
                        const ha = paddockAreaHa(p);
                        return (
                        <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded cursor-pointer">
                          <Checkbox
                            checked={paddockIds.includes(p.id)}
                            onCheckedChange={() => togglePaddock(p.id)}
                          />
                          <span className="flex-1 text-sm">{p.name ?? p.id.slice(0, 8)}</span>
                          <span className="text-xs text-muted-foreground">
                            {ha > 0 ? rf.area(ha) : "—"}
                          </span>
                        </label>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                </Field>
                <Field label="Task type">
                  <TaskTypeSelect
                    value={taskType}
                    onChange={setTaskType}
                    syncedTaskTypes={syncedTaskTypes}
                    vineyardId={vineyardId}
                    userId={userId}
                    onCreated={onSaved}
                  />
                </Field>
                <Field label="Date">
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label={`Area ${areaUnit} (auto)`}>
                  <Input type="number" value={areaHaDisplay} readOnly disabled placeholder="—" />
                </Field>
              </div>
              {paddockMissingArea && (
                <p className="text-xs text-destructive">
                  One or more selected blocks are missing area data, so the total area and cost per {areaUnit} may be incomplete.
                </p>
              )}
              <Field label="Description">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </Field>
              <Field label="Notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </Field>
              {/* Status and Finalized intentionally hidden: iOS Task Log treats
                  entries as historical records of completed work. Exposing
                  scheduling fields here causes drift with iOS and can trigger
                  overdue alerts. Existing values are preserved on save. */}
            </Section>


            <LabourLinesSection
              taskId={savedTaskId}
              vineyardId={vineyardId}
              lines={visibleLines}
              categories={categories}
              canSoftDelete={canSoftDelete}
              userId={userId}
              onChanged={onSaved}
            />
          </div>

          <div className="space-y-3">
            <Section title="Totals">
              <Field label="Total labour hours" value={num(totalHours)} />
              {drawerCanSeeCosts && (
                <Field label="Total estimated cost" value={
                  totalCost ? money(totalCost) : missingRate ? "Add rates to estimate cost" : "—"
                } />
              )}
              <Field label="Area" value={areaNum == null ? "—" : rf.area(areaNum)} />
              {drawerCanSeeCosts && (
                <Field label={`Cost per ${areaUnit}`} value={costPerHa == null ? "—" : money(costPerHa)} />
              )}
              {drawerCanSeeCosts && <Separator className="my-2" />}
              {drawerCanSeeCosts && (
                <p className="text-xs text-muted-foreground">Cost per tonne will appear once tonnage/yield is connected.</p>
              )}
            </Section>
            {blockBreakdown.length > 1 && (
              <Section title="Block breakdown">
                <div className="overflow-x-auto -mx-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="text-left font-normal px-2 py-1">Block</th>
                        <th className="text-right font-normal px-2 py-1">Area</th>
                        <th className="text-right font-normal px-2 py-1">Share</th>
                        <th className="text-right font-normal px-2 py-1">Hours</th>
                        {drawerCanSeeCosts && <th className="text-right font-normal px-2 py-1">Cost</th>}
                        {drawerCanSeeCosts && <th className="text-right font-normal px-2 py-1">{`Cost/${areaUnit}`}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {blockBreakdown.map((b) => (
                        <tr key={b.id} className="border-t">
                          <td className="px-2 py-1 truncate max-w-[8rem]" title={b.name}>{b.name}</td>
                          <td className="px-2 py-1 text-right">{b.areaHa > 0 ? rf.area(b.areaHa) : "—"}</td>
                          <td className="px-2 py-1 text-right">{(b.share * 100).toFixed(1)}%</td>
                          <td className="px-2 py-1 text-right">{b.allocHours.toFixed(2)}</td>
                          {drawerCanSeeCosts && <td className="px-2 py-1 text-right">{b.allocCost ? money(b.allocCost) : "—"}</td>}
                          {drawerCanSeeCosts && <td className="px-2 py-1 text-right">{b.costPerHa == null ? "—" : money(b.costPerHa)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
            {!isNew && task && (
              <Section title="Linked Trips">
                {linkedTrips.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No linked trips</div>
                ) : (
                  <div className="space-y-2">
                    {linkedTrips
                      .slice()
                      .sort((a, b) => (b.start_time ?? "").localeCompare(a.start_time ?? ""))
                      .map((tr) => {
                        const name = formatTripNameLabel(tr.trip_title, tr.tracking_pattern, tr.paddock_name);
                        const fn = formatTripFunctionLabel(tr.trip_function);
                        const dur = formatTripDurationLabel(tr.start_time, tr.end_time);
                        const machineId = tr.machine_id ?? tr.tractor_id ?? null;
                        const machineName =
                          machineLookups.machines.find((m) => m.id === machineId)?.name ??
                          machineLookups.tractors.find((m) => m.id === machineId)?.name ??
                          null;
                        return (
                          <div key={tr.id} className="rounded border bg-muted/30 p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate">{name}</span>
                              <span className="text-muted-foreground shrink-0">{fmtDate(tr.start_time)}</span>
                            </div>
                            <div className="mt-0.5 text-muted-foreground truncate">
                              {fn !== "—" && <>{fn}</>}
                              {machineName && <> · {machineName}</>}
                              {dur !== "—" && <> · {dur}</>}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </Section>
            )}
            {!isNew && task && (
              <MachineWorkSection
                workTaskId={task.id}
                vineyardId={vineyardId}
                lines={machineLines}
                lookups={machineLookups}
                canEdit={canSoftDelete}
                canDelete={canSoftDelete}
                userId={userId}
              />
            )}
            {!isNew && task && (
              <Section title="Meta">
                <Field label="Created" value={fmtDate(task.created_at)} />
                <Field label="Updated" value={fmtDate(task.updated_at)} />
                <Field label="Sync v" value={String(task.sync_version ?? "—")} />
                <Field label="ID" value={task.id} mono />
              </Section>
            )}
          </div>
        </div>

        <SheetFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => saveTask.mutate()} disabled={saveTask.isPending}>
            {saveTask.isPending ? "Saving…" : isNew ? "Create Task Log" : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function LabourLinesSection({
  taskId, vineyardId, lines, categories, canSoftDelete, userId, onChanged,
}: {
  taskId: string | null;
  vineyardId: string | null;
  lines: WorkTaskLabourLine[];
  categories: OperatorCategory[];
  canSoftDelete: boolean;
  userId: string | null;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  if (!taskId) {
    return (
      <Section title="Labour lines">
        <p className="text-sm text-muted-foreground">Save the task first, then add labour lines.</p>
      </Section>
    );
  }

  return (
    <Section title="Labour lines">
      <div className="space-y-2">
        {lines.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">No labour lines yet.</p>
        )}
        {lines.map((line) => (
          <LabourLineRow
            key={line.id}
            line={line}
            categories={categories}
            canSoftDelete={canSoftDelete}
            userId={userId}
            vineyardId={vineyardId}
            taskId={taskId}
            onChanged={onChanged}
          />
        ))}
        {adding && (
          <LabourLineRow
            line={null}
            categories={categories}
            canSoftDelete={canSoftDelete}
            userId={userId}
            vineyardId={vineyardId}
            taskId={taskId}
            onChanged={() => { setAdding(false); onChanged(); }}
            onCancel={() => setAdding(false)}
          />
        )}
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add labour line
          </Button>
        )}
      </div>
    </Section>
  );
}

function LabourLineRow({
  line, categories, canSoftDelete, userId, vineyardId, taskId, onChanged, onCancel,
}: {
  line: WorkTaskLabourLine | null;
  categories: OperatorCategory[];
  canSoftDelete: boolean;
  userId: string | null;
  vineyardId: string | null;
  taskId: string;
  onChanged: () => void;
  onCancel?: () => void;
}) {
  const isNew = !line;
  const rf = useRegionFormatters();
  const fmtDate = mkFmtDate(rf);
  const money = mkMoney(rf);
  const [editing, setEditing] = useState(isNew);
  const [workDate, setWorkDate] = useState(line?.work_date ?? "");
  const [workerType, setWorkerType] = useState(line?.worker_type ?? "");
  const [categoryId, setCategoryId] = useState(line?.operator_category_id ?? NONE);
  const [workerCount, setWorkerCount] = useState(line?.worker_count == null ? "" : String(line.worker_count));
  const [hoursPerWorker, setHoursPerWorker] = useState(line?.hours_per_worker == null ? "" : String(line.hours_per_worker));
  const [hourlyRate, setHourlyRate] = useState(line?.hourly_rate == null ? "" : String(line.hourly_rate));
  const [notes, setNotes] = useState(line?.notes ?? "");

  // Auto-populate hourly rate from selected category if rate empty.
  useEffect(() => {
    if (categoryId !== NONE && hourlyRate === "") {
      const cat = categories.find((c) => c.id === categoryId);
      if (cat?.cost_per_hour != null) setHourlyRate(String(cat.cost_per_hour));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard");
      const input: UpsertLabourLineInput = {
        id: line?.id,
        work_task_id: taskId,
        vineyard_id: vineyardId,
        work_date: workDate || null,
        operator_category_id: categoryId === NONE ? null : categoryId,
        worker_type: workerType.trim() || null,
        worker_count: workerCount === "" ? null : Number(workerCount),
        hours_per_worker: hoursPerWorker === "" ? null : Number(hoursPerWorker),
        hourly_rate: hourlyRate === "" ? null : Number(hourlyRate),
        notes,
        user_id: userId,
        current_sync_version: line?.sync_version ?? 0,
      };
      return isNew ? createLabourLine(input) : updateLabourLine(input);
    },
    onSuccess: () => {
      toast({ title: isNew ? "Labour line added" : "Labour line updated" });
      setEditing(false);
      onChanged();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!line) return;
      await softDeleteLabourLine(line.id, userId);
    },
    onSuccess: () => { toast({ title: "Labour line removed" }); onChanged(); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  if (!editing && line) {
    const cat = line.operator_category_id ? categories.find((c) => c.id === line.operator_category_id) : null;
    return (
      <div className="rounded border p-2 text-sm flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="font-medium">{line.worker_type ?? "Worker"}</span>
            {cat?.name && <span className="text-muted-foreground">· {cat.name}</span>}
            <span className="text-muted-foreground">· {fmtDate(line.work_date)}</span>
            <span>{num(line.worker_count, 0)} × {num(line.hours_per_worker)}h</span>
            <span className="text-muted-foreground">{line.hourly_rate != null ? `@ ${money(line.hourly_rate)}/h` : "no rate"}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {num(line.total_hours)} h total{line.total_cost != null ? ` · ${money(line.total_cost)}` : ""}
            {line.notes ? ` · ${line.notes}` : ""}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          {canSoftDelete ? (
            <Button variant="ghost" size="sm" onClick={() => del.mutate()} disabled={del.isPending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground self-center px-2">Delete restricted</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Work date">
          <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </Field>
        <Field label="Worker type">
          <Input value={workerType} onChange={(e) => setWorkerType(e.target.value)} placeholder="Pruner, tractor op…" />
        </Field>
        <Field label="Operator category">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {categories.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name ?? c.id.slice(0, 8)}</SelectItem>))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Hourly rate">
          <Input type="number" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
        </Field>
        <Field label="Worker count">
          <Input type="number" step="1" value={workerCount} onChange={(e) => setWorkerCount(e.target.value)} />
        </Field>
        <Field label="Hours per worker">
          <Input type="number" step="0.25" value={hoursPerWorker} onChange={(e) => setHoursPerWorker(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        {(line || onCancel) && (
          <Button variant="ghost" size="sm" onClick={() => (line ? setEditing(false) : onCancel?.())}>Cancel</Button>
        )}
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : isNew ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="rounded-md border bg-card/50 p-3 space-y-2">{children}</div>
    </div>
  );
}

function Field(props: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  if (props.children) {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{props.label}</Label>
        {props.children}
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{props.label}</span>
      <span className={props.mono ? "font-mono text-xs break-all text-right" : "text-right"}>{props.value}</span>
    </div>
  );
}

function TaskTypeSelect({
  value,
  onChange,
  syncedTaskTypes,
  vineyardId,
  userId,
  onCreated,
}: {
  value: string;
  onChange: (v: string) => void;
  syncedTaskTypes: WorkTaskType[];
  vineyardId: string | null;
  userId: string | null;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const options = useMemo(
    () => mergeTaskTypeNames(syncedTaskTypes, DEFAULT_TASK_TYPES, value ? [value] : []),
    [syncedTaskTypes, value],
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard selected");
      const trimmed = newName.trim();
      if (!trimmed) throw new Error("Name is required");
      // Skip insert if a synced row already exists (case-insensitive).
      const dup = syncedTaskTypes.find(
        (t) => (t.name ?? "").trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (dup) return { name: dup.name ?? trimmed };
      const created = await createWorkTaskType({
        vineyard_id: vineyardId,
        name: trimmed,
        user_id: userId,
      });
      return { name: created.name };
    },
    onSuccess: (res) => {
      onChange(res.name);
      setNewName("");
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["work_task_types"] });
      onCreated();
      toast({ title: "Task type added" });
    },
    onError: (e: any) =>
      toast({ title: "Could not add task type", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {options.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Add task type"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {adding && (
        <div className="flex gap-2">
          <Input
            placeholder="New task type name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim() && !create.isPending) {
                e.preventDefault();
                create.mutate();
              }
            }}
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            onClick={() => create.mutate()}
            disabled={!newName.trim() || create.isPending || !vineyardId}
          >
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </div>
      )}
    </div>
  );
}
