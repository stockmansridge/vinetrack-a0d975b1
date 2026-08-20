import { Navigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GuideVisualSlot } from "@/components/guide/GuideVisualSlot";
import { GuidePageShell } from "@/components/guide/GuidePageShell";
import { useGuideImage } from "@/lib/guide/guideImageStore";
import { focusToObjectPosition, type GuideImageKey } from "@/lib/guide/guideImages";
import { GuideGrid } from "@/components/guide/GuideSection";
import { FeatureCard } from "@/components/guide/FeatureCard";
import { CoreSetupChecklist } from "@/components/guide/CoreSetupChecklist";
import { SetupOverview } from "@/components/guide/SetupOverview";
import { SetupHealthChecks } from "@/components/guide/SetupHealthChecks";
import { SetupHealthDiagnostics } from "@/components/guide/SetupHealthDiagnostics";

import { useVineyard } from "@/context/VineyardContext";
import { useGuideViewer } from "@/lib/guide/useGuideViewer";
import {
  guideActionDecision,
  visibleGuideItems,
} from "@/lib/guide/guideAccess";
import { useSetupHealth } from "@/lib/guide/setupHealthQuery";
import { ExpandableSection } from "@/components/guide/ExpandableSection";
import { PlatformBadges } from "@/components/guide/PlatformBadges";
import { WorkflowGuide } from "@/components/guide/WorkflowGuide";
import { OperationalToolsCatalogue } from "@/components/guide/OperationalToolsCatalogue";
import { PlatformsGuide } from "@/components/guide/PlatformsGuide";
import { ReportsGuide } from "@/components/guide/ReportsGuide";

import {
  guideWorkflow,
  workflowPlatforms,
  workflowProductAction,
  type GuideWorkflow,
} from "@/lib/guide/guideWorkflows";

import {
  guideAreaBySlug,
  guideAreaItems,
  type GuideArea,
} from "@/lib/guide/guideAreas";
import {
  type GuidePlatform,
  type HowVineTrackWorksItem,
} from "@/lib/guide/howVineTrackWorksCatalogue";


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
  const viewer = useGuideViewer();

  if (!area) return <Navigate to="/dashboard/how-vinetrack-works" replace />;

  const items = visibleGuideItems(guideAreaItems(area), viewer);
  // Stage 4A: the four field workflows use the shared visual guide structure.
  const workflow = guideWorkflow(area.id);

  return (
    <GuidePageShell className="space-y-6">
      <div className="space-y-2.5">
        <Breadcrumb title={area.title} />
        <AreaHero area={area} items={items} workflow={workflow} />
      </div>

      {workflow ? (
        <WorkflowGuide workflow={workflow} />
      ) : (
        <>
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
        </>
      )}


      <div className="border-t border-border pt-6">
        <Link
          to="/dashboard/how-vinetrack-works"
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to How VineTrack Works
        </Link>
      </div>
    </GuidePageShell>
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
  workflow,
}: {
  area: GuideArea;
  items: HowVineTrackWorksItem[];
  workflow?: GuideWorkflow;
}) {
  // Workflow guides take their availability and product action straight from
  // the workflow's own catalogue items, so a badge can never claim a surface
  // the catalogue does not verify.
  const platforms = workflow
    ? workflowPlatforms(workflow)
    : (Array.from(new Set(items.flatMap((i) => i.platforms))) as GuidePlatform[]);
  const viewer = useGuideViewer();
  const catalogueAction = items.find((i) => i.webRoute);
  const proposed = workflow
    ? workflowProductAction(workflow)
    : catalogueAction?.webRoute
      ? { label: `Open ${catalogueAction.title}`, route: catalogueAction.webRoute }
      : undefined;
  // Stage 5B: never advertise a destination the viewer's role cannot open.
  const action = guideActionDecision(proposed?.route, viewer).show ? proposed : undefined;
  // Same uploaded image key as the landing row — one upload feeds both.
  const uploaded = useGuideImage(area.id as GuideImageKey);

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
          {action && (
            <div>
              <Link
                to={action.route}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {action.label}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

        </div>
        <GuideVisualSlot
          visualKey={area.visualKey}
          imageSrc={uploaded.url ?? area.imageSrc}
          imageAlt={area.imageAlt}
          objectPosition={focusToObjectPosition(uploaded.focus)}
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
    return <SetupAreaDetail />;
  }

  if (area.detailKind === "operational_tools") {
    return <OperationalToolsCatalogue />;
  }

  if (area.detailKind === "platforms") {
    return <PlatformsGuide />;
  }

  if (area.id === "reports") {
    return <ReportsGuide />;
  }


  return (
    <section className="space-y-4">
      
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

/**
 * Setup drill-down (Stage 3) — live Core Setup health for the selected
 * vineyard. Group cards show real statuses and "n of m complete"; the full
 * per-check list sits behind a disclosure so the page stays scannable.
 */
function SetupAreaDetail() {
  const { selectedVineyardId } = useVineyard();
  const { summary, loading, error, refetch } = useSetupHealth(selectedVineyardId);

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Setup areas"
        description="Live setup health for the selected vineyard. Readiness counts required checks only — recommended and optional steps never change the percentage."
      />
      <SetupHealthChecks
        summary={summary}
        loading={loading}
        error={error}
        onRefresh={refetch}
      />
      <SetupHealthDiagnostics summary={summary} />
      <ExpandableSection

        id="setup-usage"
        moreLabel="Show platform usage overview"
        lessLabel="Hide platform usage overview"
        preview={
          <CoreSetupChecklist
            statuses={summary.groupStatuses}
            progress={summary.groupProgress}
            checksByGroup={Object.fromEntries(
              summary.groups.map((g) => [g.id, g.checks]),
            )}
          />
        }
      >
        <SetupOverview />
      </ExpandableSection>
    </section>
  );
}
