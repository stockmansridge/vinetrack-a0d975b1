// Spray Program Phase 1 — readable Program Step detail.
//
// A Program Step is a `spray_jobs` row with `is_template = true`. This view is
// read-only: it never writes, never name-matches an unresolved product into a
// verified identity, and never touches spray history.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Pencil, Play } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import {
  VERIFICATION_LABEL, activityGroupSummary, toChemicalIntelligence,
  type ChemicalIntelligence,
} from "@/lib/chemicalIntelligence";
import type { SprayJob } from "@/lib/sprayJobsQuery";
import { sprayTargetLabel } from "@/lib/sprayTargetLibrary";
import { useVineyardSprayTargets } from "@/hooks/useVineyardSprayTargets";
import {
  chemicalLineRateText, growthStageDescription, programLines,
} from "@/lib/sprayProgramStep";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

export function ProgramStepDetailDialog({
  open, onOpenChange, job, vineyardId, canEdit, equipmentName, tractorName,
  onPlanSpray, onEdit, onArchive,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: SprayJob;
  vineyardId: string;
  canEdit: boolean;
  equipmentName?: string | null;
  tractorName?: string | null;
  onPlanSpray: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const { labels: targetLabels } = useVineyardSprayTargets(open ? vineyardId : null);

  const { data: chemResult } = useQuery({
    queryKey: ["saved-chemicals", vineyardId, "intelligence"],
    enabled: open && !!vineyardId,
    queryFn: () => fetchSavedChemicalsForVineyard(vineyardId),
  });

  const intelligenceById = useMemo(() => {
    const m = new Map<string, ChemicalIntelligence>();
    for (const row of chemResult?.chemicals ?? []) {
      const intel = toChemicalIntelligence(row as any);
      m.set(intel.id, intel);
    }
    return m;
  }, [chemResult]);

  const lines = programLines(job);
  const stage = job.growth_stage_code ?? null;
  const stageDesc = growthStageDescription(stage);
  const targets = (job.targets ?? []).length
    ? (job.targets as string[]).map((t) => sprayTargetLabel(t, targetLabels))
    : job.target
      ? job.target.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogDescription className="text-xs">
            {stage ? `${stage}${stageDesc ? ` — ${stageDesc}` : ""}` : "No growth stage set"}
          </DialogDescription>
          <DialogTitle className="text-xl">{job.name ?? "Untitled Program Step"}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-5">
            <Section title="Targets">
              {targets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No targets recorded.</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {targets.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </Section>

            <Section title="Products &amp; rates">
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No products on this Program Step.</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {lines.map((l, i) => {
                    const rate = chemicalLineRateText(l);
                    return (
                      <li key={i}>
                        <span className="font-medium">{l.name}</span>
                        {rate ? <span className="text-muted-foreground"> — {rate}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title="Application">
              <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted-foreground">Method</dt>
                <dd>{job.operation_type ?? "Not set"}</dd>
                <dt className="text-muted-foreground">Growth stage</dt>
                <dd>{stage ? `${stage}${stageDesc ? ` — ${stageDesc}` : ""}` : "Not set"}</dd>
                <dt className="text-muted-foreground">Spray unit</dt>
                <dd>{equipmentName ?? "Not set"}</dd>
                <dt className="text-muted-foreground">Tractor</dt>
                <dd>{tractorName ?? "Not set"}</dd>
              </dl>
            </Section>

            <Section title="Chemical information">
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No products on this Program Step.</p>
              ) : (
                <div className="space-y-2">
                  {lines.map((l, i) => {
                    const id = (l.savedChemicalId ?? l.chemical_id) as string | null;
                    const intel = id ? intelligenceById.get(id) ?? null : null;
                    if (!intel) {
                      return (
                        <div key={i} className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                          <div className="font-medium">{l.name}</div>
                          <div className="text-destructive">
                            {l.name} is not in your Chemical Store
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Edit this Program Step and use the Chemical Store search to replace
                            the product deliberately.
                          </p>
                        </div>
                      );
                    }
                    const actives =
                      intel.actives.map((a) => a.name).filter(Boolean).join(" + ") ||
                      intel.legacy.activeIngredient;
                    const groups = activityGroupSummary(intel);
                    return (
                      <div key={i} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{intel.name ?? l.name}</span>
                          <Badge variant="outline">{VERIFICATION_LABEL[intel.verification.status]}</Badge>
                          {groups && <Badge variant="secondary">{groups}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {actives ?? "Active ingredient not recorded"}
                          {intel.product.registrationNumber
                            ? ` · ${intel.product.registrationScheme ?? "Registration"} ${intel.product.registrationNumber}`
                            : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Notes">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {job.notes?.trim() ? job.notes : "No notes."}
              </p>
            </Section>
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <div>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={onArchive}>
                <Archive className="mr-1 h-4 w-4" /> Archive
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="mr-1 h-4 w-4" /> Edit Program Step
              </Button>
            )}
            <Button size="sm" onClick={onPlanSpray} disabled={!canEdit}>
              <Play className="mr-1 h-4 w-4" /> Plan Spray
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
