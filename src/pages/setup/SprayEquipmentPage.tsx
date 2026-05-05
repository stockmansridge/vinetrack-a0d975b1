import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { fetchList } from "@/lib/queries";
import { supabase } from "@/integrations/ios-supabase/client";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { z } from "zod";

interface SprayEquipment {
  id: string;
  vineyard_id: string;
  name: string | null;
  tank_capacity_litres: number | null;
  updated_at?: string | null;
}

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Name is required" })
    .max(120, { message: "Name must be ≤ 120 characters" }),
  tank_capacity_litres: z
    .number({ invalid_type_error: "Tank capacity is required" })
    .gt(0, { message: "Tank capacity must be greater than 0" })
    .max(100000, { message: "Tank capacity must be ≤ 100000" }),
});

type FormState = {
  name: string;
  tank_capacity_litres: string;
};

const emptyForm: FormState = { name: "", tank_capacity_litres: "" };

const fmtCell = (v: any) => {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleDateString();
  }
  return String(v);
};

export default function SprayEquipmentPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SprayEquipment | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [archiving, setArchiving] = useState<SprayEquipment | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  const canEdit = currentRole === "owner" || currentRole === "manager";

  const { data, isLoading, error } = useQuery({
    queryKey: ["list", "spray_equipment", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<SprayEquipment>("spray_equipment", selectedVineyardId!),
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!filter) return list;
    const f = filter.toLowerCase();
    return list.filter((r) =>
      [r.name, r.tank_capacity_litres].some((v) =>
        String(v ?? "").toLowerCase().includes(f),
      ),
    );
  }, [data, filter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (s: SprayEquipment) => {
    setEditing(s);
    setForm({
      name: s.name ?? "",
      tank_capacity_litres:
        s.tank_capacity_litres != null ? String(s.tank_capacity_litres) : "",
    });
    setErrors({});
    setDialogOpen(true);
  };

  const validate = () => {
    const parsed = schema.safeParse({
      name: form.name,
      tank_capacity_litres:
        form.tank_capacity_litres === "" ? NaN : Number(form.tank_capacity_litres),
    });
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof FormState;
        if (!fieldErrors[k]) fieldErrors[k] = issue.message;
      }
      setErrors(fieldErrors);
      return null;
    }
    setErrors({});
    return parsed.data;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !selectedVineyardId || !user) {
      toast.error("You don't have permission to edit spray equipment.");
      return;
    }
    const valid = validate();
    if (!valid) return;

    const nowIso = new Date().toISOString();
    setSubmitting(true);
    try {
      if (editing) {
        const updatePayload = {
          name: form.name.trim(),
          tank_capacity_litres: Number(form.tank_capacity_litres),
          updated_by: user.id,
          client_updated_at: nowIso,
        };
        const { error: upErr } = await supabase
          .from("spray_equipment")
          .update(updatePayload)
          .eq("id", editing.id)
          .eq("vineyard_id", selectedVineyardId);
        if (upErr) throw upErr;
        toast.success("Spray equipment updated");
      } else {
        const id = crypto.randomUUID();
        const insertPayload = {
          id,
          vineyard_id: selectedVineyardId,
          name: form.name.trim(),
          tank_capacity_litres: Number(form.tank_capacity_litres),
          created_by: user.id,
          updated_by: user.id,
          client_updated_at: nowIso,
        };
        const { error: insErr } = await supabase
          .from("spray_equipment")
          .insert(insertPayload);
        if (insErr) throw insErr;
        toast.success("Spray equipment created");
      }
      await qc.invalidateQueries({
        queryKey: ["list", "spray_equipment", selectedVineyardId],
      });
      await qc.invalidateQueries({
        queryKey: ["count", "spray_equipment", selectedVineyardId],
      });
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
      toast.error("Only owners and managers can archive spray equipment.");
      return;
    }
    setArchiveSubmitting(true);
    try {
      const { error: rpcErr } = await supabase.rpc("soft_delete_spray_equipment", {
        p_id: archiving.id,
      });
      if (rpcErr) {
        const msg = (rpcErr.message || "").toLowerCase();
        if (
          msg.includes("permission") ||
          msg.includes("denied") ||
          msg.includes("not allowed") ||
          msg.includes("rls")
        ) {
          toast.error("Only owners and managers can archive spray equipment.");
        } else {
          toast.error(`Archive failed: ${rpcErr.message}`);
        }
        return;
      }
      toast.success("Spray equipment archived");
      await qc.invalidateQueries({
        queryKey: ["list", "spray_equipment", selectedVineyardId],
      });
      await qc.invalidateQueries({
        queryKey: ["count", "spray_equipment", selectedVineyardId],
      });
      setArchiving(null);
    } catch (err: any) {
      toast.error(`Archive failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setArchiveSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Spray equipment</h1>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Spray equipment edits are live production changes."
              : "Read-only view."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
          {canEdit && (
            <Button onClick={openCreate} size="sm">
              <Plus className="h-4 w-4" /> New spray equipment
            </Button>
          )}
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Tank capacity (L)</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[160px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No spray equipment yet.{" "}
                  {canEdit && (
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={openCreate}
                    >
                      Add your first spray equipment
                    </button>
                  )}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(`/setup/spray-equipment/${r.id}`)}
              >
                <TableCell className="font-medium">{fmtCell(r.name)}</TableCell>
                <TableCell>{fmtCell(r.tank_capacity_litres)}</TableCell>
                <TableCell>{fmtCell(r.updated_at)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(r)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setArchiving(r)}
                        aria-label="Archive spray equipment"
                      >
                        <Archive className="h-4 w-4" />
                        <span className="ml-1 hidden sm:inline">Archive</span>
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit spray equipment" : "New spray equipment"}
              </DialogTitle>
              <DialogDescription>
                Saves to the production database for the selected vineyard.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label="Name *" error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  maxLength={120}
                  autoFocus
                  required
                />
              </Field>
              <Field
                label="Tank capacity (L) *"
                error={errors.tank_capacity_litres}
                hint="Used for spray planning and tank calculations."
              >
                <Input
                  inputMode="decimal"
                  value={form.tank_capacity_litres}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      tank_capacity_litres: e.target.value.replace(/[^\d.]/g, ""),
                    }))
                  }
                  required
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !canEdit}>
                {submitting
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create spray equipment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!archiving}
        onOpenChange={(o) => !o && !archiveSubmitting && setArchiving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this spray equipment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the spray equipment from active setup lists but
              keep the record for sync/history.
              {archiving?.name ? ` (${archiving.name})` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleArchive();
              }}
              disabled={archiveSubmitting || !canEdit}
            >
              {archiveSubmitting ? "Archiving…" : "Archive spray equipment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
