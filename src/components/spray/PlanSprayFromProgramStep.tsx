// Program Step → Plan Spray.
//
// Opens the standard guided wizard as a NEW Planned Spray, prefilled from the
// Program Step. No `spray_jobs` row is written when the user clicks Plan Spray:
// the row only exists once the wizard's Save succeeds. The Program Step itself
// is never mutated by this flow.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSavedChemicalsForVineyard } from "@/lib/savedChemicalsQuery";
import { toChemicalIntelligence, type ChemicalIntelligence } from "@/lib/chemicalIntelligence";
import { hydrateDraft } from "@/lib/sprayApplicationDraft";
import { planSprayPrefillFromProgramStep } from "@/lib/sprayProgramStep";
import { withPreferredRateFallback } from "@/lib/vineyardPreferredRate";
import type { SprayJob } from "@/lib/sprayJobsQuery";
import { SprayJobWizard } from "@/components/spray/wizard/SprayJobWizard";
import type { WizardLookups } from "@/components/spray/wizard/types";

export function PlanSprayFromProgramStep({
  open, onOpenChange, vineyardId, programStep, canEdit, lookups,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
  programStep: SprayJob;
  canEdit: boolean;
  lookups: WizardLookups;
}) {
  const { data: chemResult } = useQuery({
    queryKey: ["saved-chemicals", vineyardId, "intelligence"],
    enabled: open && !!vineyardId,
    queryFn: () => fetchSavedChemicalsForVineyard(vineyardId),
  });

  const prefill = useMemo(() => {
    const intelligenceById = new Map<string, ChemicalIntelligence>();
    for (const row of chemResult?.chemicals ?? []) {
      const intel = toChemicalIntelligence(row as any);
      intelligenceById.set(intel.id, intel);
    }
    const step = hydrateDraft({
      vineyardId,
      job: programStep,
      isTemplate: true,
      paddockIds: [],
      intelligenceById,
    });
    const prefill = planSprayPrefillFromProgramStep(step);
    // Program Step rate wins; an older step with no stored rate falls back to
    // the Vineyard Preferred Rate before any registered/default logic.
    prefill.products = (prefill.products ?? []).map((p) =>
      withPreferredRateFallback(
        p,
        p.savedChemicalId ? intelligenceById.get(p.savedChemicalId)?.vineyardPreferredRate ?? null : null,
      ),
    );
    return prefill;
  }, [chemResult, programStep, vineyardId]);

  if (chemResult === undefined) return null;

  return (
    <SprayJobWizard
      open={open}
      onOpenChange={onOpenChange}
      vineyardId={vineyardId}
      job={null}
      isTemplate={false}
      canEdit={canEdit}
      lookups={lookups}
      prefill={prefill}
    />
  );
}
