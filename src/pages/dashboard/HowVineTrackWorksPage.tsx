import { GuideHero } from "@/components/guide/GuideHero";
import { SetupOverview } from "@/components/guide/SetupOverview";
import { GuideSection, GuideGrid } from "@/components/guide/GuideSection";
import { SetupCard } from "@/components/guide/SetupCard";
import { FeatureCard } from "@/components/guide/FeatureCard";
import { WorkflowStrip } from "@/components/guide/WorkflowStrip";
import { InternalBadge } from "@/components/guide/GuideBadges";
import {
  GUIDE_SECTIONS,
  guideItemsForSection,
  SHARED_OPERATIONAL_TOOL_IDS,
} from "@/lib/guide/howVineTrackWorksCatalogue";

const sectionMeta = (id: string) => GUIDE_SECTIONS.find((s) => s.id === id)!;

/**
 * How VineTrack Works — onboarding centre, setup-health checker, training
 * library and platform guide. Currently a System Admin-only internal preview
 * (route guarded by RequireSystemAdmin in src/App.tsx).
 */
export default function HowVineTrackWorksPage() {
  const core = sectionMeta("core_setup");
  const field = sectionMeta("field_workflows");
  const tools = sectionMeta("operational_tools");
  const maps = sectionMeta("maps_intelligence");
  const reports = sectionMeta("reports_management");
  const platform = sectionMeta("platform_advanced");

  const toolItems = guideItemsForSection("operational_tools");
  const mapItems = guideItemsForSection("maps_intelligence");
  const mapsPublic = mapItems.filter((i) => i.availability === "available");
  const mapsInternal = mapItems.filter((i) => i.availability !== "available");

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-10 p-4 sm:p-6 lg:p-8">
      <GuideHero />

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Your VineTrack overview
          </h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            A single view of how ready this vineyard is, how the team is using the
            platform, and which tools have been explored.
          </p>
        </div>
        <SetupOverview />
      </section>

      {/* A — Core Setup */}
      <GuideSection
        id="core-setup"
        eyebrow="Step 1"
        title={core.title}
        description={core.description}
      >
        <GuideGrid columns={2}>
          {guideItemsForSection("core_setup").map((item) => (
            <SetupCard key={item.id} item={item} status="not_checked" />
          ))}
        </GuideGrid>
      </GuideSection>

      {/* B — Field Workflows */}
      <GuideSection
        id="field-workflows"
        eyebrow="Step 2"
        title={field.title}
        description={field.description}
      >
        <WorkflowStrip />
        <GuideGrid>
          {guideItemsForSection("field_workflows").map((item) => (
            <FeatureCard key={item.id} item={item} />
          ))}
        </GuideGrid>
      </GuideSection>

      {/* C — Operational Tools */}
      <GuideSection
        id="operational-tools"
        eyebrow="Step 3"
        title={tools.title}
        description={tools.description}
        aside={
          <p className="max-w-xs text-[12px] leading-relaxed text-muted-foreground">
            {SHARED_OPERATIONAL_TOOL_IDS.length} shared tool IDs, identical on iOS and
            Android. Some are also available in the portal; some are mobile-only.
          </p>
        }
      >
        <GuideGrid>
          {toolItems.map((item) => (
            <FeatureCard key={item.id} item={item} />
          ))}
        </GuideGrid>
      </GuideSection>

      {/* D — Maps & Vineyard Intelligence */}
      <GuideSection
        id="maps-intelligence"
        eyebrow="Step 4"
        title={maps.title}
        description={maps.description}
      >
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
              These entries exist for catalogue completeness and internal review only.
              They must not be presented to customers as available capabilities.
            </p>
            <GuideGrid>
              {mapsInternal.map((item) => (
                <FeatureCard key={item.id} item={item} />
              ))}
            </GuideGrid>
          </div>
        )}
      </GuideSection>

      {/* E — Reports & Management */}
      <GuideSection
        id="reports-management"
        eyebrow="Step 5"
        title={reports.title}
        description={reports.description}
      >
        <GuideGrid>
          {guideItemsForSection("reports_management").map((item) => (
            <FeatureCard key={item.id} item={item} />
          ))}
        </GuideGrid>
      </GuideSection>

      {/* F — Platform & Advanced */}
      <GuideSection
        id="platform-advanced"
        eyebrow="Step 6"
        title={platform.title}
        description={platform.description}
      >
        <GuideGrid columns={2}>
          {guideItemsForSection("platform_advanced").map((item) => (
            <FeatureCard key={item.id} item={item} />
          ))}
        </GuideGrid>
      </GuideSection>
    </div>
  );
}
