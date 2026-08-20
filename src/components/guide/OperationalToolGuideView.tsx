import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GuideScreenshot } from "@/components/guide/GuideScreenshot";
import { PlatformBadges } from "@/components/guide/PlatformBadges";
import {
  operationalToolAction,
  operationalToolCatalogueItem,
  operationalToolPlatforms,
  OPERATIONAL_TOOLS_ROUTE,
  type OperationalToolGuide,
} from "@/lib/guide/operationalToolGuides";
import { useGuideViewer } from "@/lib/guide/useGuideViewer";
import { guideActionDecision } from "@/lib/guide/guideAccess";

/**
 * Stage 4B — the single shared structure for every Operational Tool guide.
 *
 * All thirteen tools render through this one component and one parameterised
 * route. Education only: no live vineyard data, no usage metrics, no
 * completion scoring, no contribution to Core Setup readiness.
 */
export function OperationalToolGuideView({ guide }: { guide: OperationalToolGuide }) {
  const item = operationalToolCatalogueItem(guide);
  const title = item?.title ?? guide.toolId;
  const platforms = operationalToolPlatforms(guide);
  const viewer = useGuideViewer();
  const rawAction = operationalToolAction(guide);
  const actionAccess = guideActionDecision(rawAction?.route, viewer);
  const action = actionAccess.show ? rawAction : undefined;

  return (
    <div className="space-y-6" data-tool-guide={guide.toolId}>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <Link
          to="/dashboard/how-vinetrack-works"
          className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          How VineTrack Works
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
        <Link to={OPERATIONAL_TOOLS_ROUTE} className="font-semibold text-primary hover:underline">
          Operational Tools
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
        <span className="font-medium text-muted-foreground">{title}</span>
      </nav>

      <Card className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,38%)]">
          <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                Operational Tool
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {title}
              </h1>
            </div>
            <p className="max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
              {guide.purpose}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">Available on</span>
              <PlatformBadges platforms={platforms} />
            </div>
            {action ? (
              <div>
                <Link
                  to={action.route}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {action.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                {rawAction
                  ? actionAccess.hint
                  : "This tool runs in the VineTrack mobile apps — there is no portal screen for it."}
              </p>
            )}
          </div>
          <div className="order-first p-4 lg:order-last lg:p-5">
            <GuideScreenshot
              imageKey={guide.imageKey}
              alt={`${title} in VineTrack`}
              className="h-full"
            />
          </div>
        </div>
      </Card>

      <Section title="When you would use it" description={guide.intro}>
        <BulletList items={guide.useCases} />
      </Section>

      <section className="space-y-3">
        <SectionHeading
          title="How it works"
          description="The everyday sequence — kept short on purpose."
        />
        <ol className="grid gap-2 sm:grid-cols-2">
          {guide.steps.map((step, i) => (
            <li key={step} className="flex gap-3 rounded-xl border border-border bg-card p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                {i + 1}
              </span>
              <span className="text-[13.5px] leading-relaxed text-foreground/90">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="What VineTrack records or calculates"
          description="Verified behaviour only."
        >
          <BulletList items={guide.recordedOrCalculated} />
        </Section>
        <Section title="What you get from it" description="The outcome of using the tool.">
          <BulletList items={guide.outcomes} />
        </Section>
      </div>

      {guide.platformNote && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {guide.platformNote}
        </p>
      )}

      <div className="border-t border-border pt-6">
        <Link
          to={OPERATIONAL_TOOLS_ROUTE}
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Operational Tools
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading title={title} description={description} />
      {children}
    </section>
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

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 rounded-xl border border-border bg-card p-4">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[13.5px] leading-relaxed text-foreground/90">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          {item}
        </li>
      ))}
    </ul>
  );
}
