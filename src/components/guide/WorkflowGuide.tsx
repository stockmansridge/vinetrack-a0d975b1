import { Link } from "react-router-dom";
import { useGuideViewer } from "@/lib/guide/useGuideViewer";
import { guideActionDecision } from "@/lib/guide/guideAccess";

import { ArrowRight, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GuideScreenshot } from "@/components/guide/GuideScreenshot";
import { GuideStepList } from "@/components/guide/GuideStepList";
import { useGuideSection } from "@/lib/guide/guideContentStore";
import { visibleSteps } from "@/lib/guide/guideContent";

import {
  workflowProductAction,
  type GuideWorkflow,
} from "@/lib/guide/guideWorkflows";

/**
 * Stage 4A — the shared visual structure for every workflow guide page.
 *
 * All four field workflows (Pins, Trips, Sprays, Work Tasks) render through
 * this one component so the pages teach in the same shape:
 *   How it works → See it in VineTrack → What gets recorded →
 *   Where the information goes → Open the feature.
 *
 * This is educational content only. No live vineyard data, no completion
 * scoring, no setup-health contribution.
 */
export function WorkflowGuide({ workflow }: { workflow: GuideWorkflow }) {
  const action = workflowProductAction(workflow);
  const { section } = useGuideSection(workflow.areaKey);
  const steps = visibleSteps(section);

  return (
    <div className="space-y-8" data-workflow-area={workflow.areaKey}>
      <section className="space-y-4" aria-labelledby="how-it-works">
        <SectionHeading
          id="how-it-works"
          title="How it works"
          description={section?.intro ?? workflow.intro}
        />
        <SequenceStrip steps={workflow.sequence} />
        <GuideStepList steps={steps} />
      </section>


      {workflow.platformRoles && workflow.platformRoles.length > 0 && (
        <section className="space-y-3" aria-labelledby="where-it-happens">
          <SectionHeading
            id="where-it-happens"
            title="Where each part happens"
            description="VineTrack is one platform across three surfaces — this is how they connect for this workflow."
          />
          <div className="grid gap-2 sm:grid-cols-3">
            {workflow.platformRoles.map((role) => (
              <div key={role.stage} className="rounded-xl border border-border bg-card p-3">
                <p className="text-[13px] font-semibold text-foreground">{role.stage}</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{role.where}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ListSection
          id="what-gets-recorded"
          title="What gets recorded"
          description="The information VineTrack keeps when this workflow is used."
          items={workflow.recordedItems}
        />
        <ListSection
          id="where-it-goes"
          title="Where the information goes"
          description="Why recording it matters."
          items={workflow.downstreamUses}
        />
      </div>

      {action && (
        <div className="border-t border-border pt-6">
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
  );
}

function SequenceStrip({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-xl border border-primary/20 bg-primary/[0.05] p-3">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className="rounded-lg bg-card px-2.5 py-1.5 text-[12.5px] font-semibold text-foreground shadow-sm">
            {s}
          </span>
          {i < steps.length - 1 && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}

function ListSection({
  id,
  title,
  description,
  items,
}: {
  id: string;
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <SectionHeading id={id} title={title} description={description} />
      <ul className="space-y-1.5 rounded-xl border border-border bg-card p-4">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13.5px] leading-relaxed text-foreground/90">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-border pb-3">
      <h2 id={id} className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
