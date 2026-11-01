import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { asList, labelOf } from "@/lib/chemicalV3";
import { buildIngredients, ingredientDrafts, saveAndConfirmV3Ingredients, V3_INGREDIENT_SAVING_ENABLED, type IngredientDraft } from "@/lib/chemicalV3Ingredients";

export function V3IngredientsField({ revisionId, value, editable, approvalBusy, onApprovalBlocked }: {
  revisionId: string; value: unknown; editable: boolean; approvalBusy: boolean;
  onApprovalBlocked: (blocked: boolean) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<IngredientDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => { onApprovalBlocked(editing || uncertain); }, [editing, uncertain, onApprovalBlocked]);
  const mut = useMutation({
    mutationFn: async () => {
      if (!V3_INGREDIENT_SAVING_ENABLED) throw new Error("Ingredient saving is awaiting shared-backend deployment and verification.");
      setUncertain(true);
      return saveAndConfirmV3Ingredients(revisionId, drafts);
    },
    onSuccess: async (revision) => {
      qc.setQueryData(["chemical-v3-revision", revisionId], revision);
      await Promise.all(["chemical-v3-issues", "chemical-v3-queue", "chemical-v3-approved"].map((key) =>
        qc.invalidateQueries({ queryKey: key === "chemical-v3-issues" ? [key, revisionId] : [key] })));
      setUncertain(false); setEditing(false); setError(null); setConfirmed(true);
    },
    onError: (e: Error) => setError(e.message),
  });
  const update = (index: number, key: "name" | "concentration" | "unit", text: string) => {
    setDrafts((rows) => rows.map((row, i) => i === index ? { ...row, [key]: text } : row));
    setError(null);
  };
  const busy = approvalBusy || mut.isPending;
  return (
    <section className="space-y-2 rounded border bg-card p-2 text-sm sm:col-span-2" aria-label="Active ingredients">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="font-medium">Active ingredients</h3>
          <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="h-6 w-6" aria-label="About ingredient corrections"><Info className="h-3.5 w-3.5" /></Button></TooltipTrigger>
            <TooltipContent className="max-w-xs">Enter the manufacturer label values without conversion. Only revisions awaiting approval can be corrected. Saved ingredients must be reloaded and confirmed before approval.</TooltipContent>
          </Tooltip>
        </div>
        {editable && !editing && <Button size="sm" variant="outline" disabled={busy} onClick={() => {
          const rows = ingredientDrafts(value);
          setDrafts(rows.length ? rows : [{ name: "", concentration: "", unit: "", original: {} }]);
          setEditing(true); setConfirmed(false); setError(null);
        }}>{asList(value).length ? "Edit ingredients" : "Add ingredients"}</Button>}
      </div>
      {!editing && <p className={asList(value).length ? "font-medium" : "text-destructive"}>{asList(value).length ? asList(value).map(labelOf).join("; ") : "Missing"}</p>}
      {editable && !V3_INGREDIENT_SAVING_ENABLED && <p className="text-xs text-warning">Ingredient saving pending backend deployment and verification.</p>}
      {editing && editable && <div className="space-y-2">
        {drafts.map((d, index) => <div key={index} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="min-w-0 text-xs">Active ingredient name<Input aria-label={`Ingredient ${index + 1} name`} value={d.name} disabled={busy} onChange={(e) => update(index, "name", e.target.value)} /></label>
          <label className="min-w-0 text-xs">Concentration<Input aria-label={`Ingredient ${index + 1} concentration`} type="number" step="any" value={d.concentration} disabled={busy} onChange={(e) => update(index, "concentration", e.target.value)} /></label>
          <label className="min-w-0 text-xs">Concentration unit<Input aria-label={`Ingredient ${index + 1} unit`} placeholder="g/L, g/kg…" value={d.unit} disabled={busy} onChange={(e) => update(index, "unit", e.target.value)} /></label>
          <Button size="icon" variant="ghost" disabled={busy} aria-label={`Remove ingredient ${index + 1}`} title="Remove ingredient" onClick={() => setDrafts((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setDrafts((rows) => [...rows, { name: "", concentration: "", unit: "", original: {} }])}><Plus className="mr-1 h-4 w-4" />Add ingredient</Button>
          <Button size="sm" disabled={busy || !V3_INGREDIENT_SAVING_ENABLED} onClick={() => {
            try { buildIngredients(drafts); setError(null); mut.mutate(); } catch (e) { setError(e instanceof Error ? e.message : "Check ingredient values."); }
          }}>{mut.isPending ? "Saving…" : "Save Ingredients"}</Button>
          <Button size="sm" variant="ghost" disabled={busy || uncertain} onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
        </div>
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {confirmed && <p role="status" className="text-xs text-success">Ingredients saved and confirmed.</p>}
    </section>
  );
}