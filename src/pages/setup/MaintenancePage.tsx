import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCanSeeCosts } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
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
  SheetFooter,
} from "@/components/ui/sheet";
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
import {
  fetchMaintenanceLogsForVineyard,
  createMaintenanceLog,
  updateMaintenanceLog,
  softDeleteMaintenanceLog,
  describeWriteError,
  type MaintenanceLog,
} from "@/lib/maintenanceLogsQuery";
import {
  fetchEquipmentSelectorOptions,
  type EquipmentSelectorGroups,
} from "@/lib/equipmentItemsQuery";
import { Fragment } from "react";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import { formatDate } from "@/lib/dateFormat";

const ANY = "__any__";
const WRITE_ROLES = new Set(["owner", "manager", "supervisor"]);

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return formatDate(d);
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtCost = (v?: number | null) =>
  v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "AUD" });

export default function MaintenancePage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const canWrite = !!currentRole && WRITE_ROLES.has(currentRole);
  const canSeeCosts = useCanSeeCosts();

  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [item, setItem] = useState<string>(ANY);
  const [completion, setCompletion] = useState<string>(ANY);
  const [selected, setSelected] = useState<MaintenanceLog | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceLog | null>(null);

  const MAINT_COLS = ["date", "item", "work", "hours", "machine_hours", ...(canSeeCosts ? ["cost"] : []), "status"] as const;
  type MaintCol = "date" | "item" | "work" | "hours" | "machine_hours" | "cost" | "status";
  const { order: maintOrder, moveColumn: maintMove, reset: maintReset } = useColumnOrder(
    "maintenance_logs_table",
    MAINT_COLS as unknown as string[],
    { vineyardId: selectedVineyardId },
  );

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

  const legacyItemNames = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => l.item_name && s.add(l.item_name));
    return s;
  }, [logs]);

  const groupedNames = useMemo(() => {
    const s = new Set<string>();
    equipmentGroups?.tractors.forEach((o) => s.add(o.name));
    equipmentGroups?.sprayEquipment.forEach((o) => s.add(o.name));
    equipmentGroups?.vineyardMachines.forEach((o) => s.add(o.name));
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

  const { sorted: rowsSorted, getSortDirection: mDir, toggleSort: mToggle } = useSortableTable<MaintenanceLog, MaintCol>(rows, {
    accessors: {
      date: (r) => r.date ?? null,
      item: (r) => r.item_name ?? null,
      work: (r) => r.work_completed ?? null,
      hours: (r) => (r.hours as any) ?? null,
      machine_hours: (r) => (r.machine_hours as any) ?? null,
      cost: (r) => ((r.parts_cost ?? 0) + (r.labour_cost ?? 0)) || null,
      status: (r) => (r.is_finalized ? "Finalized" : "Open"),
    },
  });

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (l: MaintenanceLog) => {
    setEditing(l);
    setSelected(null);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Maintenance logs</h1>
          <p className="text-sm text-muted-foreground">
            {canWrite
              ? "Add, edit and archive maintenance records for the selected vineyard."
              : "Read-only. Archived and soft-deleted records are excluded."}
          </p>
        </div>
        {canWrite && (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> New maintenance log
          </Button>
        )}
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
          <div className="text-xs text-muted-foreground">Item / Machine</div>
          <div className="flex items-center gap-1">
            <Select value={item} onValueChange={setItem}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any item</SelectItem>
                {equipmentGroups?.tractors.length ? (
                  <SelectGroup>
                    <SelectLabel>Tractors</SelectLabel>
                    {equipmentGroups.tractors.map((o) => (
                      <SelectItem key={`t-${o.id}`} value={o.name}>{o.name}</SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {equipmentGroups?.sprayEquipment.length ? (
                  <SelectGroup>
                    <SelectSeparator />
                    <SelectLabel>Spray Equipment</SelectLabel>
                    {equipmentGroups.sprayEquipment.map((o) => (
                      <SelectItem key={`s-${o.id}`} value={o.name}>{o.name}</SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {equipmentGroups?.vineyardMachines.length ? (
                  <SelectGroup>
                    <SelectSeparator />
                    <SelectLabel>Vineyard Machines</SelectLabel>
                    {equipmentGroups.vineyardMachines.map((o) => (
                      <SelectItem key={`m-${o.id}`} value={o.name}>{o.name}</SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {equipmentGroups?.otherItems.length ? (
                  <SelectGroup>
                    <SelectSeparator />
                    <SelectLabel>Other Equipment &amp; Assets</SelectLabel>
                    {equipmentGroups.otherItems.map((o) => (
                      <SelectItem key={`o-${o.id}`} value={o.name}>{o.name}</SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {legacyOnly.length ? (
                  <SelectGroup>
                    <SelectSeparator />
                    <SelectLabel>Historical (free text)</SelectLabel>
                    {legacyOnly.map((n) => (
                      <SelectItem key={`l-${n}`} value={n}>{n}</SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
            <AddEquipmentMenu />
          </div>
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

      <div className="flex justify-end">
        <ColumnSettingsMenu onReset={maintReset} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {(maintOrder as MaintCol[]).map((id) => {
                const labels: Record<MaintCol, string> = {
                  date: "Date",
                  item: "Item",
                  work: "Work completed",
                  hours: "Hours",
                  machine_hours: "Machine hrs",
                  cost: "Cost",
                  status: "Status",
                };
                if (id === "cost" && !canSeeCosts) return null;
                return (
                  <ReorderableHead key={id} columnId={id} onDropColumn={maintMove} sort={{ active: mDir(id), onSort: () => mToggle(id) }}>
                    {labels[id]}
                  </ReorderableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={canSeeCosts ? 7 : 6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            )}
            {error && (
              <TableRow><TableCell colSpan={canSeeCosts ? 7 : 6} className="text-center text-destructive py-6">{(error as Error).message}</TableCell></TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canSeeCosts ? 7 : 6} className="text-center text-muted-foreground py-8">
                  No maintenance records found for this vineyard.
                </TableCell>
              </TableRow>
            )}
            {rowsSorted.map((l) => {
              const cost = (l.parts_cost ?? 0) + (l.labour_cost ?? 0);
              const cellMap: Record<MaintCol, React.ReactNode> = {
                date: <TableCell>{fmtDate(l.date)}</TableCell>,
                item: <TableCell>{fmt(l.item_name)}</TableCell>,
                work: <TableCell className="max-w-[280px] truncate">{fmt(l.work_completed)}</TableCell>,
                hours: <TableCell>{fmt(l.hours)}</TableCell>,
                machine_hours: <TableCell>{fmt(l.machine_hours)}</TableCell>,
                cost: <TableCell>{l.parts_cost == null && l.labour_cost == null ? "—" : fmtCost(cost)}</TableCell>,
                status: (
                  <TableCell>
                    {l.is_finalized ? <Badge>Finalized</Badge> : <Badge variant="outline">Open</Badge>}
                  </TableCell>
                ),
              };
              return (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setSelected(l)}>
                  {(maintOrder as MaintCol[]).map((id) => {
                    if (id === "cost" && !canSeeCosts) return null;
                    return <Fragment key={id}>{cellMap[id]}</Fragment>;
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>


      <MaintenanceSheet
        log={selected}
        open={!!selected}
        canWrite={canWrite}
        canSeeCosts={canSeeCosts}
        onOpenChange={(o) => !o && setSelected(null)}
        onEdit={openEdit}
      />

      <MaintenanceEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        equipmentGroups={equipmentGroups}
        legacyOnly={legacyOnly}
        canSeeCosts={canSeeCosts}
      />
    </div>
  );
}

function MaintenanceSheet({
  log,
  open,
  canWrite,
  canSeeCosts,
  onOpenChange,
  onEdit,
}: {
  log: MaintenanceLog | null;
  open: boolean;
  canWrite: boolean;
  canSeeCosts: boolean;
  onOpenChange: (o: boolean) => void;
  onEdit: (l: MaintenanceLog) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const delMut = useMutation({
    mutationFn: async () => {
      if (!log) return;
      await softDeleteMaintenanceLog(log.id, user?.id ?? null, log.sync_version ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance_logs"] });
      toast({ title: "Maintenance log archived" });
      setConfirmDelete(false);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Could not archive log", description: describeWriteError(err), variant: "destructive" });
    },
  });

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
              {log.machine_hours != null && (
                <Field label="Machine hours" value={fmt(log.machine_hours)} />
              )}
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
            {canSeeCosts && (
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
            )}
            <Section title="Meta">
              <Field label="Photo path" value={fmt(log.photo_path)} mono />
              <Field label="Created" value={fmtDate(log.created_at)} />
              <Field label="Updated" value={fmtDate(log.updated_at)} />
              <Field label="Record ID" value={log.id} mono />
            </Section>

            {canWrite && (
              <SheetFooter className="flex sm:justify-between gap-2 pt-2">
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                  disabled={delMut.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Archive
                </Button>
                <Button onClick={() => onEdit(log)}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
              </SheetFooter>
            )}
          </div>
        )}
      </SheetContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this maintenance log?</AlertDialogTitle>
            <AlertDialogDescription>
              The record will be hidden from active lists. iOS will sync the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => delMut.mutate()} disabled={delMut.isPending}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const numOrNull = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function MaintenanceEditor({
  open,
  onOpenChange,
  editing,
  equipmentGroups,
  legacyOnly,
  canSeeCosts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: MaintenanceLog | null;
  equipmentGroups?: EquipmentSelectorGroups;
  legacyOnly: string[];
  canSeeCosts: boolean;
}) {
  const { selectedVineyardId } = useVineyard();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [itemName, setItemName] = useState<string>("");
  const [date, setDate] = useState<string>(todayIso());
  const [hours, setHours] = useState<string>("");
  const [machineHours, setMachineHours] = useState<string>("");
  const [workCompleted, setWorkCompleted] = useState<string>("");
  const [partsUsed, setPartsUsed] = useState<string>("");
  const [partsCost, setPartsCost] = useState<string>("");
  const [labourCost, setLabourCost] = useState<string>("");
  const [finalized, setFinalized] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setItemName(editing.item_name ?? "");
      setDate(editing.date ?? todayIso());
      setHours(editing.hours == null ? "" : String(editing.hours));
      setMachineHours(editing.machine_hours == null ? "" : String(editing.machine_hours));
      setWorkCompleted(editing.work_completed ?? "");
      setPartsUsed(editing.parts_used ?? "");
      setPartsCost(editing.parts_cost == null ? "" : String(editing.parts_cost));
      setLabourCost(editing.labour_cost == null ? "" : String(editing.labour_cost));
      setFinalized(!!editing.is_finalized);
    } else {
      setItemName("");
      setDate(todayIso());
      setHours("");
      setMachineHours("");
      setWorkCompleted("");
      setPartsUsed("");
      setPartsCost("");
      setLabourCost("");
      setFinalized(false);
    }
  }, [open, editing]);

  // Allow legacy values for editing only (existing records); for new records
  // we restrict to current Tractors / Spray Equipment / Other Items.
  const allowLegacyInPicker = !!editing;
  const editingNameInActive = useMemo(() => {
    if (!editing?.item_name) return true;
    const s = new Set<string>();
    equipmentGroups?.tractors.forEach((o) => s.add(o.name));
    equipmentGroups?.sprayEquipment.forEach((o) => s.add(o.name));
    equipmentGroups?.vineyardMachines.forEach((o) => s.add(o.name));
    equipmentGroups?.otherItems.forEach((o) => s.add(o.name));
    return s.has(editing.item_name);
  }, [editing, equipmentGroups]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      if (!itemName.trim()) throw new Error("Item / Machine is required");
      if (!date) throw new Error("Date is required");
      return createMaintenanceLog({
        vineyard_id: selectedVineyardId,
        item_name: itemName,
        date,
        hours: numOrNull(hours),
        machine_hours: numOrNull(machineHours),
        work_completed: workCompleted.trim() || null,
        parts_used: partsUsed.trim() || null,
        parts_cost: canSeeCosts ? numOrNull(partsCost) : null,
        labour_cost: canSeeCosts ? numOrNull(labourCost) : null,
        is_finalized: finalized,
        user_id: user?.id ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance_logs"] });
      toast({ title: "Maintenance log created" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Could not create log", description: describeWriteError(err), variant: "destructive" });
    },
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No record selected");
      if (!itemName.trim()) throw new Error("Item / Machine is required");
      if (!date) throw new Error("Date is required");
      return updateMaintenanceLog({
        id: editing.id,
        vineyard_id: editing.vineyard_id,
        item_name: itemName,
        date,
        hours: numOrNull(hours),
        machine_hours: numOrNull(machineHours),
        work_completed: workCompleted.trim() || null,
        parts_used: partsUsed.trim() || null,
        parts_cost: canSeeCosts ? numOrNull(partsCost) : (editing.parts_cost ?? null),
        labour_cost: canSeeCosts ? numOrNull(labourCost) : (editing.labour_cost ?? null),
        is_finalized: finalized,
        was_finalized: !!editing.is_finalized,
        user_id: user?.id ?? null,
        current_sync_version: editing.sync_version ?? 0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance_logs"] });
      toast({ title: "Maintenance log updated" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Could not update log", description: describeWriteError(err), variant: "destructive" });
    },
  });

  const submit = () => (editing ? updateMut.mutate() : createMut.mutate());
  const pending = createMut.isPending || updateMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit maintenance log" : "New maintenance log"}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label>Item / Machine *</Label>
            <div className="flex items-center gap-1">
              <Select value={itemName || undefined} onValueChange={setItemName}>
                <SelectTrigger><SelectValue placeholder="Select item or machine" /></SelectTrigger>
                <SelectContent>
                  {equipmentGroups?.tractors.length ? (
                    <SelectGroup>
                      <SelectLabel>Tractors</SelectLabel>
                      {equipmentGroups.tractors.map((o) => (
                        <SelectItem key={`et-${o.id}`} value={o.name}>{o.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {equipmentGroups?.sprayEquipment.length ? (
                    <SelectGroup>
                      <SelectSeparator />
                      <SelectLabel>Spray Equipment</SelectLabel>
                      {equipmentGroups.sprayEquipment.map((o) => (
                        <SelectItem key={`es-${o.id}`} value={o.name}>{o.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {equipmentGroups?.vineyardMachines.length ? (
                    <SelectGroup>
                      <SelectSeparator />
                      <SelectLabel>Vineyard Machines</SelectLabel>
                      {equipmentGroups.vineyardMachines.map((o) => (
                        <SelectItem key={`em-${o.id}`} value={o.name}>{o.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {equipmentGroups?.otherItems.length ? (
                    <SelectGroup>
                      <SelectSeparator />
                      <SelectLabel>Other Equipment &amp; Assets</SelectLabel>
                      {equipmentGroups.otherItems.map((o) => (
                        <SelectItem key={`eo-${o.id}`} value={o.name}>{o.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {allowLegacyInPicker && legacyOnly.length ? (
                    <SelectGroup>
                      <SelectSeparator />
                      <SelectLabel>Historical (free text)</SelectLabel>
                      {legacyOnly.map((n) => (
                        <SelectItem key={`el-${n}`} value={n}>{n}</SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {allowLegacyInPicker && editing?.item_name && !editingNameInActive && !legacyOnly.includes(editing.item_name) ? (
                    <SelectGroup>
                      <SelectSeparator />
                      <SelectLabel>Current value</SelectLabel>
                      <SelectItem value={editing.item_name}>{editing.item_name}</SelectItem>
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
              <AddEquipmentMenu />
            </div>
            {!editing && (
              <p className="text-xs text-muted-foreground">
                New records must use a Tractor, Spray Equipment item, Vineyard Machine, or Other Equipment & Asset.
              </p>
            )}
          </div>


          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Machine hours</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={machineHours}
                onChange={(e) => setMachineHours(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hours worked</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5 flex flex-col">
              <Label>Status</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={finalized} onCheckedChange={setFinalized} id="mlog-finalized" />
                <Label htmlFor="mlog-finalized" className="font-normal text-muted-foreground">
                  {finalized ? "Finalized" : "Open"}
                </Label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Work completed</Label>
            <Textarea
              value={workCompleted}
              onChange={(e) => setWorkCompleted(e.target.value)}
              rows={3}
              placeholder="Describe the work performed"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Parts used</Label>
            <Textarea
              value={partsUsed}
              onChange={(e) => setPartsUsed(e.target.value)}
              rows={2}
              placeholder="optional"
            />
          </div>

          {canSeeCosts && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Parts cost</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={partsCost}
                  onChange={(e) => setPartsCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Labour cost</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={labourCost}
                  onChange={(e) => setLabourCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create log"}
          </Button>
        </SheetFooter>
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

function AddEquipmentMenu() {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" title="Add item / machine">
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => navigate("/setup/tractors")}>
          Add Tractor
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/setup/spray-equipment")}>
          Add Spray Equipment
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/setup/vineyard-machines")}>
          Add Vineyard Machine
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/setup/equipment-other")}>
          Add Other Equipment & Asset
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
