import { GuideHero } from "@/components/guide/GuideHero";
import { GuideAreaCard } from "@/components/guide/GuideAreaCard";
import { LANDING_GUIDE_AREAS } from "@/lib/guide/guideAreas";

/**
 * How VineTrack Works — landing page (Stage 2.8 density pass).
 *
 * Structure is unchanged from Stage 2.7 (one hero, seven rows, images right,
 * drill-downs for detail). This pass only tightens density: the stack now uses
 * almost the full portal workspace with ~18-20px gutters, a ~12px top gap, a
 * shorter hero and tight 8px row gaps.
 *
 * Route is System Admin-only (RequireSystemAdmin in src/App.tsx).
 */
export default function HowVineTrackWorksPage() {
  return (
    <div className="w-full px-[18px] pb-6 pt-3 xl:px-5">
      <GuideHero />

      <div className="mt-3 space-y-2">
        {LANDING_GUIDE_AREAS.map((area, i) => (
          <GuideAreaCard key={area.id} area={area} index={i} />
        ))}
      </div>
    </div>
  );
}
