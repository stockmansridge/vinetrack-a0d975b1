import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import {
  fetchEquipmentItemsForVineyard,
  createEquipmentItem,
  updateEquipmentItem,
  softDeleteEquipmentItem,
  type EquipmentItem,
} from "@/lib/equipmentItemsQuery";

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
};
const fmt = (v: any) => (v == null || v === "" ? "—" : String(v));

export default function EquipmentOtherItemsPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<EquipmentItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const canWrite = currentRole === "owner" || currentRole === "manager";

  const { data, isLoading, error } = useQuery({
    queryKey: ["equipment_items", "other", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchEquipmentItemsForVineyard(selectedVineyardId!, "other"),
  });

  const items = data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["equipment_items"] });
    qc.invalidateQueries({ queryKey: ["equipment_selector_options"] });
  };

  const rows = useMemo(() => {
    let list = items.slice();
    list.sort((a, b) => {
      const sa = a.sort_order ?? 9999;
      const sb = b.sort_order ?? 9999;
      if (sa !== sb) return sa - sb;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((c) => (c.name ?? "").toLowerCase().includes(f));
    }
    return list;
  }, [items, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Other equipment items</h1>
          <p className="text-sm text-muted-foreground">
            Shared with iOS. Used on Maintenance to identify items that aren't
            tractors or spray equipment. Archived rows are hidden.
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!selectedVineyardId}>
            <Plus className="h-4 w-4 mr-2" /> New item
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 ml-auto">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            placeholder="Name…"
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
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-destructive py-6">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                  No other equipment items yet. Add one with “New item”.
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
                <TableCell>{fmtDate(c.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ItemEditor
        key={editing?.id ?? "edit"}
        item={editing}
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

      <ItemEditor
        key={createOpen ? "create-open" : "create-closed"}
        item={null}
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

function ItemEditor({
  item,
  open,
  onOpenChange,
  vineyardId,
  userId,
  canWrite,
  onSaved,
}: {
  item: EquipmentItem | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string | null;
  userId: string | null;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const isNew = !item;
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName(item?.name ?? "");
  }, [open, item]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard selected");
      return createEquipmentItem({
        vineyard_id: vineyardId,
        name: name.trim(),
        category: "other",
        user_id: userId,
      });
    },
    onSuccess: () => {
      toast({ title: "Equipment item created" });
      onSaved();
    },
    onError: (e: any) => {
      toast({
        title: "Could not create item",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Missing item");
      return updateEquipmentItem({
        id: item.id,
        name: name.trim(),
        user_id: userId,
        current_sync_version: item.sync_version ?? 0,
      });
    },
    onSuccess: () => {
      toast({ title: "Equipment item updated" });
      onSaved();
    },
    onError: (e: any) => {
      toast({
        title: "Could not update item",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Missing item");
      return softDeleteEquipmentItem(item.id, userId, item.sync_version ?? 0);
    },
    onSuccess: () => {
      toast({ title: "Equipment item archived" });
      onSaved();
    },
    onError: (e: any) => {
      toast({
        title: "Could not archive item",
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
    if (isNew) createMut.mutate();
    else updateMut.mutate();
  };

  const busy = createMut.isPending || updateMut.isPending || deleteMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isNew ? "New other equipment item" : item?.name ?? "Equipment item"}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="ei-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ei-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mulcher, Compressor"
              maxLength={120}
              required
              disabled={!canWrite}
            />
            {!name.trim() && (
              <p className="text-xs text-muted-foreground">Name is required.</p>
            )}
          </div>

          {!isNew && item && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs text-muted-foreground">
              <div>Created: {fmtDate(item.created_at)}</div>
              <div>Updated: {fmtDate(item.updated_at)}</div>
              <div className="font-mono break-all">{item.id}</div>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-row sm:justify-between">
          {!isNew && canWrite ? (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("Archive this equipment item?")) deleteMut.mutate();
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
