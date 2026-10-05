// Fertigation Program Step — Products and Review steps (System Admin gate).
//
// Products come from the existing Saved Chemicals catalogue (identity is the
// Saved Chemical UUID). Fertiliser/nutrient categories are listed first, but
// any saved product may be chosen deliberately. Each line needs an explicit
// Fertigation rate basis and unit; nothing is translated from spray bases.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { useCanSeeCosts } from "@/lib/permissions";
import { ChemicalEditor } from "@/components/chemicals/ChemicalEditorSheet";
import { ChemicalSearchDialog } from "@/components/chemicals/ChemicalSearchDialog";
import { fetchSavedChemicalsForVineyard, type SavedChemical } from "@/lib/savedChemicalsQuery";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/ios-supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PortalNotice } from "@/components/ui/PortalNotice";
import type { SprayProductLine } from "@/lib/sprayApplicationDomain";
import {
  FERTIGATION_RATE_BASES,
  FERTIGATION_RATE_BASIS_LABEL,
  FERTIGATION_RATE_UNITS,
  fertigationGateReasons,
  fertigationRateText,
  isFertigationPriorityCategory,
  type FertigationRateBasis,
} from "@/lib/fertigation";
import { PRODUCT_CATEGORY_LABEL, type ProductCategoryKey } from "@/lib/fertiliserCalc";
import type { StepProps } from "./types";

interface SavedProduct {
  id: string;
  name: string | null;
  product_category: string | null;
  product_form: string | null;
  use: string | null;
}

function useSavedProducts(vineyardId: string) {
  return useQuery({
    queryKey: ["fertigation", "saved-products", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("saved_chemicals")
        .select("id, name, product_category, product_form, use")
        .eq("vineyard_id", vineyardId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SavedProduct[];
    },
  });
}

const categoryLabel = (c: string | null) =>
  c ? PRODUCT_CATEGORY_LABEL[c as ProductCategoryKey] ?? c : "Uncategorised";

function blankLine(): SprayProductLine {
  return {
    savedChemicalId: null,
    productName: null,
    rate: null,
    unit: null,
    rateBasis: null,
    activityGroups: [],
    verificationStatus: "unverified" as any,
    fertigationRateBasis: null,
    fertigationRateUnit: null,
  };
}

export function FertigationProductsStep({ app, update, canEdit, vineyardId }: StepProps) {
  const products = useSavedProducts(vineyardId);
  const [showAll, setShowAll] = useState(false);
  const qc = useQueryClient();
  const canSeeCosts = useCanSeeCosts();
  const { memberships, currentCountry } = useVineyard();
  const vineyardName = memberships.find((m) => m.vineyard_id === vineyardId)?.vineyard_name ?? null;
  // Row the operator last worked on; a new chemical binds there (or appends).
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // `null` = closed. index null = append a new line on save.
  const [creating, setCreating] = useState<{ index: number | null; name: string | null } | null>(null);
  const [manual, setManual] = useState(false);

  const selectedIds = useMemo(
    () => new Set(app.products.map((l) => l.savedChemicalId).filter(Boolean) as string[]),
    [app.products],
  );
  const options = useMemo(() => {
    const list = products.data ?? [];
    const priority = list.filter((p) => isFertigationPriorityCategory(p.product_category ?? p.use));
    if (showAll || priority.length === 0) return list;
    // Keep already-selected products visible even when the filter would hide them.
    return list.filter((p) => priority.includes(p) || selectedIds.has(p.id));
  }, [products.data, showAll, selectedIds]);

  // Binds a newly-created Saved Chemical by id. Never sets a Fertigation
  // rate basis/unit — the operator must still choose them explicitly.
  const onChemicalSaved = (saved: Pick<SavedChemical, "id" | "name"> & Record<string, any>) => {
    const target = creating?.index ?? null;
    const identity = {
      savedChemicalId: saved.id,
      productName: saved.name ?? null,
      productCategory: saved.product_category ?? null,
      productForm: saved.product_form ?? null,
    };
    update((a) => {
      if (target != null && target < a.products.length) {
        return { ...a, products: a.products.map((l, j) => (j === target ? { ...l, ...identity } : l)) };
      }
      return { ...a, products: [...a.products, { ...blankLine(), ...identity }] };
    });
    qc.setQueryData<SavedProduct[]>(["fertigation", "saved-products", vineyardId], (prev) => {
      const list = prev ?? [];
      if (list.some((p) => p.id === saved.id)) return list;
      return [...list, {
        id: saved.id,
        name: saved.name ?? null,
        product_category: saved.product_category ?? null,
        product_form: saved.product_form ?? null,
        use: saved.use ?? null,
      }].sort((x, y) => (x.name ?? "").localeCompare(y.name ?? ""));
    });
    qc.invalidateQueries({ queryKey: ["fertigation", "saved-products", vineyardId] });
    qc.invalidateQueries({ queryKey: ["saved-chemicals"] });
    setCreating(null);
    setManual(false);
  };
  const onSearchAdded = async ({ savedChemicalId }: { savedChemicalId: string | null }) => {
    if (!savedChemicalId || !vineyardId) return;
    const res = await fetchSavedChemicalsForVineyard(vineyardId);
    const row = res.chemicals.find((c) => c.id === savedChemicalId);
    if (row) onChemicalSaved(row as any);
  };
  const openAddChemical = () => {
    const idx = activeIndex != null && activeIndex < app.products.length ? activeIndex : null;
    // Only bind into the working row when it has no product yet.
    const target = idx != null && !app.products[idx].savedChemicalId ? idx : null;
    setCreating({ index: target, name: null });
  };

  const setLine = (i: number, patch: Partial<SprayProductLine>) =>
    update((a) => ({ ...a, products: a.products.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Fertigation products</h3>
        <p className="text-xs text-muted-foreground">
          Products and planned rates for this Program Step. The irrigation event decides the
          blocks, water and valve.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showAll} onCheckedChange={setShowAll} aria-label="Show all saved products" />
          Show all saved products
        </label>
        {canEdit && (
          <Button type="button" size="sm" variant="outline" onClick={openAddChemical}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Chemical
          </Button>
        )}
      </div>

      {app.products.map((l, i) => {
        const basis = l.fertigationRateBasis ?? null;
        return (
          <div
            key={i}
            className="space-y-3 rounded-md border p-3"
            data-testid="fertigation-line"
            onFocusCapture={() => setActiveIndex(i)}
            onPointerDownCapture={() => setActiveIndex(i)}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <Label>Product</Label>
                <Select
                  value={l.savedChemicalId ?? ""}
                  disabled={!canEdit}
                  onValueChange={(id) => {
                    const p = (products.data ?? []).find((x) => x.id === id);
                    setLine(i, {
                      savedChemicalId: id,
                      productName: p?.name ?? null,
                      productCategory: p?.product_category ?? null,
                      productForm: p?.product_form ?? null,
                    });
                  }}
                >
                  <SelectTrigger aria-label="Product">
                    <SelectValue placeholder={l.productName ?? "Choose a saved product"} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name ?? "Unnamed"} · {categoryLabel(p.product_category)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!l.savedChemicalId && l.productName && (
                  <p className="text-xs text-destructive">
                    {l.productName} is not linked to a Saved Chemical — choose it from the list.
                  </p>
                )}
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!canEdit}
                  aria-label="Remove product"
                  onClick={() => update((a) => ({ ...a, products: a.products.filter((_, j) => j !== i) }))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Rate basis</Label>
                <Select
                  value={basis ?? ""}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setLine(i, {
                      fertigationRateBasis: v as FertigationRateBasis,
                      fertigationRateUnit: FERTIGATION_RATE_UNITS[v as FertigationRateBasis].includes(
                        l.fertigationRateUnit ?? "",
                      )
                        ? l.fertigationRateUnit
                        : null,
                    })
                  }
                >
                  <SelectTrigger aria-label="Rate basis">
                    <SelectValue placeholder="Choose basis" />
                  </SelectTrigger>
                  <SelectContent>
                    {FERTIGATION_RATE_BASES.map((b) => (
                      <SelectItem key={b} value={b}>{FERTIGATION_RATE_BASIS_LABEL[b]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Planned rate</Label>
                <Input
                  inputMode="decimal"
                  aria-label="Planned rate"
                  disabled={!canEdit}
                  value={l.rate ?? ""}
                  onChange={(e) => {
                    const n = e.target.value === "" ? null : Number(e.target.value);
                    setLine(i, { rate: n != null && Number.isFinite(n) ? n : null });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Select
                  value={l.fertigationRateUnit ?? ""}
                  disabled={!canEdit || !basis}
                  onValueChange={(v) => setLine(i, { fertigationRateUnit: v })}
                >
                  <SelectTrigger aria-label="Rate unit">
                    <SelectValue placeholder={basis ? "Choose unit" : "Choose basis first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(basis ? FERTIGATION_RATE_UNITS[basis] : []).map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!basis && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Choose the Fertigation rate basis. Spray bases such as /100 L are not carried over.
              </p>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canEdit}
        onClick={() => update((a) => ({ ...a, products: [...a.products, blankLine()] }))}
      >
        <Plus className="mr-1 h-4 w-4" /> Add product
      </Button>

      {/* Add Chemical → the shared Chemical Search / Add Chemical workflow,
          nested so the Program Step draft is never saved or discarded. */}
      <ChemicalSearchDialog
        open={!!creating && !manual}
        onOpenChange={(o) => { if (!o) setCreating(null); }}
        vineyardId={vineyardId}
        vineyardName={vineyardName}
        country={currentCountry}
        canEdit={canEdit}
        initialQuery={creating?.name ?? null}
        onAdded={onSearchAdded}
        onManual={(name) => { setCreating((c) => ({ index: c?.index ?? null, name: name ?? c?.name ?? null })); setManual(true); }}
      />
      <ChemicalEditor
        manualOnly
        open={!!creating && manual}
        onOpenChange={(o) => { if (!o) { setCreating(null); setManual(false); } }}
        initial={null}
        initialName={creating?.name ?? null}
        vineyardId={vineyardId}
        existingLibrary={(products.data ?? []).map((p) => ({ id: p.id, name: p.name ?? "", active_ingredient: "" }))}
        canSeeCosts={canSeeCosts}
        onSaved={onChemicalSaved}
      />
    </div>
  );
}

export function FertigationReviewStep({ app }: StepProps) {
  const reasons = fertigationGateReasons({
    name: app.name,
    isTemplate: app.isTemplate,
    products: app.products,
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{app.name || "Untitled Program Step"}</h3>
        <Badge variant="secondary">Fertigation</Badge>
      </div>
      <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Growth stage</dt>
        <dd>{app.growthStageCode ?? "Not set"}</dd>
        <dt className="text-muted-foreground">Applied by</dt>
        <dd>Irrigation (Apply via Irrigation)</dd>
      </dl>
      <ul className="space-y-1 text-sm">
        {app.products.map((l, i) => (
          <li key={i}>
            <span className="font-medium">{l.productName ?? "Product not chosen"}</span>
            <span className="text-muted-foreground">
              {" "}— {fertigationRateText({ rate: l.rate, rateBasis: l.fertigationRateBasis ?? null, rateUnit: l.fertigationRateUnit ?? null })}
            </span>
          </li>
        ))}
      </ul>
      {app.notes?.trim() && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{app.notes}</p>}
      {reasons.length > 0 && (
        <PortalNotice variant="warning" title="Before saving" description={reasons.join(" ")} />
      )}
    </div>
  );
}
