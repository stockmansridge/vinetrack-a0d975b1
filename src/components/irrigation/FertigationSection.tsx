// Fertigation section for irrigation (System Admin development gate).
// The irrigation record owns system/valve/date/water/blocks; this section owns
// the linked Program Step, planned products, planned quantity and actuals.
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { generateUuid } from "@/lib/uuid";
import { formatNumber, type IrrigationSession, type PreviewBlock } from "@/lib/irrigationQuery";
import type { SprayJob } from "@/lib/sprayJobsQuery";
import {
  buildFertigationPayload,
  draftProductsFromStep,
  fertigationRateText,
  plannedQuantity,
  servicedTotals,
  useFertigationProgramSteps,
  useSessionFertigation,
  useUpsertFertigation,
  type FertigationApplication,
  type FertigationDraftProduct,
  type ServicedTotals,
} from "@/lib/fertigation";

export const NO_FERTIGATION = "__none";

export function stepOptionLabel(s: Pick<SprayJob, "growth_stage_code" | "name">): string {
  return [s.growth_stage_code, s.name ?? "Untitled Program Step"].filter(Boolean).join(" · ");
}

export function FertigationEditor({
  steps, stepId, onStepId, products, onProducts, totals, notes, onNotes, totalsReady,
}: {
  steps: SprayJob[];
  stepId: string;
  onStepId: (id: string) => void;
  products: FertigationDraftProduct[];
  onProducts: (p: FertigationDraftProduct[]) => void;
  totals: ServicedTotals;
  totalsReady: boolean;
  notes: string;
  onNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Program Step</Label>
        <Select value={stepId} onValueChange={onStepId}>
          <SelectTrigger aria-label="Fertigation Program Step"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FERTIGATION}>No fertigation</SelectItem>
            {steps.map((s) => (
              <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {steps.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">No active Fertigation Program Steps in this vineyard.</p>
        )}
      </div>
      {stepId !== NO_FERTIGATION && (
        <>
          <div className="divide-y divide-border rounded-lg border">
            {products.map((p, i) => {
              const planned = plannedQuantity(p.line, totals);
              return (
                <div key={p.id} className="space-y-1 px-3 py-2" data-testid="fertigation-product">
                  <div className="text-sm font-medium">{p.line.productName ?? "Unnamed product"}</div>
                  <div className="text-xs text-muted-foreground">Planned rate: {fertigationRateText(p.line)}</div>
                  <div className="grid items-end gap-2 sm:grid-cols-2">
                    <div className="text-sm">
                      Planned:{" "}
                      <span className="font-semibold tabular-nums" data-testid="planned-quantity">
                        {!totalsReady
                          ? "Waiting for the irrigation calculation"
                          : planned.quantity == null
                            ? "Unable to calculate planned quantity"
                            : `${formatNumber(planned.quantity, 2)} ${planned.unit}`}
                      </span>
                    </div>
                    <div>
                      <Label className="text-xs">Actual used{planned.unit ? ` (${planned.unit})` : ""}</Label>
                      <Input
                        inputMode="decimal"
                        aria-label={`Actual used ${p.line.productName ?? ""}`}
                        value={p.actual}
                        onChange={(e) =>
                          onProducts(products.map((x, j) => (j === i ? { ...x, actual: e.target.value } : x)))
                        }
                      />
                      {p.actual.trim() === "" && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">Actual not entered</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <Label htmlFor="fert-notes">Fertigation notes</Label>
            <Textarea id="fert-notes" value={notes} onChange={(e) => onNotes(e.target.value)} />
          </div>
        </>
      )}
    </div>
  );
}

/** Controlled state for linking a Program Step; resets products when the step changes. */
export function useFertigationDraft(steps: SprayJob[], initialStepId: string | null, existing?: FertigationApplication | null) {
  const [stepId, setStepId] = useState<string>(initialStepId ?? NO_FERTIGATION);
  const [products, setProducts] = useState<FertigationDraftProduct[]>([]);
  const [notes, setNotes] = useState("");
  const appIdRef = useRef<string>(existing?.id ?? generateUuid());
  const step = steps.find((s) => s.id === stepId) ?? null;
  useEffect(() => {
    if (existing) {
      appIdRef.current = existing.id;
      setStepId(existing.program_step_id ?? NO_FERTIGATION);
      setNotes(existing.notes ?? "");
    }
  }, [existing]);
  useEffect(() => {
    setProducts(step ? draftProductsFromStep(step, existing) : []);
  }, [step, existing]);
  return { stepId, setStepId, products, setProducts, notes, setNotes, step, appId: appIdRef.current };
}

/** System Admin dialog to add / view / edit Fertigation on an existing session. */
export function SessionFertigationDialog({
  vineyardId, session, existing, onClose,
}: {
  vineyardId: string;
  session: IrrigationSession;
  existing: FertigationApplication | null;
  onClose: () => void;
}) {
  const steps = useFertigationProgramSteps(vineyardId, true);
  const list = steps.data ?? [];
  const d = useFertigationDraft(list, existing?.program_step_id ?? null, existing);
  const totals = useMemo(() => servicedTotals(session.blocks as PreviewBlock[]), [session.blocks]);
  const upsert = useUpsertFertigation();
  const save = async () => {
    if (!d.step) return;
    try {
      await upsert.mutateAsync(
        buildFertigationPayload({
          id: d.appId, vineyardId, sessionId: session.id, step: d.step,
          products: d.products, totals, notes: d.notes || null,
        }),
      );
      toast({ title: "Fertigation saved" });
      onClose();
    } catch (e) {
      toast({ title: "Couldn't save Fertigation", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "View / Edit Fertigation" : "Add Fertigation"}</DialogTitle>
          <DialogDescription>
            Link a Fertigation Program Step to this irrigation session and record what was used.
          </DialogDescription>
        </DialogHeader>
        <FertigationEditor
          steps={list} stepId={d.stepId} onStepId={d.setStepId}
          products={d.products} onProducts={d.setProducts}
          totals={totals} totalsReady notes={d.notes} onNotes={d.setNotes}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!d.step || upsert.isPending} onClick={save}>
            {upsert.isPending ? "Saving…" : "Save Fertigation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read-only summary shown on an irrigation session card (System Admin only). */
export function SessionFertigationSummary({ app }: { app: FertigationApplication }) {
  return (
    <div className="mt-3 rounded-lg border border-border p-3 text-sm" data-testid="session-fertigation">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Fertigation</Badge>
        <span className="font-medium">{app.program_step_name ?? "Program Step"}</span>
        {app.growth_stage_code && <span className="text-xs text-muted-foreground">{app.growth_stage_code}</span>}
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {app.products.map((p) => (
          <li key={p.id}>
            <span className="text-foreground">{p.product_name}</span> · {fertigationRateText({ rate: p.planned_rate, rateBasis: p.rate_basis, rateUnit: p.rate_unit })}
            {" · planned "}{p.planned_quantity == null ? "unknown" : `${formatNumber(p.planned_quantity, 2)} ${p.quantity_unit ?? ""}`}
            {" · actual "}{p.actual_quantity == null ? "not entered" : `${formatNumber(p.actual_quantity, 2)} ${p.quantity_unit ?? ""}`}
            {p.actual_quantity != null && (p.cost_per_unit != null && Number(p.cost_per_unit) > 0 ? ` · $${formatNumber(Number(p.cost_per_unit) * p.actual_quantity, 2)}` : " · Cost unavailable")}
          </li>
        ))}
      </ul>
      {app.notes && <p className="mt-1 text-xs">{app.notes}</p>}
    </div>
  );
}

export { useSessionFertigation };

export function FertigationCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Fertigation <Badge variant="outline">System Admin · in development</Badge>
        </CardTitle>
        <CardDescription>Optionally link a Fertigation Program Step to this irrigation.</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
