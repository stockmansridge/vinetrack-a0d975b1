import { GuideHero } from "@/components/guide/GuideHero";
import { SetupOverview } from "@/components/guide/SetupOverview";
import { GuideSection, GuideGrid } from "@/components/guide/GuideSection";
import { GuideJourney } from "@/components/guide/GuideJourney";
import { CoreSetupChecklist } from "@/components/guide/CoreSetupChecklist";
import { CompactFeatureTile } from "@/components/guide/CompactFeatureTile";
import { ExpandableSection } from "@/components/guide/ExpandableSection";
import { PlatformOverview } from "@/components/guide/PlatformOverview";
import { ReportsPayoff } from "@/components/guide/ReportsPayoff";
import { FeatureCard } from "@/components/guide/FeatureCard";
import { WorkflowStrip } from "@/components/guide/WorkflowStrip";
import { InternalBadge } from "@/components/guide/GuideBadges";
import {
  GUIDE_SECTIONS,
  guideItemsForSection,
  SHARED_OPERATIONAL_TOOL_IDS,
  type HowVineTrackWorksItem,
} from "@/lib/guide/howVineTrackWorksCatalogue";

const sectionMeta = (id: string) => GUIDE_SECTIONS.find((s) => s.id === id)!;

const PLATFORM_HEADLINE: Record<string, string> = {
  "platform.ios":
    "The field app. Works offline, records trips by GPS and syncs when back in range.",
  "platform.android":
    "The same field app for Android crews, with the same operational tools.",
  "platform.web":
    "The management portal. Setup, planning, reporting and everything administrative.",
};

/**
 * How VineTrack Works — onboarding centre, setup-health checker, training
 * library and platform guide. Currently a System Admin-only internal preview
 * (route guarded by RequireSystemAdmin in src/App.tsx).
 *
 * Stage 2.5 structure: a reader sees the hero, the five-part journey, and one
 * compact block per area. Every detailed card list sits behind an explicit
 * "show more" so the page reads as an overview, not a manual.
 */
export default function HowVineTrackWorksPage() {
  const core = sectionMeta("core_setup");
  const field = sectionMeta("field_workflows");
  const tools = sectionMeta("operational_tools");
  const maps = sectionMeta("maps_intelligence");
  const reports = sectionMeta("reports_management");
  const platform = sectionMeta("platform_advanced");

  const fieldItems = guideItemsForSection("field_workflows");
  const toolItems = guideItemsForSection("operational_tools");
  const mapItems = guideItemsForSection("maps_intelligence");
  const mapsPublic = mapItems.filter((i) => i.availability === "available");
  const mapsInternal = mapItems.filter((i) => i.availability !== "available");
  const reportItems = guideItemsForSection("reports_management");

  const platformItems = guideItemsForSection("platform_advanced");
  const deviceIds = ["platform.ios", "platform.android", "platform.web"];
  const devices = deviceIds
    .map((id) => platformItems.find((i) => i.id === id))
    .filter((i): i is HowVineTrackWorksItem => !!i);
  const advanced = platformItems.filter((i) => !deviceIds.includes(i.id));

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-12 p-4 sm:p-6 lg:p-8">
      <GuideHero />

      <GuideJourney />

      {/* 1 — Setup */}
      <GuideSection
        id="setup"
        eyebrow="Step 1"
        title={core.title}
        description={core.description}
      >
        <ExpandableSection
          id="setup"
          moreLabel="Show platform usage overview"
          lessLabel="Hide platform usage overview"
          preview={<CoreSetupChecklist />}
        >
          <SetupOverview />
        </ExpandableSection>
      </GuideSection>

      {/* 2 — Field Work */}
      <GuideSection
        id="field-work"
        eyebrow="Step 2"
        title={field.title}
        description={field.description}
      >
        <ExpandableSection
          id="field-work"
          moreLabel={`Explore all ${fieldItems.length} field workflows`}
          preview={
            <>
              <WorkflowStrip />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {fieldItems.map((item) => (
                  <CompactFeatureTile key={item.id} item={item} />
                ))}
              </div>
            </>
          }
        >
          <GuideGrid>
            {fieldItems.map((item) => (
              <FeatureCard key={item.id} item={item} />
            ))}
          </GuideGrid>
        </ExpandableSection>
      </GuideSection>

      {/* 3 — Operational Tools (maps & intelligence folded in as depth) */}
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
        <ExpandableSection
          id="operational-tools"
          moreLabel="Show tool details, maps & vineyard intelligence"
          preview={
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {toolItems.map((item) => (
                <CompactFeatureTile key={item.id} item={item} />
              ))}
            </div>
          }
        >
          <GuideGrid>
            {toolItems.map((item) => (
              <FeatureCard key={item.id} item={item} />
            ))}
          </GuideGrid>

          <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">{maps.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {maps.description}
              </p>
            </div>
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
                  These entries exist for catalogue completeness and internal review
                  only. They must not be presented to customers as available
                  capabilities.
                </p>
                <GuideGrid>
                  {mapsInternal.map((item) => (
                    <FeatureCard key={item.id} item={item} />
                  ))}
                </GuideGrid>
              </div>
            )}
          </div>
        </ExpandableSection>
      </GuideSection>

      {/* 4 — Reports & Management */}
      <GuideSection
        id="reports-management"
        eyebrow="Step 4"
        title={reports.title}
        description={reports.description}
      >
        <ExpandableSection
          id="reports-management"
          moreLabel="Explore reports & management"
          preview={<ReportsPayoff />}
        >
          <GuideGrid>
            {reportItems.map((item) => (
              <FeatureCard key={item.id} item={item} />
            ))}
          </GuideGrid>
        </ExpandableSection>
      </GuideSection>

      {/* 5 — Platform & Advanced */}
      <GuideSection
        id="platform-advanced"
        eyebrow="Step 5"
        title={platform.title}
        description={platform.description}
      >
        <ExpandableSection
          id="platform-advanced"
          moreLabel="Show API, integrations & support"
          preview={<PlatformOverview items={devices} headline={PLATFORM_HEADLINE} />}
        >
          <GuideGrid columns={2}>
            {advanced.map((item) => (
              <FeatureCard key={item.id} item={item} />
            ))}
          </GuideGrid>
        </ExpandableSection>
      </GuideSection>
    </div>
  );
}
