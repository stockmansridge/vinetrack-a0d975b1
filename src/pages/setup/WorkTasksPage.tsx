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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fetchWorkTasksForVineyard,
  type WorkTask,
} from "@/lib/workTasksQuery";

interface PaddockLite {
  id: string;
  name: string | null;
}

const ANY = "__any__";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

export default function WorkTasksPage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paddockId, setPaddockId] = useState<string>(ANY);
  const [taskType, setTaskType] = useState<string>(ANY);
  const [completion, setCompletion] = useState<string>(ANY);
  const [selected, setSelected] = useState<WorkTask | null>(null);

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
    queryKey: ["work_tasks", selectedVineyardId, paddockIds.length],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchWorkTasksForVineyard(selectedVineyardId!, paddockIds),
  });

  const tasks = data?.tasks ?? [];

  const taskTypes = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => t.task_type && s.add(t.task_type));
    return Array.from(s).sort();
  }, [tasks]);

  const rows = useMemo(() => {
    let list = tasks.slice();
    list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    if (from) list = list.filter((t) => (t.date ?? "") >= from);
    if (to) list = list.filter((t) => (t.date ?? "") <= to);
    if (paddockId !== ANY) list = list.filter((t) => t.paddock_id === paddockId);
    if (taskType !== ANY) list = list.filter((t) => t.task_type === taskType);
    if (completion === "finalized") list = list.filter((t) => t.is_finalized);
    if (completion === "open") list = list.filter((t) => !t.is_finalized);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((t) =>
        [t.task_type, t.paddock_name, t.notes, t.date]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [tasks, filter, from, to, paddockId, taskType, completion]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[WorkTasksPage] diagnostics", {
      selectedVineyardId,
      workTasksCount: tasks.length,
      recordsBySource: data?.source ?? "n/a",
      vineyardIdMatches: data?.vineyardCount ?? 0,
      paddockIdFallbackAdded: data?.paddockFallbackCount ?? 0,
      archivedExcluded: data?.archivedExcluded ?? 0,
      missingDisplayFields: {
        missingDate: data?.missingDate ?? 0,
        missingTaskType: data?.missingTaskType ?? 0,
      },
      // Schema gaps surfaced for the team:
      schemaGaps: [
        "no status",
        "no priority",
        "no due_date (only `date`)",
        "no assigned_user/operator",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Work tasks</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Archived and soft-deleted tasks are excluded.
        </p>
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
          <div className="text-xs text-muted-foreground">Task type</div>
          <Select value={taskType} onValueChange={setTaskType}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any type</SelectItem>
              {taskTypes.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Completion</div>
          <Select value={completion} onValueChange={setCompletion}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="finalized">Finalized</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Type, paddock, notes…"
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
              <TableHead>Date</TableHead>
              <TableHead>Task type</TableHead>
              <TableHead>Paddock</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Finalized</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={6} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No work tasks found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const padName = t.paddock_name ?? (t.paddock_id ? paddockNameById.get(t.paddock_id) ?? null : null);
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                  <TableCell>{fmtDate(t.date)}</TableCell>
                  <TableCell>
                    {t.task_type ? <Badge variant="secondary">{t.task_type}</Badge> : "—"}
                  </TableCell>
                  <TableCell>{fmt(padName)}</TableCell>
                  <TableCell>{fmt(t.duration_hours)}</TableCell>
                  <TableCell>
                    {t.is_finalized ? <Badge>Finalized</Badge> : <Badge variant="outline">Open</Badge>}
                  </TableCell>
                  <TableCell>{fmtDate(t.updated_at)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <WorkTaskSheet
        task={selected}
        paddockNameById={paddockNameById}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}

function WorkTaskSheet({
  task,
  paddockNameById,
  open,
  onOpenChange,
}: {
  task: WorkTask | null;
  paddockNameById: Map<string, string | null>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const padName = task?.paddock_name ?? (task?.paddock_id ? paddockNameById.get(task.paddock_id) ?? null : null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Work task — {fmtDate(task?.date)}</SheetTitle>
        </SheetHeader>
        {task && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Task">
              <Field label="Date" value={fmtDate(task.date)} />
              <Field label="Type" value={fmt(task.task_type)} />
              <Field label="Paddock" value={fmt(padName)} />
              <Field label="Duration (hrs)" value={fmt(task.duration_hours)} />
              <Field label="Finalized" value={task.is_finalized ? "Yes" : "No"} />
              <Field label="Finalized at" value={fmtDate(task.finalized_at)} />
            </Section>
            {task.notes && (
              <Section title="Notes">
                <p className="whitespace-pre-wrap text-foreground/90">{task.notes}</p>
              </Section>
            )}
            <Section title="Resources">
              {task.resources ? (
                <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">
                  {JSON.stringify(task.resources, null, 2)}
                </pre>
              ) : (
                <span className="text-muted-foreground">No resources recorded.</span>
              )}
            </Section>
            <Section title="Meta">
              <Field label="Created" value={fmtDate(task.created_at)} />
              <Field label="Updated" value={fmtDate(task.updated_at)} />
              <Field label="Record ID" value={task.id} mono />
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
