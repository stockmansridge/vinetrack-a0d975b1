import { GuideHero } from "@/components/guide/GuideHero";
import { GuideAreaCard } from "@/components/guide/GuideAreaCard";
import { LANDING_GUIDE_AREAS } from "@/lib/guide/guideAreas";

/**
 * How VineTrack Works — landing page (Stage 2.7).
 *
 * One vertical stack of identical-width objects: a single image-led hero, then
 * seven compact rows sharing the exact same container width. No detail, no
 * badges, no expandable sections — all of that lives in the focused drill-down
 * guide views at /dashboard/how-vinetrack-works/<slug>.
 *
 * Route is System Admin-only (RequireSystemAdmin in src/App.tsx).
 */
export default function HowVineTrackWorksPage() {
  return (
    <div className="py-6">
      {/* One shared container: hero and every row line up exactly. */}
      <div className="mx-auto w-[calc(100%-48px)] max-w-[1180px]">
        <GuideHero />

        <div className="mt-6 space-y-3">
          {LANDING_GUIDE_AREAS.map((area, i) => (
            <GuideAreaCard key={area.id} area={area} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
