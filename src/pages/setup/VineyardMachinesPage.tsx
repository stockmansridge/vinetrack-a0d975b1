import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Archive } from "lucide-react";
import {
  MACHINE_TYPES,
  MACHINE_TYPE_LABELS,
  type MachineType,
  type VineyardMachine,
  fetchActiveVineyardMachines,
  createVineyardMachine,
  updateVineyardMachine,
  softDeleteVineyardMachine,
} from "@/lib/vineyardMachinesQuery";
import { equipmentIdSubtitle } from "@/lib/equipmentIdentification";

type FormState = {
  name: string;
  machine_type: MachineType;
  fuel_tracking_enabled: boolean;
  available_for_job_costing: boolean;
  fuel_usage_l_per_hour: string;
  notes: string;
  serial_number: string;
  vin_number: string;
};

const emptyForm: FormState = {
  name: "",
  machine_type: "atv",
  fuel_tracking_enabled: true,
  available_for_job_costing: true,
  fuel_usage_l_per_hour: "",
  notes: "",
  serial_number: "",
  vin_number: "",
};

const fmtNum = (v?: number | null) =>
  v == null || v === 0 ? "not set" : `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} L/h`;

export default function VineyardMachinesPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = currentRole === "owner" || currentRole === "manager";

  const [filter, setFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VineyardMachine | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [archiving, setArchiving] = useState<VineyardMachine | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["vineyard_machines", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchActiveVineyardMachines(selectedVineyardId!),
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!filter.trim()) return list;
    const f = filter.toLowerCase();
    return list.filter((r) =>
      [r.name, MACHINE_TYPE_LABELS[r.machine_type as MachineType] ?? r.machine_type, r.notes]
        .some((v) => String(v ?? "").toLowerCase().includes(f)),
    );
  }, [data, filter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (m: VineyardMachine) => {
    if (m.legacy_tractor_id) {
      toast.message("This machine is managed in Tractors.");
      return;
    }
    setEditing(m);
    setForm({
      name: m.name ?? "",
      machine_type: (m.machine_type as MachineType) ?? "atv",
      fuel_tracking_enabled: m.fuel_tracking_enabled ?? true,
      available_for_job_costing: m.available_for_job_costing ?? true,
      fuel_usage_l_per_hour: m.fuel_usage_l_per_hour != null ? String(m.fuel_usage_l_per_hour) : "",
      notes: m.notes ?? "",
      serial_number: m.serial_number ?? "",
      vin_number: m.vin_number ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !selectedVineyardId) {
      toast.error("You don't have permission to edit machines.");
      return;
    }
    const name = form.name.trim();
    if (!name) {
      toast.error("Name is required.");
      return;
    }
    const lhrRaw = form.fuel_usage_l_per_hour.trim();
    const lhr = lhrRaw === "" ? 0 : Number(lhrRaw);
    if (!Number.isFinite(lhr) || lhr < 0) {
      toast.error("Fuel usage must be a non-negative number.");
      return;
    }
    setSubmitting(true);
    try {
      const sn = form.serial_number.trim() || null;
      const vn = form.vin_number.trim() || null;
      if (editing) {
        await updateVineyardMachine({
          id: editing.id,
          name,
          machine_type: form.machine_type,
          fuel_tracking_enabled: form.fuel_tracking_enabled,
          available_for_job_costing: form.available_for_job_costing,
          fuel_usage_l_per_hour: lhr,
          notes: form.notes.trim() || null,
          serial_number: sn,
          vin_number: vn,
          user_id: user?.id ?? null,
          current_sync_version: editing.sync_version,
        });
        toast.success("Machine updated");
      } else {
        await createVineyardMachine({
          vineyard_id: selectedVineyardId,
          name,
          machine_type: form.machine_type,
          fuel_tracking_enabled: form.fuel_tracking_enabled,
          available_for_job_costing: form.available_for_job_costing,
          fuel_usage_l_per_hour: lhr,
          notes: form.notes.trim() || null,
          serial_number: sn,
          vin_number: vn,
          user_id: user?.id ?? null,
        });
        toast.success("Machine created");
      }
      await qc.invalidateQueries({ queryKey: ["vineyard_machines", selectedVineyardId] });
      setDialogOpen(false);
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!archiving) return;
    if (!canEdit) {
      toast.error("Only owners and managers can archive machines.");
      return;
    }
    setArchiveSubmitting(true);
    try {
      await softDeleteVineyardMachine(archiving.id, user?.id ?? null, archiving.sync_version);
      toast.success("Machine archived");
      await qc.invalidateQueries({ queryKey: ["vineyard_machines", selectedVineyardId] });
      setArchiving(null);
    } catch (err: any) {
      toast.error(`Archive failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setArchiveSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vineyard Machines</h1>
          <p className="text-sm text-muted-foreground">
            ATVs, side-by-sides, harvesters, utility vehicles and other powered
            vineyard machines. Used for Fuel Log and job costing where enabled.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New machine
          </Button>
        )}
      </div>
      <div className="flex justify-end">
        <Input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-64"
        />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Fuel tracking</TableHead>
              <TableHead>Job costing</TableHead>
              <TableHead>Default L/hr</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-[140px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-destructive py-6">{(error as Error).message}</TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No vineyard machines yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const isLegacy = !!r.legacy_tractor_id;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <div>
                      {r.name}
                      {isLegacy && (
                        <Badge variant="outline" className="ml-2">Managed in Tractors</Badge>
                      )}
                    </div>
                    {equipmentIdSubtitle(r.serial_number, r.vin_number) && (
                      <div className="text-xs text-muted-foreground font-normal">
                        {equipmentIdSubtitle(r.serial_number, r.vin_number)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{MACHINE_TYPE_LABELS[r.machine_type as MachineType] ?? r.machine_type}</TableCell>
                  <TableCell>{r.fuel_tracking_enabled ? "On" : "Off"}</TableCell>
                  <TableCell>{r.available_for_job_costing ? "Available" : "—"}</TableCell>
                  <TableCell>{fmtNum(r.fuel_usage_l_per_hour)}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.notes ?? ""}>{r.notes ?? "—"}</TableCell>
                  <TableCell>
                    {canEdit && !isLegacy && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(r)} aria-label="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setArchiving(r)} aria-label="Archive">
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit machine" : "New machine"}</DialogTitle>
              <DialogDescription>Saves to the production database for the selected vineyard.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  maxLength={120}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Machine type *</Label>
                <Select
                  value={form.machine_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, machine_type: v as MachineType }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MACHINE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{MACHINE_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Fuel tracking enabled</div>
                  <div className="text-xs text-muted-foreground">Show this machine in Fuel Logs.</div>
                </div>
                <Switch
                  checked={form.fuel_tracking_enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, fuel_tracking_enabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Available for job costing</div>
                  <div className="text-xs text-muted-foreground">Allow this machine to be linked to trips/jobs.</div>
                </div>
                <Switch
                  checked={form.available_for_job_costing}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, available_for_job_costing: v }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Default fuel usage (L/hr)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0 = not set"
                  value={form.fuel_usage_l_per_hour}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fuel_usage_l_per_hour: e.target.value.replace(/[^\d.]/g, "") }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Used by trip/job cost calculations when this machine is linked. Leave blank or 0 for "not set".
                </p>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  maxLength={500}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Serial number</Label>
                  <Input
                    value={form.serial_number}
                    onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
                    maxLength={120}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1">
                  <Label>VIN number</Label>
                  <Input
                    value={form.vin_number}
                    onChange={(e) => setForm((f) => ({ ...f, vin_number: e.target.value }))}
                    maxLength={120}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive machine?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiving?.name} will be hidden from active selectors. Historical fuel logs
              and trips will continue to display the machine name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} disabled={archiveSubmitting}>
              {archiveSubmitting ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
