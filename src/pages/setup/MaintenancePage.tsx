import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
  fetchMaintenanceLogsForVineyard,
  type MaintenanceLog,
} from "@/lib/maintenanceLogsQuery";
import { fetchEquipmentSelectorOptions } from "@/lib/equipmentItemsQuery";

const ANY = "__any__";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtCost = (v?: number | null) =>
  v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "AUD" });

export default function MaintenancePage() {
  const { selectedVineyardId } = useVineyard();
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [item, setItem] = useState<string>(ANY);
  const [completion, setCompletion] = useState<string>(ANY);
  const [selected, setSelected] = useState<MaintenanceLog | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["maintenance_logs", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchMaintenanceLogsForVineyard(selectedVineyardId!),
  });

  const logs = data?.logs ?? [];

  const { data: equipmentGroups } = useQuery({
    queryKey: ["equipment_selector_options", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchEquipmentSelectorOptions(selectedVineyardId!),
  });

  // Names actually used in historical records (free-text legacy values).
  const legacyItemNames = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => l.item_name && s.add(l.item_name));
    return s;
  }, [logs]);

  // Names already covered by the equipment groups.
  const groupedNames = useMemo(() => {
    const s = new Set<string>();
    equipmentGroups?.tractors.forEach((o) => s.add(o.name));
    equipmentGroups?.sprayEquipment.forEach((o) => s.add(o.name));
    equipmentGroups?.otherItems.forEach((o) => s.add(o.name));
    return s;
  }, [equipmentGroups]);

  const legacyOnly = useMemo(
    () =>
      Array.from(legacyItemNames)
        .filter((n) => !groupedNames.has(n))
        .sort((a, b) => a.localeCompare(b)),
    [legacyItemNames, groupedNames],
  );

  const rows = useMemo(() => {
    let list = logs.slice();
    list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    if (from) list = list.filter((l) => (l.date ?? "") >= from);
    if (to) list = list.filter((l) => (l.date ?? "") <= to);
    if (item !== ANY) list = list.filter((l) => l.item_name === item);
    if (completion === "finalized") list = list.filter((l) => l.is_finalized);
    if (completion === "open") list = list.filter((l) => !l.is_finalized);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((l) =>
        [l.item_name, l.work_completed, l.parts_used, l.date]
          .some((v) => String(v ?? "").toLowerCase().includes(f)),
      );
    }
    return list;
  }, [logs, filter, from, to, item, completion]);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[MaintenancePage] diagnostics", {
      selectedVineyardId,
      maintenanceCount: logs.length,
      recordsBySource: data?.source ?? "n/a",
      vineyardIdMatches: data?.vineyardCount ?? 0,
      archivedExcluded: data?.archivedExcluded ?? 0,
      missingDisplayFields: {
        missingDate: data?.missingDate ?? 0,
        missingItemName: data?.missingItemName ?? 0,
      },
      // Schema gaps surfaced for the team:
      schemaGaps: [
        "no tractor_id or spray_equipment_id (item_name is free text)",
        "no maintenance_type/category column",
        "no odometer column (only `hours`)",
      ],
      filtered: rows.length,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Maintenance logs</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Archived and soft-deleted records are excluded.
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
          <div className="text-xs text-muted-foreground">Item</div>
          <Select value={item} onValueChange={setItem}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any item</SelectItem>
              {items.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
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
            placeholder="Item, work, parts…"
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
              <TableHead>Item</TableHead>
              <TableHead>Work completed</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Status</TableHead>
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
                  No maintenance records found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rows.map((l) => {
              const cost = (l.parts_cost ?? 0) + (l.labour_cost ?? 0);
              return (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setSelected(l)}>
                  <TableCell>{fmtDate(l.date)}</TableCell>
                  <TableCell>{fmt(l.item_name)}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{fmt(l.work_completed)}</TableCell>
                  <TableCell>{fmt(l.hours)}</TableCell>
                  <TableCell>{l.parts_cost == null && l.labour_cost == null ? "—" : fmtCost(cost)}</TableCell>
                  <TableCell>
                    {l.is_finalized ? <Badge>Finalized</Badge> : <Badge variant="outline">Open</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <MaintenanceSheet
        log={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}

function MaintenanceSheet({
  log,
  open,
  onOpenChange,
}: {
  log: MaintenanceLog | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Maintenance — {fmtDate(log?.date)}</SheetTitle>
        </SheetHeader>
        {log && (
          <div className="mt-4 space-y-4 text-sm">
            <Section title="Record">
              <Field label="Date" value={fmtDate(log.date)} />
              <Field label="Item" value={fmt(log.item_name)} />
              <Field label="Hours" value={fmt(log.hours)} />
              <Field label="Finalized" value={log.is_finalized ? "Yes" : "No"} />
              <Field label="Finalized at" value={fmtDate(log.finalized_at)} />
            </Section>
            {(log.work_completed || log.parts_used) && (
              <Section title="Details">
                {log.work_completed && (
                  <div>
                    <div className="text-muted-foreground mb-1">Work completed</div>
                    <p className="whitespace-pre-wrap">{log.work_completed}</p>
                  </div>
                )}
                {log.parts_used && (
                  <div>
                    <div className="text-muted-foreground mb-1">Parts used</div>
                    <p className="whitespace-pre-wrap">{log.parts_used}</p>
                  </div>
                )}
              </Section>
            )}
            <Section title="Costs">
              <Field label="Parts cost" value={fmtCost(log.parts_cost)} />
              <Field label="Labour cost" value={fmtCost(log.labour_cost)} />
              <Field
                label="Total"
                value={
                  log.parts_cost == null && log.labour_cost == null
                    ? "—"
                    : fmtCost((log.parts_cost ?? 0) + (log.labour_cost ?? 0))
                }
              />
            </Section>
            <Section title="Meta">
              <Field label="Photo path" value={fmt(log.photo_path)} mono />
              <Field label="Created" value={fmtDate(log.created_at)} />
              <Field label="Updated" value={fmtDate(log.updated_at)} />
              <Field label="Record ID" value={log.id} mono />
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
