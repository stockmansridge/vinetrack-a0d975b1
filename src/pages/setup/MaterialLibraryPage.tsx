// Material Library (Phase 3, Portal) — System Admin only for now.
//
// Shows ONE logical row per material: the standard VineTrack catalogue merged
// with this vineyard's override, followed by this vineyard's custom materials.
// Standard items cannot be renamed or deleted; a vineyard may set its own unit
// and default unit cost, saved as a vineyard_materials override.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import { useMaterialCostsEnabled } from "@/lib/materialCostsAccess";
import {
  customMaterialCategories,
  decimalToNumber,
  groupMaterialsByCategory,
  materialUnitOptions,
  normaliseDecimalInput,
  searchMaterials,
  type EffectiveMaterial,
} from "@/lib/materialCosts";
import {
  describeMaterialError,
  materialQueryKeys,
  saveCustomMaterial,
  saveVineyardMaterialOverride,
  setCustomMaterialActive,
  useEffectiveMaterials,
} from "@/lib/materialsQuery";

interface EditState {
  row: EffectiveMaterial | null;
  isNewCustom: boolean;
  name: string;
  category: string;
  unit: string;
  defaultUnitCost: string;
}

export default function MaterialLibraryPage() {
  const { selectedVineyardId } = useVineyard();
  const { user } = useAuth();
  const qc = useQueryClient();
  const rf = useRegionFormatters();
  const money = (n: number) => rf.currency(n);
  const { enabled, loading: gateLoading } = useMaterialCostsEnabled();
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const { materials, catalogue, isLoading, error } = useEffectiveMaterials(
    selectedVineyardId,
    enabled,
  );

  const standard = useMemo(
    () => groupMaterialsByCategory(searchMaterials(materials.filter((m) => !m.isCustom), search)),
    [materials, search],
  );
  const custom = useMemo(
    () => searchMaterials(materials.filter((m) => m.isCustom), search),
    [materials, search],
  );
  const categories = useMemo(() => customMaterialCategories(catalogue), [catalogue]);

  if (gateLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!enabled) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This page is not available for your account.
      </div>
    );
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: materialQueryKeys.vineyardMaterials(selectedVineyardId) });
    qc.invalidateQueries({ queryKey: materialQueryKeys.catalogue });
  };

  const openStandard = (row: EffectiveMaterial) =>
    setEdit({
      row,
      isNewCustom: false,
      name: row.name,
      category: row.category,
      unit: row.unit,
      defaultUnitCost: row.defaultUnitCost ?? "",
    });

  const openCustom = (row: EffectiveMaterial | null) =>
    setEdit({
      row,
      isNewCustom: !row,
      name: row?.name ?? "",
      category: row?.category ?? categories[0] ?? "Other",
      unit: row?.unit ?? "Each",
      defaultUnitCost: row?.defaultUnitCost ?? "",
    });

  const save = async () => {
    if (!edit || saving || !selectedVineyardId) return;
    const isCustom = edit.isNewCustom || !!edit.row?.isCustom;
    if (isCustom && !edit.name.trim()) {
      toast({ title: "Enter a material name", variant: "destructive" });
      return;
    }
    if (!edit.unit.trim()) {
      toast({ title: "Enter a unit", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isCustom) {
        await saveCustomMaterial({
          vineyardId: selectedVineyardId,
          id: edit.row?.vineyardMaterialId ?? null,
          name: edit.name,
          category: edit.category,
          unit: edit.unit,
          defaultUnitCost: normaliseDecimalInput(edit.defaultUnitCost),
          userId: user?.id ?? null,
        });
      } else if (edit.row?.catalogueId) {
        await saveVineyardMaterialOverride({
          vineyardId: selectedVineyardId,
          baseMaterialId: edit.row.catalogueId,
          name: edit.row.name,
          category: edit.row.category,
          unit: edit.unit,
          defaultUnitCost: normaliseDecimalInput(edit.defaultUnitCost),
          vineyardMaterialId: edit.row.vineyardMaterialId,
          userId: user?.id ?? null,
        });
      }
      setEdit(null);
      invalidate();
      toast({ title: "Material saved" });
    } catch (err) {
      toast({
        title: "Could not save material",
        description: describeMaterialError(err, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: EffectiveMaterial) => {
    if (!selectedVineyardId || !row.vineyardMaterialId) return;
    try {
      await setCustomMaterialActive(
        selectedVineyardId,
        row.vineyardMaterialId,
        !row.isActive,
        user?.id ?? null,
      );
      invalidate();
      toast({ title: row.isActive ? "Material deactivated" : "Material reactivated" });
    } catch (err) {
      toast({
        title: "Could not update material",
        description: describeMaterialError(err, "Please try again."),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6" data-testid="material-library">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Material Library</h1>
          <p className="text-sm text-muted-foreground">
            Standard VineTrack materials and this vineyard's own materials, used when adding
            materials to a Work Task.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => openCustom(null)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Custom Material
        </Button>
      </div>

      <Input
        placeholder="Search materials"
        aria-label="Search materials"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {!selectedVineyardId ? (
        <p className="text-sm text-muted-foreground">Select a vineyard to see its materials.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading materials…</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          {describeMaterialError(error, "Could not load materials. Please try again.")}
        </p>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-4">
              <h2 className="text-sm font-semibold">Standard materials</h2>
              {standard.length === 0 ? (
                <p className="text-sm text-muted-foreground">No materials found.</p>
              ) : (
                standard.map((group) => (
                  <div key={group.category} className="space-y-1">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">
                      {group.category}
                    </div>
                    {group.materials.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => openStandard(row)}
                        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="min-w-0 truncate">{row.name}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {row.unit}
                          {" · "}
                          {row.defaultUnitCost
                            ? money(decimalToNumber(row.defaultUnitCost) ?? 0)
                            : "No default price"}
                          {row.hasVineyardOverride && (
                            <Badge variant="secondary" className="ml-2">
                              Vineyard
                            </Badge>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-4">
              <h2 className="text-sm font-semibold">Vineyard materials</h2>
              {custom.length === 0 ? (
                <p className="text-sm text-muted-foreground">No custom materials yet.</p>
              ) : (
                custom.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {row.name}
                        {!row.isActive && (
                          <Badge variant="outline" className="ml-2">
                            Deactivated
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.category} · {row.unit} ·{" "}
                        {row.defaultUnitCost
                          ? money(decimalToNumber(row.defaultUnitCost) ?? 0)
                          : "No default price"}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => openCustom(row)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggleActive(row)}
                      >
                        {row.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && !saving && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {edit?.isNewCustom ? "Add Custom Material" : edit?.name || "Material"}
            </DialogTitle>
            <DialogDescription>
              {edit && !edit.isNewCustom && !edit.row?.isCustom
                ? "Standard material. You can set this vineyard's unit and default price."
                : "This material belongs to the selected vineyard only."}
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              {(edit.isNewCustom || edit.row?.isCustom) && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="lib-name">Name</Label>
                    <Input
                      id="lib-name"
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lib-cat">Category</Label>
                    <select
                      id="lib-cat"
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      value={edit.category}
                      onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label htmlFor="lib-unit">Unit</Label>
                <select
                  id="lib-unit"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={edit.unit}
                  onChange={(e) => setEdit({ ...edit, unit: e.target.value })}
                >
                  {materialUnitOptions(edit.unit).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="lib-cost">Default unit cost</Label>
                <Input
                  id="lib-cost"
                  inputMode="decimal"
                  value={edit.defaultUnitCost}
                  onChange={(e) => setEdit({ ...edit, defaultUnitCost: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Used to pre-fill new Work Task material lines. Existing tasks keep the price they
                  were saved with.
                </p>
              </div>
              <Separator />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEdit(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
