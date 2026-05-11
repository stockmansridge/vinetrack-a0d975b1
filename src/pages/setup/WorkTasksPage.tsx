import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { fetchList } from "@/lib/queries";
import { fetchOperatorCategoriesForVineyard, type OperatorCategory } from "@/lib/operatorCategoriesQuery";
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
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Download } from "lucide-react";
import {
  fetchWorkTasksForVineyard,
  fetchLabourLinesForVineyard,
  createWorkTask,
  updateWorkTask,
  createLabourLine,
  updateLabourLine,
  softDeleteLabourLine,
  type WorkTask,
  type WorkTaskLabourLine,
  type UpsertLabourLineInput,
} from "@/lib/workTasksQuery";

interface PaddockLite { id: string; name: string | null }

const ANY = "__any__";
const NONE = "__none__";

const STATUS_OPTIONS = ["planned", "in_progress", "completed", "on_hold", "cancelled"];

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const num = (v: any, digits = 2) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(digits);
const money = (v: any) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `$${Number(v).toFixed(2)}`;

const dateRangeLabel = (t: WorkTask) => {
  const s = t.start_date ?? t.date ?? null;
  const e = t.end_date ?? null;
  if (!s && !e) return "—";
  if (s && e && s !== e) return `${fmtDate(s)} → ${fmtDate(e)}`;
  return fmtDate(s ?? e);
};
const effectiveStart = (t: WorkTask) => t.start_date ?? t.date ?? null;
const effectiveEnd = (t: WorkTask) => t.end_date ?? t.start_date ?? t.date ?? null;

export default function WorkTasksPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const qc = useQueryClient();

  const canSoftDelete = currentRole === "owner" || currentRole === "manager" || currentRole === "supervisor";

  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paddockId, setPaddockId] = useState<string>(ANY);
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
  });

  const paddockIds = useMemo(() => paddocks.map((p) => p.id), [paddocks]);
  const paddockNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    paddocks.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [paddocks]);
  const categoryById = useMemo(() => {
    const m = new Map<string, OperatorCategory>();
    categories.forEach((c) => m.set(c.id, c));
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

  const tasks = data?.tasks ?? [];

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

  const filtered = useMemo(() => {
    let list = tasks.slice();
    if (from) list = list.filter((t) => (effectiveEnd(t) ?? "") >= from);
    if (to) list = list.filter((t) => (effectiveStart(t) ?? "") <= to);
    if (paddockId !== ANY) list = list.filter((t) => t.paddock_id === paddockId);
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
        [t.task_type, t.paddock_name, t.notes, t.description, t.status, t.date]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [tasks, filter, from, to, paddockId, taskType, status, workerType, labourFilter, linesByTask, totalsByTask]);

  type SortKey = "date" | "paddock" | "task_type" | "status" | "area_ha" | "hours" | "cost" | "finalized";
  const accessors = useMemo(
    () => ({
      date: (r: WorkTask) => effectiveStart(r),
      paddock: (r: WorkTask) => r.paddock_name ?? (r.paddock_id ? paddockNameById.get(r.paddock_id) ?? "" : ""),
      task_type: (r: WorkTask) => r.task_type ?? "",
      status: (r: WorkTask) => r.status ?? "",
      area_ha: (r: WorkTask) => (r.area_ha == null ? null : Number(r.area_ha)),
      hours: (r: WorkTask) => totalsByTask.get(r.id)?.hours ?? 0,
      cost: (r: WorkTask) => totalsByTask.get(r.id)?.cost ?? 0,
      finalized: (r: WorkTask) => (r.is_finalized ? 1 : 0),
    }),
    [paddockNameById, totalsByTask],
  );

  const { sorted: rows, getSortDirection, toggleSort } = useSortableTable<WorkTask, SortKey>(filtered, {
    accessors,
    initial: { key: "date", direction: "desc" },
  });

  const exportCsv = () => {
    const headers = [
      "Task ID","Start","End","Paddock","Task type","Status","Area ha",
      "Total hours","Total cost","Cost per ha","Worker types","Description","Notes",
    ];
    const lines = [headers.join(",")];
    rows.forEach((t) => {
      const tot = totalsByTask.get(t.id);
      const padName = t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? "" : "");
      const costPerHa = t.area_ha && tot?.cost ? (tot.cost / Number(t.area_ha)).toFixed(2) : "";
      const cells = [
        t.id,
        effectiveStart(t) ?? "",
        effectiveEnd(t) ?? "",
        padName ?? "",
        t.task_type ?? "",
        t.status ?? "",
        t.area_ha ?? "",
        tot?.hours?.toFixed(2) ?? "0",
        tot?.cost?.toFixed(2) ?? "",
        costPerHa,
        Array.from(tot?.workerTypes ?? []).join("; "),
        (t.description ?? "").replace(/\s+/g, " "),
        (t.notes ?? "").replace(/\s+/g, " "),
      ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
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
          <h1 className="text-2xl font-semibold">Work tasks</h1>
          <p className="text-sm text-muted-foreground">
            Active tasks across this vineyard. Archived and soft-deleted tasks are excluded.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New task
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Filter label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Filter>
        <Filter label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Filter>
        <Filter label="Paddock">
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
            placeholder="Type, paddock, notes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
        </Filter>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead active={getSortDirection("date")} onSort={() => toggleSort("date")}>Date / range</SortableTableHead>
              <SortableTableHead active={getSortDirection("paddock")} onSort={() => toggleSort("paddock")}>Paddock</SortableTableHead>
              <SortableTableHead active={getSortDirection("task_type")} onSort={() => toggleSort("task_type")}>Type</SortableTableHead>
              <SortableTableHead active={getSortDirection("status")} onSort={() => toggleSort("status")}>Status</SortableTableHead>
              <SortableTableHead active={getSortDirection("area_ha")} onSort={() => toggleSort("area_ha")} align="right">Area ha</SortableTableHead>
              <SortableTableHead active={getSortDirection("hours")} onSort={() => toggleSort("hours")} align="right">Hours</SortableTableHead>
              <SortableTableHead active={getSortDirection("cost")} onSort={() => toggleSort("cost")} align="right">Cost</SortableTableHead>
              <SortableTableHead active={getSortDirection("finalized")} onSort={() => toggleSort("finalized")}>Finalized</SortableTableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={9} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No work tasks found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const padName = t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? null : null);
              const tot = totalsByTask.get(t.id);
              const summary = (t.description ?? t.notes ?? "").trim();
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                  <TableCell>{dateRangeLabel(t)}</TableCell>
                  <TableCell>{fmt(padName)}</TableCell>
                  <TableCell>{t.task_type ? <Badge variant="secondary">{t.task_type}</Badge> : "—"}</TableCell>
                  <TableCell>{t.status ? <Badge variant="outline">{t.status}</Badge> : "—"}</TableCell>
                  <TableCell className="text-right">{num(t.area_ha)}</TableCell>
                  <TableCell className="text-right">{num(tot?.hours ?? 0)}</TableCell>
                  <TableCell className="text-right">
                    {tot?.cost ? money(tot.cost) : tot?.missingRate ? <span className="text-xs text-muted-foreground">add rates</span> : "—"}
                  </TableCell>
                  <TableCell>{t.is_finalized ? <Badge>Finalized</Badge> : <Badge variant="outline">Open</Badge>}</TableCell>
                  <TableCell className="max-w-[18rem] truncate text-xs text-muted-foreground">{summary || "—"}</TableCell>
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
        categories={categories}
        labourLines={selected ? linesByTask.get(selected.id) ?? [] : []}
        canSoftDelete={canSoftDelete}
        userId={user?.id ?? null}
        vineyardId={selectedVineyardId}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["work_tasks"] });
          qc.invalidateQueries({ queryKey: ["work_task_labour_lines"] });
        }}
      />

      <WorkTaskDrawer
        key={createOpen ? "create-open" : "create-closed"}
        task={null}
        open={createOpen}
        onOpenChange={setCreateOpen}
        paddocks={paddocks}
        categories={categories}
        labourLines={[]}
        canSoftDelete={canSoftDelete}
        userId={user?.id ?? null}
        vineyardId={selectedVineyardId}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["work_tasks"] });
          qc.invalidateQueries({ queryKey: ["work_task_labour_lines"] });
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
  categories: OperatorCategory[];
  labourLines: WorkTaskLabourLine[];
  canSoftDelete: boolean;
  userId: string | null;
  vineyardId: string | null;
  onSaved: () => void;
}

function WorkTaskDrawer({
  task, open, onOpenChange, paddocks, categories, labourLines, canSoftDelete, userId, vineyardId, onSaved,
}: DrawerProps) {
  const isNew = !task;
  const [paddockId, setPaddockId] = useState<string>(task?.paddock_id ?? NONE);
  const [taskType, setTaskType] = useState<string>(task?.task_type ?? "");
  const [status, setStatus] = useState<string>(task?.status ?? "");
  const [startDate, setStartDate] = useState<string>(task?.start_date ?? task?.date ?? "");
  const [endDate, setEndDate] = useState<string>(task?.end_date ?? "");
  const [areaHa, setAreaHa] = useState<string>(task?.area_ha == null ? "" : String(task.area_ha));
  const [description, setDescription] = useState<string>(task?.description ?? "");
  const [notes, setNotes] = useState<string>(task?.notes ?? "");
  const [isFinalized, setIsFinalized] = useState<boolean>(!!task?.is_finalized);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(task?.id ?? null);

  useEffect(() => { setSavedTaskId(task?.id ?? null); }, [task?.id]);

  const saveTask = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard selected");
      const padName = paddockId !== NONE ? paddocks.find((p) => p.id === paddockId)?.name ?? null : null;
      const input = {
        id: task?.id,
        vineyard_id: vineyardId,
        paddock_id: paddockId === NONE ? null : paddockId,
        paddock_name: padName,
        task_type: taskType.trim() || null,
        status: status || null,
        start_date: startDate || null,
        end_date: endDate || null,
        date: startDate || task?.date || null,
        area_ha: areaHa === "" ? null : Number(areaHa),
        description,
        notes,
        is_finalized: isFinalized,
        user_id: userId,
        current_sync_version: task?.sync_version ?? 0,
      };
      const saved = isNew ? await createWorkTask(input) : await updateWorkTask(input);
      return saved;
    },
    onSuccess: (saved) => {
      setSavedTaskId(saved.id);
      toast({ title: isNew ? "Task created" : "Task updated" });
      onSaved();
      if (!isNew) onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const visibleLines = labourLines.filter((l) => !l.deleted_at);
  const totalHours = visibleLines.reduce((s, l) => s + (Number(l.total_hours ?? 0) || 0), 0);
  const totalCost = visibleLines.reduce((s, l) => s + (l.total_cost == null ? 0 : Number(l.total_cost) || 0), 0);
  const missingRate = visibleLines.some((l) => l.total_cost == null && l.worker_count && l.hours_per_worker);
  const areaNum = areaHa === "" ? null : Number(areaHa);
  const costPerHa = areaNum && totalCost ? totalCost / areaNum : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isNew ? "New work task" : `Work task — ${dateRangeLabel(task!)}`}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Section title="Task">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Paddock">
                  <Select value={paddockId} onValueChange={setPaddockId}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {paddocks.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Task type">
                  <Input value={taskType} onChange={(e) => setTaskType(e.target.value)} placeholder="Pruning, spraying…" />
                </Field>
                <Field label="Status">
                  <Select value={status || NONE} onValueChange={(v) => setStatus(v === NONE ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {STATUS_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Area ha">
                  <Input type="number" step="0.01" value={areaHa} onChange={(e) => setAreaHa(e.target.value)} />
                </Field>
                <Field label="Start date">
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label="End date">
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
              </div>
              <Field label="Description">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </Field>
              <Field label="Notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </Field>
              <div className="flex items-center gap-2">
                <input
                  id="finalized"
                  type="checkbox"
                  checked={isFinalized}
                  onChange={(e) => setIsFinalized(e.target.checked)}
                />
                <Label htmlFor="finalized">Finalized</Label>
              </div>
              {!task?.start_date && !task?.end_date && task?.date && (
                <p className="text-xs text-muted-foreground">
                  Originally a single-day task ({fmtDate(task.date)}). Saving will populate start/end dates from the values above and keep the legacy date field in sync.
                </p>
              )}
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
              <Field label="Total estimated cost" value={
                totalCost ? money(totalCost) : missingRate ? "Add rates to estimate cost" : "—"
              } />
              <Field label="Area ha" value={areaNum == null ? "—" : num(areaNum)} />
              <Field label="Cost per ha" value={costPerHa == null ? "—" : money(costPerHa)} />
              <Separator className="my-2" />
              <p className="text-xs text-muted-foreground">Cost per tonne will appear once tonnage/yield is connected.</p>
            </Section>
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
            {saveTask.isPending ? "Saving…" : isNew ? "Create task" : "Save changes"}
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
