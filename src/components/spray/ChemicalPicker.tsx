import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  fetchSavedChemicalsForVineyard,
  createSavedChemical,
  type SavedChemical,
} from "@/lib/savedChemicalsQuery";
import { PRODUCT_CATEGORIES } from "@/lib/chemicalCategories";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChemicalAILookup, type AppliedSuggestion } from "@/components/spray/ChemicalAILookup";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  canCreate: boolean;
  onSelect: (chem: SavedChemical) => void;
}

export function ChemicalPicker({ open, onOpenChange, vineyardId, canCreate, onSelect }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["saved-chemicals-picker", vineyardId],
    enabled: open && !!vineyardId,
    queryFn: () => fetchSavedChemicalsForVineyard(vineyardId),
  });

  const filtered = useMemo(() => {
    const list = data?.chemicals ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const hay = [
        c.name, c.active_ingredient, c.chemical_group, c.use,
        c.problem, c.crop, c.manufacturer,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [data, search]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select chemical</DialogTitle>
            <DialogDescription>
              Pick a chemical from this vineyard's saved library, or add a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, active ingredient, group, use, target…"
                className="pl-8"
              />
            </div>

            <div className="rounded-md border max-h-[50vh] overflow-y-auto divide-y">
              {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
              {!isLoading && filtered.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No chemicals match.</div>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onSelect(c); onOpenChange(false); }}
                  className="w-full text-left p-3 hover:bg-muted/50 focus:bg-muted/60 focus:outline-none"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="font-medium">{c.name ?? "Unnamed"}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.rate_per_ha != null ? `${c.rate_per_ha}${c.unit ? ` ${c.unit}` : ""}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {[c.active_ingredient, c.chemical_group, c.use, c.problem]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                AI chemical lookup coming later.
              </div>
              {canCreate && (
                <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add chemical
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {creating && (
        <NewChemicalDialog
          open={creating}
          onOpenChange={setCreating}
          vineyardId={vineyardId}
          onCreated={(c) => {
            qc.invalidateQueries({ queryKey: ["saved-chemicals-picker", vineyardId] });
            qc.invalidateQueries({ queryKey: ["saved_chemicals", vineyardId] });
            toast({ title: "Chemical added" });
            onSelect(c);
            setCreating(false);
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

function NewChemicalDialog({
  open, onOpenChange, vineyardId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  onCreated: (c: SavedChemical) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    active_ingredient: "",
    chemical_group: "",
    use: "",
    rate_per_ha: "" as string,
    unit: "L/ha",
    notes: "",
  });

  const createMut = useMutation({
    mutationFn: () =>
      createSavedChemical(vineyardId, {
        name: form.name,
        active_ingredient: form.active_ingredient || null,
        chemical_group: form.chemical_group || null,
        use: form.use || null,
        rate_per_ha: form.rate_per_ha === "" ? null : Number(form.rate_per_ha),
        unit: form.unit || null,
        notes: form.notes || null,
      }),
    onSuccess: (c) => onCreated(c),
    onError: (e: any) => toast({ title: "Could not add", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add new chemical</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <ChemicalAILookup
            initialName={form.name}
            onApply={(s: AppliedSuggestion) =>
              setForm((p) => ({
                ...p,
                name: s.name ?? p.name,
                active_ingredient: s.active_ingredient ?? p.active_ingredient,
                chemical_group: s.chemical_group ?? p.chemical_group,
                use: (s.category as string) ?? p.use,
                rate_per_ha: s.rate_per_ha != null ? String(s.rate_per_ha) : p.rate_per_ha,
                unit: s.rate_unit ?? p.unit,
                notes: s.notes ?? p.notes,
              }))
            }
          />
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Active ingredient</Label>
              <Input value={form.active_ingredient} onChange={(e) => setForm({ ...form, active_ingredient: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Chemical group</Label>
              <Input value={form.chemical_group} onChange={(e) => setForm({ ...form, chemical_group: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Product type / category</Label>
              <Select value={form.use} onValueChange={(v) => setForm({ ...form, use: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Default rate</Label>
              <div className="flex gap-2">
                <Input type="number" value={form.rate_per_ha} onChange={(e) => setForm({ ...form, rate_per_ha: e.target.value })} />
                <Input className="w-24" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI chemical lookup coming later.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!form.name.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
            {createMut.isPending ? "Saving…" : "Add chemical"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
