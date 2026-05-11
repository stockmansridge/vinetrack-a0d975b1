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
import { PRODUCT_CATEGORIES, composeRestrictions } from "@/lib/chemicalCategories";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChemicalAILookup, type AppliedSuggestion } from "@/components/spray/ChemicalAILookup";
import { useVineyard } from "@/context/VineyardContext";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  inferRateBasis, composeUnit, chemUnitOnly, normaliseUnit,
  inferProductType, defaultUnitFor, unitsFor,
  RATE_BASIS_LABEL, PRODUCT_TYPE_LABEL,
  type RateBasis, type ProductType, type ChemUnit,
} from "@/lib/rateBasis";

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
  const { currentCountry } = useVineyard();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [showAI, setShowAI] = useState(false);

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

  const applyAIMut = useMutation({
    mutationFn: async (s: AppliedSuggestion): Promise<{ chem: SavedChemical; saved: boolean }> => {
      // If the AI hit matches an existing library item, just select it.
      if (s.existing_chemical_id) {
        const match = (data?.chemicals ?? []).find((c) => c.id === s.existing_chemical_id);
        if (match) return { chem: match, saved: false };
      }
      const nextBasis = s.rate_basis ?? "per_hectare";
      const unit = s.unit ?? "L";
      const composed = s.rate_unit ?? `${unit}${nextBasis === "per_100L" ? "/100L" : "/ha"}`;
      const restrictions = composeRestrictions({
        whpDays: s.whp_days ?? "",
        reiHours: s.rei_hours ?? "",
        rest: s.target ? `Target: ${s.target}` : "",
      });
      const name = (s.name ?? "").trim() || "Unnamed product";

      // Only persist to the library if we have a valid rate (NOT NULL in DB).
      if (s.rate_per_ha != null && !Number.isNaN(Number(s.rate_per_ha))) {
        const created = await createSavedChemical(vineyardId, {
          name,
          active_ingredient: s.active_ingredient ?? null,
          chemical_group: s.chemical_group ?? null,
          use: (s.category as string) ?? null,
          manufacturer: s.manufacturer ?? null,
          rate_per_ha: s.rate_per_ha,
          unit: composed,
          restrictions: restrictions || null,
          notes: s.notes ?? null,
        });
        return { chem: created, saved: true };
      }

      // No rate yet — build a synthetic chem to populate the spray line
      // without touching saved_chemicals. The user can fill the rate in
      // and save manually from the Chemicals page later.
      const synthetic: SavedChemical = {
        id: "",
        vineyard_id: vineyardId,
        name,
        active_ingredient: s.active_ingredient ?? null,
        chemical_group: s.chemical_group ?? null,
        use: (s.category as string) ?? null,
        manufacturer: s.manufacturer ?? null,
        rate_per_ha: null,
        unit: composed,
        restrictions: restrictions || null,
        notes: s.notes ?? null,
      };
      return { chem: synthetic, saved: false };
    },
    onSuccess: ({ chem, saved }) => {
      if (saved) {
        qc.invalidateQueries({ queryKey: ["saved-chemicals-picker", vineyardId] });
        qc.invalidateQueries({ queryKey: ["saved_chemicals", vineyardId] });
        toast({ title: "Chemical added to library" });
      } else if (!chem.id) {
        toast({
          title: "Rate required",
          description: "Applied product details to the line. Enter a rate before saving this chemical to your library.",
        });
      }
      onSelect(chem);
      setShowAI(false);
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({ title: "Could not apply chemical", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select chemical</DialogTitle>
            <DialogDescription>
              Pick a chemical from this vineyard's saved library, run an AI lookup, or add a new one.
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

            {showAI && (
              <ChemicalAILookup
                initialName={search}
                country={currentCountry}
                existingLibrary={(data?.chemicals ?? []).map((c) => ({
                  id: c.id,
                  name: c.name,
                  active_ingredient: c.active_ingredient,
                }))}
                onApply={(s) => applyAIMut.mutate(s)}
              />
            )}

            <div className="rounded-md border max-h-[40vh] overflow-y-auto divide-y">
              {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
              {!isLoading && filtered.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">
                  No chemicals match. {canCreate && "Try AI Lookup or Add chemical below."}
                </div>
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

            <div className="flex items-center justify-end gap-2 pt-1 border-t">
              {canCreate && (
                <>
                  <Button
                    size="sm"
                    variant={showAI ? "default" : "outline"}
                    onClick={() => setShowAI((v) => !v)}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                    {showAI ? "Hide AI lookup" : "AI Lookup"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add chemical
                  </Button>
                </>
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
          existingLibrary={data?.chemicals ?? []}
          onPickExisting={(c) => {
            setCreating(false);
            onSelect(c);
            onOpenChange(false);
          }}
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
  open, onOpenChange, vineyardId, existingLibrary, onCreated, onPickExisting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  existingLibrary: SavedChemical[];
  onCreated: (c: SavedChemical) => void;
  onPickExisting: (c: SavedChemical) => void;
}) {
  const { toast } = useToast();
  const { currentCountry } = useVineyard();
  const [form, setForm] = useState({
    name: "",
    active_ingredient: "",
    chemical_group: "",
    use: "",
    rate_per_ha: "" as string,
    unit: "L/ha",
    notes: "",
  });

  const productType = inferProductType(form.unit);
  const chemUnit: ChemUnit =
    (normaliseUnit(form.unit) as ChemUnit) || defaultUnitFor(productType);
  const basis = inferRateBasis(form.unit);

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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add new chemical</DialogTitle>
          <DialogDescription>
            Save a new chemical to this vineyard's library, or pick an existing match the AI lookup finds. Nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm max-h-[70vh] overflow-y-auto pr-1">
          <ChemicalAILookup
            initialName={form.name}
            country={currentCountry}
            existingLibrary={existingLibrary.map((c) => ({
              id: c.id,
              name: c.name,
              active_ingredient: c.active_ingredient,
            }))}
            onApply={(s: AppliedSuggestion) => {
              if (s.existing_chemical_id) {
                const match = existingLibrary.find((c) => c.id === s.existing_chemical_id);
                if (match) onPickExisting(match);
                return;
              }
              const nextBasis = s.rate_basis ?? inferRateBasis(s.rate_unit);
              const nextType = s.product_type ?? inferProductType(s.unit ?? s.rate_unit);
              const nextUnit =
                s.unit ?? (normaliseUnit(s.rate_unit) || defaultUnitFor(nextType));
              const composed = s.rate_unit ?? composeUnit(nextUnit, nextBasis);
              setForm((p) => ({
                ...p,
                name: s.name ?? p.name,
                active_ingredient: s.active_ingredient ?? p.active_ingredient,
                chemical_group: s.chemical_group ?? p.chemical_group,
                use: (s.category as string) ?? p.use,
                rate_per_ha: s.rate_per_ha != null ? String(s.rate_per_ha) : p.rate_per_ha,
                unit: composed,
                notes: s.notes ?? p.notes,
              }));
            }}
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
            <div className="space-y-1 col-span-2">
              <Label>Category</Label>
              <Select value={form.use} onValueChange={(v) => setForm({ ...form, use: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Default rate</Label>
              <Input type="number" value={form.rate_per_ha} onChange={(e) => setForm({ ...form, rate_per_ha: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Product type</Label>
              <Select
                value={productType}
                onValueChange={(v) => {
                  const pt = v as ProductType;
                  setForm({ ...form, unit: composeUnit(defaultUnitFor(pt), basis) });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="liquid">{PRODUCT_TYPE_LABEL.liquid}</SelectItem>
                  <SelectItem value="solid">{PRODUCT_TYPE_LABEL.solid}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Unit</Label>
              <Select
                value={chemUnit}
                onValueChange={(v) => setForm({ ...form, unit: composeUnit(v, basis) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {unitsFor(productType).map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Rate basis</Label>
              <RadioGroup
                className="flex gap-4 pt-2"
                value={basis}
                onValueChange={(v) => {
                  const b = v as RateBasis;
                  setForm({ ...form, unit: composeUnit(chemUnit, b) });
                }}
              >
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <RadioGroupItem value="per_hectare" /> {RATE_BASIS_LABEL.per_hectare}
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <RadioGroupItem value="per_100L" /> {RATE_BASIS_LABEL.per_100L}
                </label>
              </RadioGroup>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-1">
            Choose whether this product rate is applied by area or by spray volume.
          </p>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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