import { GuideHero } from "@/components/guide/GuideHero";
import { GuideAreaCard } from "@/components/guide/GuideAreaCard";
import { GUIDE_AREAS } from "@/lib/guide/guideAreas";

/**
 * How VineTrack Works — landing page (Stage 2.6).
 *
 * Deliberately shallow: a dominant hero, then one large visual card per major
 * area. No setup detail, no field-workflow detail, no 13-tool grid, no
 * accordions — all of that lives in the focused drill-down guide views at
 * /dashboard/how-vinetrack-works/<slug>.
 *
 * Route is System Admin-only (RequireSystemAdmin in src/App.tsx).
 */
export default function HowVineTrackWorksPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-8 p-4 sm:p-6 lg:p-8">
      <GuideHero />

      <div className="space-y-5">
        {GUIDE_AREAS.map((area, i) => (
          <GuideAreaCard key={area.id} area={area} index={i} />
        ))}
      </div>
    </div>
  );
}
