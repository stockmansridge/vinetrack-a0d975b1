import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import {
  fetchOperatorCategoriesForVineyard,
  createOperatorCategory,
  updateOperatorCategory,
  softDeleteOperatorCategory,
  type OperatorCategory,
} from "@/lib/operatorCategoriesQuery";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));
const fmtMoney = (v?: number | null) =>
  v == null
    ? "—"
    : `$${Number(v).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}/h`;

export default function OperatorCategoriesPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<OperatorCategory | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const canWrite =
    currentRole === "owner" || currentRole === "manager" || currentRole === "supervisor";

  const { data, isLoading, error } = useQuery({
    queryKey: ["operator-categories", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchOperatorCategoriesForVineyard(selectedVineyardId!),
  });

  const categories = data?.categories ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["operator-categories"] });
    qc.invalidateQueries({ queryKey: ["operator_categories"] });
  };

  const rows = useMemo(() => {
    let list = categories.slice();
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.cost_per_hour].some((v) =>
          String(v ?? "").toLowerCase().includes(f),
        ),
      );
    }
    return list;
  }, [categories, filter]);

  // Diagnostic query: fetch ALL rows for this vineyard (including soft-deleted)
  // so we can see exactly what the iOS Supabase project returns to this client.
  const { data: diag, refetch: refetchDiag } = useQuery({
    queryKey: ["operator-categories-diagnostic", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const res = await supabase
        .from("operator_categories")
        .select(
          "id,vineyard_id,name,cost_per_hour,deleted_at,created_at,updated_at,client_updated_at,sync_version,created_by,updated_by",
        )
        .eq("vineyard_id", selectedVineyardId!);
      if (res.error) throw res.error;
      const all = (res.data ?? []) as OperatorCategory[];
      const active = all.filter((r) => r.deleted_at == null);
      const deleted = all.filter((r) => r.deleted_at != null);
      return { all, active, deleted };
    },
  });

  useEffect(() => {
    if (!import.meta.env.DEV || !diag) return;
    // eslint-disable-next-line no-console
    console.groupCollapsed(
      `[operator_categories DIAG] vineyard=${selectedVineyardId} total=${diag.all.length} active=${diag.active.length} deleted=${diag.deleted.length}`,
    );
    diag.all.forEach((r) => {
      // eslint-disable-next-line no-console
      console.log({
        id: r.id,
        vineyard_id: r.vineyard_id,
        name: r.name,
        cost_per_hour: r.cost_per_hour,
        deleted_at: r.deleted_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        client_updated_at: r.client_updated_at,
        sync_version: r.sync_version,
      });
    });
    // eslint-disable-next-line no-console
    console.groupEnd();
  }, [diag, selectedVineyardId]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operator categories</h1>
          <p className="text-sm text-muted-foreground">
            Shared with iOS. Soft-deleted records are excluded.
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!selectedVineyardId}>
            <Plus className="h-4 w-4 mr-2" /> New category
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Name or cost…"
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
              <TableHead>Cost per hour</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-destructive py-6">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                  No operator categories yet. Add one with “New category”.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => setEditing(c)}
              >
                <TableCell className="font-medium">{fmt(c.name)}</TableCell>
                <TableCell>{fmtMoney(c.cost_per_hour)}</TableCell>
                <TableCell>{fmtDate(c.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CategoryEditor
        key={editing?.id ?? "new"}
        category={editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        vineyardId={selectedVineyardId}
        userId={user?.id ?? null}
        canWrite={canWrite}
        onSaved={() => {
          invalidate();
          setEditing(null);
        }}
      />

      <CategoryEditor
        key={createOpen ? "create-open" : "create-closed"}
        category={null}
        open={createOpen}
        onOpenChange={setCreateOpen}
        vineyardId={selectedVineyardId}
        userId={user?.id ?? null}
        canWrite={canWrite}
        onSaved={() => {
          invalidate();
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function CategoryEditor({
  category,
  open,
  onOpenChange,
  vineyardId,
  userId,
  canWrite,
  onSaved,
}: {
  category: OperatorCategory | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string | null;
  userId: string | null;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const isNew = !category;
  const [name, setName] = useState("");
  const [cost, setCost] = useState<string>("");

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setCost(
        category?.cost_per_hour == null ? "" : String(category.cost_per_hour),
      );
    }
  }, [open, category]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard selected");
      return createOperatorCategory({
        vineyard_id: vineyardId,
        name: name.trim(),
        cost_per_hour: cost === "" ? null : Number(cost),
        user_id: userId,
      });
    },
    onSuccess: () => {
      toast({ title: "Operator category created" });
      onSaved();
    },
    onError: (e: any) => {
      toast({
        title: "Could not create category",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!category) throw new Error("Missing category");
      return updateOperatorCategory({
        id: category.id,
        name: name.trim(),
        cost_per_hour: cost === "" ? null : Number(cost),
        user_id: userId,
        current_sync_version: category.sync_version ?? 0,
      });
    },
    onSuccess: () => {
      toast({ title: "Operator category updated" });
      onSaved();
    },
    onError: (e: any) => {
      toast({
        title: "Could not update category",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!category) throw new Error("Missing category");
      return softDeleteOperatorCategory(
        category.id,
        userId,
        category.sync_version ?? 0,
      );
    },
    onSuccess: () => {
      toast({ title: "Operator category archived" });
      onSaved();
    },
    onError: (e: any) => {
      toast({
        title: "Could not archive category",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (cost !== "" && Number.isNaN(Number(cost))) {
      toast({ title: "Cost per hour must be a number", variant: "destructive" });
      return;
    }
    if (isNew) createMut.mutate();
    else updateMut.mutate();
  };

  const busy = createMut.isPending || updateMut.isPending || deleteMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isNew ? "New operator category" : category?.name ?? "Operator category"}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="space-y-1.5">
          <Label htmlFor="oc-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="oc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pruner"
              maxLength={100}
              required
              disabled={!canWrite}
            />
            {!name.trim() && (
              <p className="text-xs text-muted-foreground">Name is required.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oc-cost">Cost per hour</Label>
            <Input
              id="oc-cost"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0.00"
              disabled={!canWrite}
            />
          </div>

          {!isNew && category && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs text-muted-foreground">
              <div>Created: {fmtDate(category.created_at)}</div>
              <div>Updated: {fmtDate(category.updated_at)}</div>
              <div className="font-mono break-all">{category.id}</div>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-row sm:justify-between">
          {!isNew && canWrite ? (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("Archive this operator category?")) deleteMut.mutate();
              }}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Archive
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            {canWrite && (
              <Button onClick={submit} disabled={busy || !name.trim()}>
                {isNew ? "Create" : "Save"}
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
