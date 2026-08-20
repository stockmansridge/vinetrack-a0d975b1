import { GuideHero } from "@/components/guide/GuideHero";
import { GuideAreaCard } from "@/components/guide/GuideAreaCard";
import { GuidePageShell } from "@/components/guide/GuidePageShell";
import { LANDING_GUIDE_AREAS } from "@/lib/guide/guideAreas";
import { useVineyard } from "@/context/VineyardContext";
import { useSetupHealth } from "@/lib/guide/setupHealthQuery";
import { deriveSetupPresentation } from "@/lib/guide/setupPresentation";

/**
 * How VineTrack Works — landing page.
 *
 * Stage 3.2: the hero and the Setup row (step 1) both consume one shared
 * presentation resolver. Steps 2–7 are neutral educational sequence numbers
 * and carry no completion state.
 *
 * Route is System Admin-only (RequireSystemAdmin in src/App.tsx).
 */
export default function HowVineTrackWorksPage() {
  const { selectedVineyardId } = useVineyard();
  const { summary, loading, error } = useSetupHealth(selectedVineyardId);
  const setup = deriveSetupPresentation(summary, { loading, error });

  return (
    <GuidePageShell>
      <GuideHero setup={setup} />

      <div className="mt-3 space-y-2">
        {LANDING_GUIDE_AREAS.map((area, i) => (
          <GuideAreaCard
            key={area.id}
            area={area}
            index={i}
            setup={area.showsSetupStatus ? setup : undefined}
          />
        ))}
      </div>
    </GuidePageShell>
  );
}
