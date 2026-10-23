import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useCanSeeCosts } from "@/lib/permissions";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { fetchLabourLinesForVineyardAudit, fetchLabourLineParentsForAudit, fetchWorkTaskPaddocksForVineyard } from "@/lib/workTasksQuery";
import { fetchList } from "@/lib/queries";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import { activeVineyardLabourLines } from "@/lib/labourLineManagement";
import { classifyLabourLine, labourReviewSummary } from "@/lib/labourLineEligibility";
import { Badge } from "@/components/ui/badge";
import { RemoveLabourLineButton } from "@/components/work-tasks/RemoveLabourLineButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ANY = "__any__";
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function LabourLinesPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const rf = useRegionFormatters();
  const costs = useCanSeeCosts();
  const canRemove = currentRole === "owner" || currentRole === "manager" || currentRole === "supervisor";
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [worker, setWorker] = useState(ANY);
  const [taskType, setTaskType] = useState(ANY);
  const [block, setBlock] = useState(ANY);
  const [status, setStatus] = useState("active");

  const linesQ = useQuery({
    queryKey: ["labour-line-audit", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => selectedVineyardId ? fetchLabourLinesForVineyardAudit(selectedVineyardId) : Promise.resolve([]),
  });
  const paddocksQ = useQuery({
    queryKey: ["paddocks-lite", selectedVineyardId], enabled: !!selectedVineyardId,
    queryFn: () => selectedVineyardId ? fetchList<{ id: string; name: string | null }>("paddocks", selectedVineyardId) : Promise.resolve([]),
  });
  const paddocks = paddocksQ.data ?? [];
  const joinsQ = useQuery({
    queryKey: ["work_task_paddocks", selectedVineyardId], enabled: !!selectedVineyardId,
    queryFn: () => selectedVineyardId ? fetchWorkTaskPaddocksForVineyard(selectedVineyardId) : Promise.resolve([]),
  });
  const categoriesQ = useQuery({
    queryKey: ["operator-categories", selectedVineyardId], enabled: !!selectedVineyardId,
    queryFn: async () => selectedVineyardId ? (await fetchOperatorCategoriesForVineyard(selectedVineyardId)).categories : [],
  });
  const lines = activeVineyardLabourLines(linesQ.data ?? [], selectedVineyardId);
  const parentIds = [...new Set(lines.map((l) => l.work_task_id))].sort();
  const parentsQ = useQuery({
    queryKey: ["labour-line-parents", selectedVineyardId, parentIds.join(",")],
    enabled: !!selectedVineyardId && linesQ.isSuccess,
    queryFn: () => selectedVineyardId ? fetchLabourLineParentsForAudit(selectedVineyardId, parentIds) : Promise.resolve([]),
  });
  const rows = useMemo(() => {
    // A failed/loading audit read is not evidence that a parent is missing.
    if (!parentsQ.isSuccess) return [];
    const parents = new Map((parentsQ.data ?? []).map((t) => [t.id, t]));
    const names = new Map(paddocks.map((p) => [p.id, p.name]));
    return activeVineyardLabourLines(linesQ.data ?? [], selectedVineyardId).map((line) => {
      const task = parents.get(line.work_task_id);
      const joins = (joinsQ.data ?? []).filter((j) => j.work_task_id === line.work_task_id && !j.deleted_at);
      const blockIds = [...new Set(joins.length ? joins.map((j) => j.paddock_id) : task?.paddock_id ? [task.paddock_id] : [])];
      const blocks = blockIds.map((id) => names.get(id) ?? (id === task?.paddock_id ? task.paddock_name : null) ?? "Unnamed block").join(", ");
      const labourType = line.worker_type ?? categoriesQ.data?.find((c) => c.id === line.worker_type_id)?.name ?? "Unspecified";
      const status = classifyLabourLine(line, task);
      const label = task ? [task.task_type, task.description, rf.date(task.start_date ?? task.date)].filter(Boolean).join(" · ") || "Work Task" : "Parent Work Task missing";
      return { line, task, blocks, blockIds, labourType, label, status };
    }).sort((a, b) => (b.line.work_date ?? "").localeCompare(a.line.work_date ?? "") || a.line.id.localeCompare(b.line.id));
  }, [linesQ.data, parentsQ.data, parentsQ.isSuccess, paddocksQ.data, joinsQ.data, categoriesQ.data, selectedVineyardId, rf]);
  const summary = labourReviewSummary(rows);
  const filtered = rows.filter((row) => {
    const date = row.line.work_date?.slice(0, 10) ?? "";
    return (status === "all" || (status === "active" ? row.status === "ACTIVE_VALID" : row.status !== "ACTIVE_VALID"))
      && (!from || date >= from) && (!to || (!!date && date <= to))
      && (worker === ANY || row.labourType === worker)
      && (taskType === ANY || row.task?.task_type === taskType)
      && (block === ANY || row.blockIds.includes(block))
      && (!search.trim() || [row.label, row.blocks, row.labourType, row.line.notes].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  });
  const labourTypes = [...new Set(rows.map((r) => r.labourType))].sort();
  const taskTypes = [...new Set(rows.flatMap((r) => r.task?.task_type ? [r.task.task_type] : []))].sort();
  const errors = [linesQ, joinsQ, paddocksQ, categoriesQ, parentsQ].filter((q) => q.error);
  const loading = linesQ.isLoading || (linesQ.isSuccess && parentsQ.isPending) || [joinsQ, paddocksQ, categoriesQ].some((q) => q.isLoading);
  const selector = (label: string, value: string, change: (v: string) => void, options: { value: string; label: string }[]) => <div className="space-y-1">
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <Select value={value} onValueChange={change}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ANY}>All</SelectItem>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
  </div>;
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">Labour Lines</h1>
    {!loading && parentsQ.isSuccess && <div className="bg-card text-card-foreground border rounded-md p-3 space-y-2">
      <p className="text-sm font-medium">{summary.activeCount} active labour {summary.activeCount === 1 ? "line" : "lines"}</p>
      {summary.reviewCount > 0 && <div role="status" className="border-l-4 border-destructive pl-3">
        <p className="font-semibold">{summary.reviewCount} labour {summary.reviewCount === 1 ? "line needs" : "lines need"} review</p>
        <p className="text-sm">{number(summary.excludedHours)} person-hours{costs && summary.costComplete ? ` · ${rf.currency(summary.excludedCost)}` : ""} excluded from totals</p>
      </div>}
    </div>}
    <div className="grid gap-3 bg-card text-card-foreground border rounded-md p-3 sm:grid-cols-2 lg:grid-cols-7">
      <div className="space-y-1"><Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="active">Active</SelectItem><SelectItem value="review">Needs review</SelectItem><SelectItem value="all">All</SelectItem>
        </SelectContent></Select>
      </div>
      <div className="space-y-1"><Label htmlFor="labour-search" className="text-xs text-muted-foreground">Search</Label><Input id="labour-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search labour lines" /></div>
      <div className="space-y-1"><Label htmlFor="labour-from" className="text-xs text-muted-foreground">From</Label><Input id="labour-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="labour-to" className="text-xs text-muted-foreground">To</Label><Input id="labour-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      {selector("Labour type", worker, setWorker, labourTypes.map((v) => ({ value: v, label: v })))}
      {selector("Task type", taskType, setTaskType, taskTypes.map((v) => ({ value: v, label: v })))}
      {selector("Block", block, setBlock, paddocks.map((p) => ({ value: p.id, label: p.name ?? "Unnamed block" })))}
    </div>
    {errors.length > 0 && <div role="alert" className="text-sm text-destructive">Some labour records or task details could not be loaded. <Button variant="outline" size="sm" onClick={() => { errors.forEach((q) => void q.refetch()); }}>Retry</Button></div>}
    <div className="text-sm text-muted-foreground">{filtered.length} matching {status === "active" ? "active labour " : ""}{filtered.length === 1 ? "line" : "lines"}</div>
    <div className="overflow-x-auto rounded-md border bg-card text-card-foreground">
      <Table className="bg-card">
        <TableHeader className="bg-card"><TableRow className="bg-card hover:bg-card">
          {["Work date", "Work Task", "Blocks", "Labour type", "People", "Hours per person", "Person-hours", ...(costs ? ["Hourly rate", "Labour cost"] : []), "Notes", "Actions"].map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody className="bg-card">
          {loading && <TableRow className="bg-card hover:bg-card"><TableCell colSpan={costs ? 11 : 9}>Loading labour lines…</TableCell></TableRow>}
          {!loading && !filtered.length && <TableRow className="bg-card hover:bg-card"><TableCell colSpan={costs ? 11 : 9}>No labour lines found.</TableCell></TableRow>}
          {filtered.map(({ line, task, blocks, labourType, label, status }) => <TableRow key={line.id} className="bg-card hover:bg-card">
            <TableCell className="whitespace-nowrap">{rf.date(line.work_date) || "—"}</TableCell>
            <TableCell className="min-w-48"><div className="space-y-1">
              {status !== "ACTIVE_VALID" && <Badge variant="destructive">{status === "PARENT_DELETED" ? "Parent Work Task deleted" : "Parent Work Task missing"}</Badge>}
              {task && <p>{label}</p>}
              {task?.deleted_at && <p className="text-xs text-muted-foreground">Deleted {rf.date(task.deleted_at)}</p>}
              {status !== "ACTIVE_VALID" && <p className="text-xs text-muted-foreground">Excluded from labour and costing totals.</p>}
            </div></TableCell><TableCell>{blocks || "—"}</TableCell><TableCell>{labourType}</TableCell>
            <TableCell className="text-right tabular-nums">{number(line.worker_count)}</TableCell><TableCell className="text-right tabular-nums">{number(line.hours_per_worker)}</TableCell><TableCell className="text-right tabular-nums">{number(line.total_hours)}</TableCell>
            {costs && <><TableCell className="text-right tabular-nums">{line.hourly_rate == null ? "—" : rf.currency(line.hourly_rate)}</TableCell><TableCell className="text-right tabular-nums">{line.total_cost == null ? "—" : rf.currency(line.total_cost)}</TableCell></>}
            <TableCell className="min-w-40 whitespace-normal break-words">{line.notes || "—"}</TableCell>
            <TableCell><div className="flex items-center gap-1">
              {status === "ACTIVE_VALID" && task && <Button asChild variant="outline" size="sm"><Link to={`/work-tasks?task=${encodeURIComponent(line.work_task_id)}`}><ExternalLink className="mr-1 h-4 w-4" />Open Work Task</Link></Button>}
              <RemoveLabourLineButton line={line} userId={user?.id ?? null} allowed={canRemove} />
            </div></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
  </div>;
}