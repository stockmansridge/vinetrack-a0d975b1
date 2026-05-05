import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { fetchList } from "@/lib/queries";
import { supabase } from "@/integrations/ios-supabase/client";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
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
import { Plus, Pencil } from "lucide-react";
import { z } from "zod";

interface Tractor {
  id: string;
  vineyard_id: string;
  name: string | null;
  brand: string | null;
  model: string | null;
  model_year: number | null;
  fuel_usage_l_per_hour: number | null;
  updated_at?: string | null;
}

const CURRENT_YEAR = new Date().getFullYear();

const tractorSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Name is required" })
    .max(120, { message: "Name must be ≤ 120 characters" }),
  brand: z.string().trim().max(120).optional().or(z.literal("")),
  model: z.string().trim().max(120).optional().or(z.literal("")),
  model_year: z
    .union([
      z.literal(""),
      z
        .number()
        .int()
        .min(1900, { message: "Year must be ≥ 1900" })
        .max(CURRENT_YEAR + 1, { message: `Year must be ≤ ${CURRENT_YEAR + 1}` }),
    ])
    .optional(),
  fuel_usage_l_per_hour: z
    .number({ invalid_type_error: "Fuel usage is required" })
    .gt(0, { message: "Fuel usage must be greater than 0" })
    .max(1000, { message: "Fuel usage must be ≤ 1000" }),
});

const DEFAULT_FUEL_L_PER_HOUR = 14;

type FormState = {
  name: string;
  brand: string;
  model: string;
  model_year: string;
  fuel_usage_l_per_hour: string;
};

const emptyForm: FormState = {
  name: "",
  brand: "",
  model: "",
  model_year: "",
  fuel_usage_l_per_hour: String(DEFAULT_FUEL_L_PER_HOUR),
};

const fmtCell = (v: any) => {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleDateString();
  }
  return String(v);
};

export default function TractorsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tractor | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const canEdit = currentRole === "owner" || currentRole === "manager";

  const { data, isLoading, error } = useQuery({
    queryKey: ["list", "tractors", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchList<Tractor>("tractors", selectedVineyardId!),
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!filter) return list;
    const f = filter.toLowerCase();
    return list.filter((r) =>
      [r.name, r.brand, r.model, r.model_year, r.fuel_usage_l_per_hour]
        .some((v) => String(v ?? "").toLowerCase().includes(f)),
    );
  }, [data, filter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (t: Tractor) => {
    setEditing(t);
    setForm({
      name: t.name ?? "",
      brand: t.brand ?? "",
      model: t.model ?? "",
      model_year: t.model_year != null ? String(t.model_year) : "",
      fuel_usage_l_per_hour:
        t.fuel_usage_l_per_hour != null ? String(t.fuel_usage_l_per_hour) : "",
    });
    setErrors({});
    setDialogOpen(true);
  };

  const validate = () => {
    const parsed = tractorSchema.safeParse({
      name: form.name,
      brand: form.brand,
      model: form.model,
      model_year:
        form.model_year === "" ? "" : Number(form.model_year),
      fuel_usage_l_per_hour:
        form.fuel_usage_l_per_hour === "" ? NaN : Number(form.fuel_usage_l_per_hour),
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
      toast.error("You don't have permission to edit tractors.");
      return;
    }
    const valid = validate();
    if (!valid) return;

    const nowIso = new Date().toISOString();
    const trimmedOrNull = (s: string) => {
      const t = s.trim();
      return t === "" ? null : t;
    };
    const numOrNull = (s: string) => {
      if (s === "" || s == null) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    setSubmitting(true);
    try {
      if (editing) {
        const updatePayload = {
          name: form.name.trim(),
          brand: trimmedOrNull(form.brand),
          model: trimmedOrNull(form.model),
          model_year: numOrNull(form.model_year),
          fuel_usage_l_per_hour: Number(form.fuel_usage_l_per_hour),
          updated_by: user.id,
          client_updated_at: nowIso,
        };
        const { error: upErr } = await supabase
          .from("tractors")
          .update(updatePayload)
          .eq("id", editing.id)
          .eq("vineyard_id", selectedVineyardId);
        if (upErr) throw upErr;
        toast.success("Tractor updated");
      } else {
        const id = crypto.randomUUID();
        const insertPayload = {
          id,
          vineyard_id: selectedVineyardId,
          name: form.name.trim(),
          brand: trimmedOrNull(form.brand),
          model: trimmedOrNull(form.model),
          model_year: numOrNull(form.model_year),
          fuel_usage_l_per_hour: Number(form.fuel_usage_l_per_hour),
          created_by: user.id,
          updated_by: user.id,
          client_updated_at: nowIso,
        };
        const { error: insErr } = await supabase
          .from("tractors")
          .insert(insertPayload);
        if (insErr) throw insErr;
        toast.success("Tractor created");
      }
      await qc.invalidateQueries({ queryKey: ["list", "tractors", selectedVineyardId] });
      await qc.invalidateQueries({ queryKey: ["count", "tractors", selectedVineyardId] });
      setDialogOpen(false);
    } catch (err: any) {
      const msg = err?.message ?? "Save failed";
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tractors</h1>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Tractor setup edits are live production changes."
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
              <Plus className="h-4 w-4" /> New tractor
            </Button>
          )}
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Fuel (L/h)</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No tractors yet.{" "}
                  {canEdit && (
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={openCreate}
                    >
                      Add your first tractor
                    </button>
                  )}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(`/setup/tractors/${r.id}`)}
              >
                <TableCell className="font-medium">{fmtCell(r.name)}</TableCell>
                <TableCell>{fmtCell(r.brand)}</TableCell>
                <TableCell>{fmtCell(r.model)}</TableCell>
                <TableCell>{fmtCell(r.model_year)}</TableCell>
                <TableCell>{fmtCell(r.fuel_usage_l_per_hour)}</TableCell>
                <TableCell>{fmtCell(r.updated_at)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(r)}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
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
              <DialogTitle>{editing ? "Edit tractor" : "New tractor"}</DialogTitle>
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
              <div className="grid grid-cols-2 gap-3">
                <Field label="Brand" error={errors.brand}>
                  <Input
                    value={form.brand}
                    onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                    maxLength={120}
                  />
                </Field>
                <Field label="Model" error={errors.model}>
                  <Input
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    maxLength={120}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Year" error={errors.model_year}>
                  <Input
                    inputMode="numeric"
                    value={form.model_year}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, model_year: e.target.value.replace(/[^\d]/g, "") }))
                    }
                    maxLength={4}
                  />
                </Field>
                <Field
                  label="Fuel usage (L/hr) *"
                  error={errors.fuel_usage_l_per_hour}
                  hint="Used for fuel cost and operating cost calculations."
                >
                  <Input
                    inputMode="decimal"
                    value={form.fuel_usage_l_per_hour}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        fuel_usage_l_per_hour: e.target.value.replace(/[^\d.]/g, ""),
                      }))
                    }
                    required
                  />
                </Field>
              </div>
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
                {submitting ? "Saving…" : editing ? "Save changes" : "Create tractor"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
