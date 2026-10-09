import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  buildChemicalsCsv, buildChemicalsTemplateCsv, planChemicalImport, type ChemicalImportPlan,
} from "@/lib/chemicalImportExport";
import {
  createSavedChemical, updateSavedChemical, type SavedChemical,
} from "@/lib/savedChemicalsQuery";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function ChemicalImportExport({ vineyardId, chemicals, canImport }: {
  vineyardId: string; chemicals: SavedChemical[]; canImport: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ChemicalImportPlan | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const stamp = new Date().toISOString().slice(0, 10);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const p = planChemicalImport(await f.text(), chemicals);
    setPlan(p);
    setPicked(new Set(p.rows.filter((r) => r.action !== "unchanged").map((r) => r.line)));
    if (fileRef.current) fileRef.current.value = "";
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    let created = 0, updated = 0;
    const failed: string[] = [];
    for (const r of plan.rows) {
      if (!picked.has(r.line) || r.action === "unchanged") continue;
      try {
        if (r.action === "create") { await createSavedChemical(vineyardId, r.input); created++; }
        else { await updateSavedChemical(r.id!, r.input); updated++; }
      } catch (e) {
        failed.push(`Row ${r.line} (${r.name}): ${(e as Error).message}`);
      }
    }
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ["saved_chemicals", vineyardId] });
    toast({
      title: `Import finished: ${created} added, ${updated} updated`,
      description: failed.length ? `${failed.length} failed. ${failed.slice(0, 3).join(" · ")}` : undefined,
      variant: failed.length ? "destructive" : undefined,
    });
    if (!failed.length) setPlan(null);
  };

  const actionable = plan?.rows.filter((r) => r.action !== "unchanged") ?? [];
  const toggle = (line: number, on: boolean) =>
    setPicked((s) => { const n = new Set(s); on ? n.add(line) : n.delete(line); return n; });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => download(`chemicals-${stamp}.csv`, buildChemicalsCsv(chemicals))} disabled={!chemicals.length}>
          <Download className="mr-1 h-4 w-4" />Export CSV
        </Button>
        {canImport && (
          <>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />Import CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => download("chemicals-template.csv", buildChemicalsTemplateCsv())}>
              <FileDown className="mr-1 h-4 w-4" />Template
            </Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </>
        )}
      </div>

      <Dialog open={!!plan} onOpenChange={(o) => !o && !busy && setPlan(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review chemical import</DialogTitle>
            <DialogDescription>
              Tick the rows to save. Blank cells keep current values. Nothing is deleted, and prices, stock and default rates are not changed.
            </DialogDescription>
          </DialogHeader>
          {plan && (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {plan.errors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <div className="font-medium">{plan.errors.length} row(s) will be skipped</div>
                  <ul className="mt-1 list-disc pl-5">{plan.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              {plan.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No valid rows found.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {plan.rows.map((r) => (
                    <li key={r.line} className="flex items-start gap-3 p-2 text-sm">
                      <Checkbox
                        checked={picked.has(r.line)} disabled={r.action === "unchanged"}
                        onCheckedChange={(v) => toggle(r.line, v === true)} aria-label={`Include ${r.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{r.name}</div>
                        {r.action === "update" && <div className="text-xs text-muted-foreground">Changes: {r.changes.join(", ")}</div>}
                      </div>
                      <Badge variant={r.action === "create" ? "default" : r.action === "update" ? "secondary" : "outline"}>
                        {r.action === "create" ? "New" : r.action === "update" ? "Update" : "No change"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlan(null)} disabled={busy}>Cancel</Button>
            <Button onClick={apply} disabled={busy || !actionable.some((r) => picked.has(r.line))}>
              {busy ? "Importing…" : `Import ${actionable.filter((r) => picked.has(r.line)).length} row(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
