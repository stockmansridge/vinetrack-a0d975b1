import { GuideHero } from "@/components/guide/GuideHero";
import { GuideAreaCard } from "@/components/guide/GuideAreaCard";
import { GuidePageShell } from "@/components/guide/GuidePageShell";
import { LANDING_GUIDE_AREAS } from "@/lib/guide/guideAreas";
import { useVineyard } from "@/context/VineyardContext";
import { useSetupHealth } from "@/lib/guide/setupHealthQuery";

/**
 * How VineTrack Works — landing page.
 *
 * Stage 3: the Setup row and the hero readiness pill are driven by live Core
 * Setup health for the selected vineyard. Every other row stays descriptive.
 *
 * Route is System Admin-only (RequireSystemAdmin in src/App.tsx).
 */
export default function HowVineTrackWorksPage() {
  const { selectedVineyardId } = useVineyard();
  const { summary, loading } = useSetupHealth(selectedVineyardId);
  const caption = loading ? "Checking your setup…" : summary.caption;

  return (
    <GuidePageShell>
      <GuideHero coreSetupStatus={summary.status} coreSetupCaption={caption} />

      <div className="mt-3 space-y-2">
        {LANDING_GUIDE_AREAS.map((area, i) => (
          <GuideAreaCard
            key={area.id}
            area={area}
            index={i}
            setupStatus={area.showsSetupStatus ? summary.status : undefined}
            setupCaption={area.showsSetupStatus ? caption : undefined}
          />
        ))}
      </div>
    </GuidePageShell>
  );
}
