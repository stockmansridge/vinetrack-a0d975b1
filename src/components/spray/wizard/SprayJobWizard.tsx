// Stage 3B — guided Spray Job create/edit workflow.
//
// The wizard owns one canonical `SprayApplication` draft. Every number shown
// comes from the Stage 3A geometry + calculation engines; no spray maths lives
// in this file or in any step component.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  emptySprayApplication,
  normaliseCarrierBasisPreference,
  type SprayApplication,
} from "@/lib/sprayApplicationDomain";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import { evaluateSaveGate, hydrateDraft } from "@/lib/sprayApplicationDraft";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import {
  createSprayJob,
  fetchSprayJobPaddockIds,
  updateSprayJob,
  type SprayJob,
} from "@/lib/sprayJobsQuery";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { toChemicalIntelligence, type ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { supabase } from "@/integrations/ios-supabase/client";
import { ApplicationStep } from "./ApplicationStep";
import { BlocksStep } from "./BlocksStep";
import { TargetStep } from "./TargetStep";
import { GrowthStageStep } from "./GrowthStageStep";
import { EquipmentStep } from "./EquipmentStep";
import { CarrierStep } from "./CarrierStep";
import { ProductsStep } from "./ProductsStep";
import { ResistanceStep } from "./ResistanceStep";
import { ResistanceAcknowledgement } from "./ResistanceAcknowledgement";
import { useResistanceAssessment } from "@/hooks/useResistanceAssessment";
import { ReviewStep } from "./ReviewStep";
import type { StepProps, WizardLookups } from "./types";

const STEPS = [
  { key: "application", label: "Application" },
  { key: "blocks", label: "Blocks" },
  { key: "target", label: "Target" },
  { key: "growth", label: "Growth stage" },
  { key: "equipment", label: "Equipment" },
  { key: "carrier", label: "Carrier" },
  { key: "products", label: "Products" },
  { key: "resistance", label: "Resistance check" },
  { key: "review", label: "Review" },
] as const;

/**
 * Optional vineyard-level default for the carrier volume basis. The column is
 * not present in every deployment, so a failure here is treated as "no
 * preference" rather than an error.
 */
async function fetchCarrierBasisPreference(vineyardId: string): Promise<string | null> {
  const res = await (supabase as any)
    .from("vineyards")
    .select("spray_carrier_volume_basis")
    .eq("id", vineyardId)
    .maybeSingle();
  if (res.error) return null;
  return (res.data?.spray_carrier_volume_basis as string | null) ?? null;
}

export function SprayJobWizard({
  open,
  onOpenChange,
  vineyardId,
  job,
  isTemplate,
  canEdit,
  lookups,
  linkedRecords,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  job: SprayJob | null;
  isTemplate: boolean;
  canEdit: boolean;
  lookups: WizardLookups;
  /** Rendered at the bottom of Review for saved, non-template jobs. */
  linkedRecords?: ReactNode;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const editing = !!job;

  const [step, setStep] = useState(0);
  const [app, setApp] = useState<SprayApplication>(() => {
    const base = emptySprayApplication();
    base.vineyardId = vineyardId;
    base.isTemplate = isTemplate;
    return base;
  });
  const [hydrated, setHydrated] = useState(false);

  const { data: chemicalsResult } = useQuery({
    queryKey: ["saved-chemicals", vineyardId, "intelligence"],
    enabled: open && !!vineyardId,
    queryFn: () => fetchSavedChemicalsForVineyard(vineyardId),
  });

  const intelligenceById = useMemo(() => {
    const map = new Map<string, ChemicalIntelligence>();
    for (const row of chemicalsResult?.chemicals ?? []) {
      const intel = toChemicalIntelligence(row as any);
      map.set(intel.id, intel);
    }
    return map;
  }, [chemicalsResult]);

  const { data: paddockIds } = useQuery({
    queryKey: ["spray_job_paddocks", job?.id],
    enabled: open && !!job?.id,
    queryFn: () => fetchSprayJobPaddockIds(job!.id),
  });

  const { data: carrierPreference } = useQuery({
    queryKey: ["vineyard-carrier-basis", vineyardId],
    enabled: open && !!vineyardId,
    queryFn: () => fetchCarrierBasisPreference(vineyardId),
  });

  // Hydrate once per open, after the data the draft depends on has arrived.
  useEffect(() => {
    if (!open) {
      setHydrated(false);
      setStep(0);
      return;
    }
    if (hydrated) return;
    if (job?.id && paddockIds === undefined) return;
    if (chemicalsResult === undefined) return;

    const draft = hydrateDraft({
      vineyardId,
      job,
      isTemplate: job ? !!job.is_template : isTemplate,
      paddockIds: paddockIds ?? [],
      intelligenceById,
    });

    if (!job) {
      const pref = normaliseCarrierBasisPreference(carrierPreference);
      if (pref && pref !== "either") draft.carrier = { ...draft.carrier, basis: pref };
    }
    setApp(draft);
    setHydrated(true);
  }, [open, hydrated, job, paddockIds, chemicalsResult, intelligenceById, carrierPreference, vineyardId, isTemplate]);

  const geometry = useMemo(
    () =>
      resolveApplicationGeometry({
        paddocks: lookups.paddocks,
        blockIds: app.isTemplate ? [] : app.blockIds,
        mode: app.mode,
        override: app.geometryOverride,
        totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
      }),
    [lookups.paddocks, app.isTemplate, app.blockIds, app.mode, app.geometryOverride, app.totalTreatedBandWidthMetres],
  );

  const calc = useMemo(
    () => calculateSprayApplication({ application: app, geometry }),
    [app, geometry],
  );

  const gate = useMemo(
    () => evaluateSaveGate({ application: app, calculation: calc }),
    [app, calc],
  );

  // The verdict is recomputed here from CURRENT history and the ruleset in
  // force; it is never read back from the saved job.
  const resistance = useResistanceAssessment({
    enabled: open && hydrated && !app.isTemplate,
    vineyardId,
    application: app,
    intelligenceById,
    blocks: (lookups.paddocks ?? []).map((p: any) => ({ id: p.id, name: p.name })),
  });
  const [resistanceAck, setResistanceAck] = useState(false);
  useEffect(() => {
    setResistanceAck(false);
  }, [resistance.overallStatus]);
  const resistanceBlocksSave = resistance.requiresAcknowledgement && !resistanceAck;

  const patch = (p: Partial<SprayApplication>) => setApp((a) => ({ ...a, ...p }));
  const update = (fn: (a: SprayApplication) => SprayApplication) => setApp(fn);

  const saveMut = useMutation({
    mutationFn: async () => {
      const { input, paddockIds: blocks } = toSprayJobInput({
        application: { ...app, vineyardId },
        geometry,
        calculation: calc,
      });
      if (editing) return updateSprayJob(job!.id, input, blocks);
      return createSprayJob(input, blocks);
    },
    onSuccess: () => {
      toast({ title: editing ? "Saved" : app.isTemplate ? "Template created" : "Spray job created" });
      qc.invalidateQueries({ queryKey: ["spray_jobs"] });
      qc.invalidateQueries({ queryKey: ["spray_job_paddocks"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const stepProps: StepProps = {
    app,
    patch,
    update,
    geometry,
    calc,
    lookups,
    intelligenceById,
    vineyardId,
    canEdit,
  };

  const visibleSteps = STEPS.filter(
    (s) => !(s.key === "carrier" && app.operationType === "spreader" && app.mode !== "banded"),
  );
  const current = visibleSteps[Math.min(step, visibleSteps.length - 1)];

  const renderStep = () => {
    switch (current.key) {
      case "application": return <ApplicationStep {...stepProps} />;
      case "blocks": return <BlocksStep {...stepProps} />;
      case "target": return <TargetStep {...stepProps} />;
      case "growth": return <GrowthStageStep {...stepProps} />;
      case "equipment": return <EquipmentStep {...stepProps} />;
      case "carrier": return <CarrierStep {...stepProps} />;
      case "products": return <ProductsStep {...stepProps} />;
      case "resistance": return <ResistanceStep {...stepProps} />;
      case "review":
        return (
          <ReviewStep
            {...stepProps}
            extra={editing && !app.isTemplate ? linkedRecords : null}
            resistance={
              <ResistanceAcknowledgement
                status={resistance.overallStatus}
                lines={resistance.blocks.flatMap((b) =>
                  b.evaluations.map((e) => `${b.blockName}: ${e.summary}`),
                )}
                requiresAcknowledgement={resistance.requiresAcknowledgement}
                acknowledged={resistanceAck}
                onAcknowledgedChange={setResistanceAck}
                disabled={!canEdit}
              />
            }
          />
        );
      default: return null;
    }
  };

  const isLast = step >= visibleSteps.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {editing ? "Edit" : "New"} {app.isTemplate ? "spray template" : "spray application"}
            {!canEdit && <Badge variant="outline">View only</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex gap-1 overflow-x-auto border-b p-2 md:w-56 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
            {visibleSteps.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition",
                  i === step ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                <span className="mr-2 text-xs opacity-70">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </nav>

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-4">
              {!hydrated ? (
                <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading application…
                </div>
              ) : (
                renderStep()
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="space-y-2 border-t p-3">
          {gate.canSave && resistanceBlocksSave && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>
                The resistance check needs acknowledging on the Review step before this
                application can be saved.
              </span>
            </div>
          )}
          {!gate.canSave && gate.blockingReasons.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>{gate.blockingReasons.join(" ")}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLast}
                onClick={() => setStep((s) => Math.min(visibleSteps.length - 1, s + 1))}
              >
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {gate.warnings.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {gate.warnings.length} check{gate.warnings.length === 1 ? "" : "s"} to review
                </span>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canEdit || !gate.canSave || resistanceBlocksSave || saveMut.isPending}
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : app.isTemplate ? "Create template" : "Create job"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
