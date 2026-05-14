import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { Plus, Archive, RotateCcw } from "lucide-react";
import {
  fetchSavedInputsForVineyard,
  createSavedInput,
  updateSavedInput,
  archiveSavedInput,
  restoreSavedInput,
  type SavedInput,
  type SavedInputInput,
} from "@/lib/savedInputsQuery";
import { useCanSeeCosts } from "@/lib/permissions";

const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};
const fmtMoney = (v?: number | null, unit?: string | null) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit ? `/${unit}` : ""}`;

export default function SavedInputsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canSeeCosts = useCanSeeCosts();
  const canWrite = currentRole === "owner" || currentRole === "manager";
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<SavedInput | "new" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["saved_inputs", selectedVineyardId, "active"],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchSavedInputsForVineyard(selectedVineyardId!),
  });
  const archivedQuery = useQuery({
    queryKey: ["saved_inputs", selectedVineyardId, "archived"],
    enabled: !!selectedVineyardId && tab === "archived",
    queryFn: () => fetchSavedInputsForVineyard(selectedVineyardId!, { archived: true }),
  });
  const list = (tab === "active" ? data?.inputs : archivedQuery.data?.inputs) ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["saved_inputs"] });

  const rows = useMemo(() => {
    let items = list.slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      items = items.filter((c) =>
        [c.name, c.input_type, c.unit, c.supplier, c.notes].some((v) =>
          String(v ?? "").toLowerCase().includes(f),
        ),
      );
    }
    return items;
  }, [list, filter]);

  const restoreMut = useMutation({
    mutationFn: async (item: SavedInput) =>
      restoreSavedInput(item.id, user?.id ?? null, item.sync_version ?? 0),
    onSuccess: () => {
      toast({ title: "Saved input restored" });
      invalidate();
    },
    onError: (e: any) =>
      toast({ title: "Could not restore", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Saved Inputs</h1>
          <p className="text-sm text-muted-foreground">
            Shared library of seed, fertiliser and other input items used in trip
            costing. Syncs with the iOS app.
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setEditing("new")} disabled={!selectedVineyardId}>
            <Plus className="h-4 w-4 mr-2" /> New input
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "archived")}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto space-y-1">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Name, type, supplier…"
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
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Unit</TableHead>
              {canSeeCosts && <TableHead>Cost / unit</TableHead>}
              <TableHead>Supplier</TableHead>
              <TableHead>Updated</TableHead>
              {tab === "archived" && canWrite && <TableHead className="w-24" />}
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
                  {tab === "active"
                    ? canWrite
                      ? "No saved inputs yet. Add one with “New input”."
                      : "No saved inputs yet."
                    : "No archived inputs."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => tab === "active" && setEditing(c)}
              >
                <TableCell className="font-medium">{fmt(c.name)}</TableCell>
                <TableCell>{fmt(c.input_type)}</TableCell>
                <TableCell>{fmt(c.unit)}</TableCell>
                {canSeeCosts && <TableCell>{fmtMoney(c.cost_per_unit, c.unit)}</TableCell>}
                <TableCell>{fmt(c.supplier)}</TableCell>
                <TableCell>{fmtDate(c.updated_at)}</TableCell>
                {tab === "archived" && canWrite && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => restoreMut.mutate(c)}
                      disabled={restoreMut.isPending}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" /> Restore
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <InputEditor
        key={editing === "new" ? "new" : editing?.id ?? "none"}
        item={editing === "new" ? null : editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        vineyardId={selectedVineyardId}
        userId={user?.id ?? null}
        canWrite={canWrite}
        canSeeCosts={canSeeCosts}
        onSaved={() => {
          invalidate();
          setEditing(null);
        }}
      />
    </div>
  );
}

const TYPE_OPTIONS = ["Seed", "Fertiliser", "Soil amendment", "Other"];

function InputEditor({
  item, open, onOpenChange, vineyardId, userId, canWrite, canSeeCosts, onSaved,
}: {
  item: SavedInput | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string | null;
  userId: string | null;
  canWrite: boolean;
  canSeeCosts: boolean;
  onSaved: () => void;
}) {
  const isNew = !item;
  const [form, setForm] = useState<SavedInputInput>({
    name: "", input_type: "", unit: "", cost_per_unit: null, supplier: "", notes: "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        name: item?.name ?? "",
        input_type: item?.input_type ?? "",
        unit: item?.unit ?? "",
        cost_per_unit: item?.cost_per_unit ?? null,
        supplier: item?.supplier ?? "",
        notes: item?.notes ?? "",
      });
    }
  }, [open, item]);

  const upd = (patch: Partial<SavedInputInput>) => setForm((p) => ({ ...p, ...patch }));

  const createMut = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard selected");
      return createSavedInput({ vineyard_id: vineyardId, user_id: userId, input: form, includeCost: canSeeCosts });
    },
    onSuccess: () => { toast({ title: "Saved input created" }); onSaved(); },
    onError: (e: any) => toast({ title: "Could not create", description: e?.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Missing input");
      return updateSavedInput({
        id: item.id, user_id: userId, input: form, includeCost: canSeeCosts,
        current_sync_version: item.sync_version ?? 0,
      });
    },
    onSuccess: () => { toast({ title: "Saved input updated" }); onSaved(); },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message, variant: "destructive" }),
  });
  const archiveMut = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Missing input");
      return archiveSavedInput(item.id, userId, item.sync_version ?? 0);
    },
    onSuccess: () => { toast({ title: "Saved input archived" }); onSaved(); },
    onError: (e: any) => toast({ title: "Could not archive", description: e?.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!form.name?.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const cpu = form.cost_per_unit;
    if (cpu != null && (typeof cpu !== "number" || !isFinite(cpu) || cpu < 0)) {
      toast({ title: "Cost per unit must be a positive number", variant: "destructive" });
      return;
    }
    if (isNew) createMut.mutate(); else updateMut.mutate();
  };

  const busy = createMut.isPending || updateMut.isPending || archiveMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isNew ? "New saved input" : item?.name ?? "Saved input"}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="si-name">Name <span className="text-destructive">*</span></Label>
            <Input id="si-name" value={form.name ?? ""} onChange={(e) => upd({ name: e.target.value })}
              placeholder="e.g. Lucerne Hunter River" maxLength={120} disabled={!canWrite} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="si-type">Type</Label>
              <Input id="si-type" list="si-type-options" value={form.input_type ?? ""}
                onChange={(e) => upd({ input_type: e.target.value })}
                placeholder="Seed, fertiliser…" disabled={!canWrite} />
              <datalist id="si-type-options">
                {TYPE_OPTIONS.map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="si-unit">Unit</Label>
              <Input id="si-unit" value={form.unit ?? ""} onChange={(e) => upd({ unit: e.target.value })}
                placeholder="kg, L, bag…" disabled={!canWrite} />
            </div>
          </div>
          {canSeeCosts && (
            <div className="space-y-1.5">
              <Label htmlFor="si-cost">Cost per unit</Label>
              <Input id="si-cost" type="number" inputMode="decimal" step="0.01" min="0"
                value={form.cost_per_unit == null ? "" : String(form.cost_per_unit)}
                onChange={(e) => upd({ cost_per_unit: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="0.00" disabled={!canWrite} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="si-supplier">Supplier</Label>
            <Input id="si-supplier" value={form.supplier ?? ""}
              onChange={(e) => upd({ supplier: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="si-notes">Notes</Label>
            <Textarea id="si-notes" rows={3} value={form.notes ?? ""}
              onChange={(e) => upd({ notes: e.target.value })} disabled={!canWrite} />
          </div>

          {!isNew && item && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs text-muted-foreground">
              <div>Created: {fmtDate(item.created_at)}</div>
              <div>Updated: {fmtDate(item.updated_at)}</div>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-row sm:justify-between">
          {!isNew && canWrite ? (
            <Button variant="destructive" disabled={busy}
              onClick={() => { if (confirm("Archive this saved input?")) archiveMut.mutate(); }}>
              <Archive className="h-4 w-4 mr-2" /> Archive
            </Button>
          ) : (<span />)}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            {canWrite && (
              <Button onClick={submit} disabled={busy || !form.name?.trim()}>
                {isNew ? "Create" : "Save"}
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
