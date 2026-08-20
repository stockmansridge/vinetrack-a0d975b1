import { GuideGrid } from "@/components/guide/GuideSection";
import { FeatureCard } from "@/components/guide/FeatureCard";
import { OperationalToolCard } from "@/components/guide/OperationalToolCard";
import { InternalBadge } from "@/components/guide/GuideBadges";
import { operationalToolGuides } from "@/lib/guide/operationalToolGuides";
import {
  guideItemsForSection,
  SHARED_OPERATIONAL_TOOL_IDS,
} from "@/lib/guide/howVineTrackWorksCatalogue";
import { useGuideViewer } from "@/lib/guide/useGuideViewer";
import { showsInternalContent } from "@/lib/guide/guideAccess";

/**
 * Stage 4B — the Operational Tools index.
 *
 * A low-density catalogue: one compact card per verified tool, each linking to
 * its own focused guide. Detail lives on the guide page, not here.
 *
 * Maps & vineyard intelligence stays below, and anything the catalogue marks
 * internal (Mapping, Crop Health) stays inside the clearly-labelled internal
 * block for System Admin review only — it is never presented as an available
 * VineTrack capability.
 */
export function OperationalToolsCatalogue() {
  const guides = operationalToolGuides();
  const mapItems = guideItemsForSection("maps_intelligence");
  const mapsPublic = mapItems.filter((i) => i.availability === "available");
  const viewer = useGuideViewer();
  // Internal entries (Mapping, Crop Health) never render for customer roles.
  const mapsInternal = showsInternalContent(viewer)
    ? mapItems.filter((i) => i.availability !== "available")
    : [];

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <SectionHeading
          title={`The ${SHARED_OPERATIONAL_TOOL_IDS.length} shared tools`}
          description="The same tools appear on the iOS and Android home grid. Some also have a portal surface; some are mobile-only. Open a tool guide to see how it is used."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {guides.map((guide) => (
            <OperationalToolCard key={guide.toolId} guide={guide} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          title="Maps & vineyard intelligence"
          description="Spatial features — vineyard mapping, boundaries, rows and in-field guidance."
        />
        <GuideGrid>
          {mapsPublic.map((item) => (
            <FeatureCard key={item.id} item={item} />
          ))}
        </GuideGrid>

        {mapsInternal.length > 0 && (
          <div className="space-y-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.04] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <InternalBadge />
              <p className="text-[13px] font-semibold text-foreground">
                Internal development — not customer-facing
              </p>
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              These entries exist for catalogue completeness and internal review only. They must
              not be presented to customers as available capabilities.
            </p>
            <GuideGrid>
              {mapsInternal.map((item) => (
                <FeatureCard key={item.id} item={item} />
              ))}
            </GuideGrid>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-border pb-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
