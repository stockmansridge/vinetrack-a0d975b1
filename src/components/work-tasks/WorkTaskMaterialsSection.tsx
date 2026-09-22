// Material Costs on a Work Task (Phase 3, Portal).
//
// Compact cost lines — not an inventory table. Each saved line is a frozen
// snapshot on work_task_materials; later library changes never alter it.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  decimalToNumber,
  groupMaterialsByCategory,
  isPositiveDecimal,
  materialLineSummary,
  materialTotalForTask,
  multiplyDecimals,
  normaliseDecimalInput,
  searchMaterials,
  selectableMaterials,
  type EffectiveMaterial,
  type WorkTaskMaterial,
} from "@/lib/materialCosts";
import {
  addWorkTaskMaterial,
  describeMaterialError,
  materialQueryKeys,
  removeWorkTaskMaterial,
  updateWorkTaskMaterial,
  useEffectiveMaterials,
} from "@/lib/materialsQuery";

interface Props {
  vineyardId: string | null;
  workTaskId: string | null;
  lines: WorkTaskMaterial[];
  canSeeCosts: boolean;
  money: (n: number) => string;
  /** Existing drawer convention: refetch task-scoped data after a write. */
  onChanged?: () => void;
  readOnly?: boolean;
}

interface EditorState {
  /** Existing line being edited, when any. */
  line: WorkTaskMaterial | null;
  material: EffectiveMaterial | null;
  quantity: string;
  unit: string;
  unitCost: string;
}

export function WorkTaskMaterialsSection({
  vineyardId,
  workTaskId,
  lines,
  canSeeCosts,
  money,
  onChanged,
  readOnly,
}: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<WorkTaskMaterial | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const { materials, isLoading, error } = useEffectiveMaterials(vineyardId, selectorOpen);
  const active = useMemo(() => lines.filter((l) => !l.deleted_at), [lines]);
  const materialTotal = materialTotalForTask(active);

  const groups = useMemo(() => {
    const pool = searchMaterials(selectableMaterials(materials), search);
    const grouped = groupMaterialsByCategory(pool);
    return category === "all" ? grouped : grouped.filter((g) => g.category === category);
  }, [materials, search, category]);
  const allCategories = useMemo(
    () => groupMaterialsByCategory(selectableMaterials(materials)).map((g) => g.category),
    [materials],
  );

  const invalidate = () => {
    if (vineyardId) {
      qc.invalidateQueries({ queryKey: materialQueryKeys.workTaskMaterials(vineyardId) });
    }
    onChanged?.();
  };

  const openNew = (material: EffectiveMaterial) => {
    setSelectorOpen(false);
    setEditor({
      line: null,
      material,
      quantity: "",
      unit: material.unit,
      unitCost: material.defaultUnitCost ?? "",
    });
  };

  const openEdit = (line: WorkTaskMaterial) => {
    setEditor({
      line,
      material: null,
      quantity: normaliseDecimalInput(line.quantity) ?? "",
      unit: String(line.unit ?? ""),
      unitCost: normaliseDecimalInput(line.unit_cost) ?? "",
    });
  };

  const liveTotal = editor ? multiplyDecimals(editor.quantity, editor.unitCost) : null;

  const save = async () => {
    if (!editor || saving) return;
    if (!vineyardId || !workTaskId) return;
    if (!isPositiveDecimal(editor.quantity)) {
      toast({ title: "Enter a quantity greater than zero", variant: "destructive" });
      return;
    }
    if (!editor.unit.trim()) {
      toast({ title: "Enter a unit", variant: "destructive" });
      return;
    }
    const unitCost = normaliseDecimalInput(editor.unitCost) ?? "0";
    setSaving(true);
    try {
      if (editor.line) {
        await updateWorkTaskMaterial({
          vineyardId,
          id: editor.line.id,
          unit: editor.unit.trim(),
          quantity: normaliseDecimalInput(editor.quantity)!,
          unitCost,
          userId: user?.id ?? null,
        });
      } else if (editor.material) {
        await addWorkTaskMaterial({
          vineyardId,
          workTaskId,
          vineyardMaterialId: editor.material.vineyardMaterialId,
          materialName: editor.material.name,
          category: editor.material.category,
          unit: editor.unit.trim(),
          quantity: normaliseDecimalInput(editor.quantity)!,
          unitCost,
          userId: user?.id ?? null,
        });
      }
      setEditor(null);
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

  const confirmRemove = async () => {
    if (!removing || !vineyardId || removeBusy) return;
    setRemoveBusy(true);
    try {
      await removeWorkTaskMaterial(vineyardId, removing.id, user?.id ?? null);
      setRemoving(null);
      invalidate();
      toast({ title: "Material removed" });
    } catch (err) {
      toast({
        title: "Could not remove material",
        description: describeMaterialError(err, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="work-task-materials">
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No materials added</p>
      ) : (
        <div className="space-y-1.5">
          {active.map((line) => {
            const total = decimalToNumber(
              line.total_cost ?? multiplyDecimals(line.quantity, line.unit_cost),
            );
            return (
              <div
                key={line.id}
                className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{line.material_name || "Material"}</div>
                  <div className="text-xs text-muted-foreground">
                    {materialLineSummary(line, money)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canSeeCosts && (
                    <span className="tabular-nums font-medium">
                      {total == null ? "—" : money(total)}
                    </span>
                  )}
                  {!readOnly && (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Edit ${line.material_name ?? "material"}`}
                        onClick={() => openEdit(line)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Remove ${line.material_name ?? "material"}`}
                        onClick={() => setRemoving(line)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {canSeeCosts && (
            <>
              <Separator className="my-1" />
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>Material Total</span>
                <span className="tabular-nums" data-testid="material-total">
                  {money(decimalToNumber(materialTotal) ?? 0)}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {!readOnly && (
        <div>
          {workTaskId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelectorOpen(true)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Material
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Save the work task first, then add materials.
            </p>
          )}
        </div>
      )}

      {/* Material selector: merged standard catalogue + vineyard materials. */}
      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Material</DialogTitle>
            <DialogDescription>
              Standard VineTrack materials plus this vineyard's own materials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              placeholder="Search materials"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search materials"
            />
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant={category === "all" ? "secondary" : "ghost"}
                onClick={() => setCategory("all")}
              >
                All
              </Button>
              {allCategories.map((c) => (
                <Button
                  key={c}
                  type="button"
                  size="sm"
                  variant={category === c ? "secondary" : "ghost"}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </Button>
              ))}
            </div>
            <div className="max-h-[50vh] overflow-y-auto pr-1">
              {isLoading ? (
                <p className="py-4 text-sm text-muted-foreground">Loading materials…</p>
              ) : error ? (
                <p className="py-4 text-sm text-destructive">
                  {describeMaterialError(error, "Could not load materials. Please try again.")}
                </p>
              ) : groups.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No materials found.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.category} className="mb-3">
                    <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      {group.category}
                    </div>
                    <div className="space-y-1">
                      {group.materials.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => openNew(m)}
                          className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          <span className="min-w-0 truncate">
                            {m.name}
                            {m.isCustom && (
                              <span className="ml-2 text-xs text-muted-foreground">Custom</span>
                            )}
                          </span>
                          <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                            {m.unit}
                            {m.defaultUnitCost
                              ? ` · ${money(decimalToNumber(m.defaultUnitCost) ?? 0)}`
                              : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Material editor: quantity / unit / task-specific unit cost. */}
      <Dialog open={!!editor} onOpenChange={(o) => !o && !saving && setEditor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editor?.line ? "Edit material" : editor?.material?.name || "Material"}
            </DialogTitle>
            <DialogDescription>
              {editor?.line
                ? editor.line.material_name || "Material"
                : "Quantity and cost are saved with this task only."}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="mat-qty">Quantity</Label>
                  <Input
                    id="mat-qty"
                    inputMode="decimal"
                    value={editor.quantity}
                    onChange={(e) => setEditor({ ...editor, quantity: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mat-unit">Unit</Label>
                  <Input
                    id="mat-unit"
                    value={editor.unit}
                    onChange={(e) => setEditor({ ...editor, unit: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mat-cost">Unit cost</Label>
                <Input
                  id="mat-cost"
                  inputMode="decimal"
                  value={editor.unitCost}
                  onChange={(e) => setEditor({ ...editor, unitCost: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Changing this affects this task only — the Material Library default stays the
                  same.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                <span>Line total</span>
                <span className="tabular-nums font-medium" data-testid="material-line-total">
                  {liveTotal == null ? "—" : money(decimalToNumber(liveTotal) ?? 0)}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditor(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save material"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && !removeBusy && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove material?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.material_name || "This material"} will be removed from this task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRemove();
              }}
              disabled={removeBusy}
            >
              {removeBusy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default WorkTaskMaterialsSection;
