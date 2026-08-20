import { Navigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GuideVisualSlot } from "@/components/guide/GuideVisualSlot";
import { GuideGrid } from "@/components/guide/GuideSection";
import { FeatureCard } from "@/components/guide/FeatureCard";
import { CoreSetupChecklist } from "@/components/guide/CoreSetupChecklist";
import { SetupOverview } from "@/components/guide/SetupOverview";
import { ExpandableSection } from "@/components/guide/ExpandableSection";
import { PlatformOverview } from "@/components/guide/PlatformOverview";
import { ReportsPayoff } from "@/components/guide/ReportsPayoff";
import { PlatformBadges } from "@/components/guide/PlatformBadges";
import { InternalBadge } from "@/components/guide/GuideBadges";
import {
  guideAreaBySlug,
  guideAreaItems,
  type GuideArea,
} from "@/lib/guide/guideAreas";
import {
  guideItemsForSection,
  SHARED_OPERATIONAL_TOOL_IDS,
  type GuidePlatform,
  type HowVineTrackWorksItem,
} from "@/lib/guide/howVineTrackWorksCatalogue";

const PLATFORM_HEADLINE: Record<string, string> = {
  "platform.ios":
    "The field app. Works offline, records trips by GPS and syncs when back in range.",
  "platform.android":
    "The same field app for Android crews, with the same operational tools.",
  "platform.web":
    "The management portal. Setup, planning, reporting and everything administrative.",
};

/**
 * Focused guide view for one area: /dashboard/how-vinetrack-works/<slug>.
 *
 * A single param route serves every area, so back/forward and direct links
 * behave normally and each URL is a real, focused page. Unknown slugs fall back
 * to the landing page. Access stays System Admin-only via RequireSystemAdmin.
 */
export default function GuideAreaPage() {
  const { area: slug } = useParams<{ area: string }>();
  const area = guideAreaBySlug(slug);

  if (!area) return <Navigate to="/dashboard/how-vinetrack-works" replace />;

  const items = guideAreaItems(area);

  return (
    <GuidePageShell className="space-y-6">
      <div className="space-y-2.5">
        <Breadcrumb title={area.title} />
        <AreaHero area={area} items={items} />
      </div>

      {area.workflow && area.workflow.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            How it works
          </h2>
          <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {area.workflow.map((step, i) => (
              <li
                key={step.label}
                className="flex gap-3 rounded-xl border border-border bg-card p-3"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold text-foreground">
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
                      {step.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <AreaDetail area={area} items={items} />

      <div className="border-t border-border pt-6">
        <Link
          to="/dashboard/how-vinetrack-works"
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to How VineTrack Works
        </Link>
      </div>
    </div>
  );
}

function Breadcrumb({ title }: { title: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Link
        to="/dashboard/how-vinetrack-works"
        className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        How VineTrack Works
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
      <span className="font-medium text-muted-foreground">{title}</span>
    </nav>
  );
}

function AreaHero({
  area,
  items,
}: {
  area: GuideArea;
  items: HowVineTrackWorksItem[];
}) {
  const platforms = Array.from(
    new Set(items.flatMap((i) => i.platforms)),
  ) as GuidePlatform[];
  const primary = items.find((i) => i.webRoute);

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,38%)]">
        <div className="flex flex-col justify-center gap-4 p-6 sm:p-8 lg:p-10">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              {area.stepLabel}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {area.title}
            </h1>
          </div>
          <p className="max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
            {area.detailIntro}
          </p>
          {platforms.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">
                Available on
              </span>
              <PlatformBadges platforms={platforms} />
            </div>
          )}
          {primary?.webRoute && (
            <div>
              <Link
                to={primary.webRoute}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open {primary.title}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
        <GuideVisualSlot
          visualKey={area.visualKey}
          imageSrc={area.imageSrc}
          imageAlt={area.imageAlt}
          aspect="aspect-[16/9] lg:aspect-auto"
          iconClassName="h-12 w-12"
          className="order-first min-h-[180px] lg:order-last lg:min-h-[260px]"
        />
      </div>
    </Card>
  );
}

function AreaDetail({
  area,
  items,
}: {
  area: GuideArea;
  items: HowVineTrackWorksItem[];
}) {
  if (area.detailKind === "setup") {
    return (
      <section className="space-y-4">
        <SectionHeading
          title="Setup areas"
          description="Open any area to see the individual checks behind it. Stage 3 will attach live setup health here."
        />
        <ExpandableSection
          id="setup-usage"
          moreLabel="Show platform usage overview"
          lessLabel="Hide platform usage overview"
          preview={<CoreSetupChecklist />}
        >
          <SetupOverview />
        </ExpandableSection>
      </section>
    );
  }

  if (area.detailKind === "operational_tools") {
    const mapItems = guideItemsForSection("maps_intelligence");
    const mapsPublic = mapItems.filter((i) => i.availability === "available");
    const mapsInternal = mapItems.filter((i) => i.availability !== "available");

    return (
      <div className="space-y-10">
        <section className="space-y-4">
          <SectionHeading
            title={`The ${SHARED_OPERATIONAL_TOOL_IDS.length} shared tools`}
            description="The same tool IDs appear on the iOS and Android home grid. Some also have a portal surface; some are mobile-only."
          />
          <GuideGrid>
            {items.map((item) => (
              <FeatureCard key={item.id} item={item} />
            ))}
          </GuideGrid>
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
        </section>
      </div>
    );
  }

  if (area.detailKind === "platforms") {
    const deviceIds = ["platform.ios", "platform.android", "platform.web"];
    const devices = items.filter((i) => deviceIds.includes(i.id));
    const advanced = items.filter((i) => !deviceIds.includes(i.id));

    return (
      <div className="space-y-10">
        <section className="space-y-4">
          <SectionHeading
            title="One platform, three surfaces"
            description="The mobile apps are built for the field; the portal is built for setup, planning and analysis."
          />
          <PlatformOverview items={devices} headline={PLATFORM_HEADLINE} />
        </section>

        {advanced.length > 0 && (
          <section className="space-y-4">
            <SectionHeading
              title="API, integrations & support"
              description="Advanced capabilities that sit alongside the three product surfaces."
            />
            <GuideGrid columns={2}>
              {advanced.map((item) => (
                <FeatureCard key={item.id} item={item} />
              ))}
            </GuideGrid>
          </section>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {area.id === "reports" && <ReportsPayoff />}
      <SectionHeading
        title="What's included"
        description="The VineTrack features that make up this area."
      />
      <GuideGrid>
        {items.map((item) => (
          <FeatureCard key={item.id} item={item} />
        ))}
      </GuideGrid>
    </section>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-border pb-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
