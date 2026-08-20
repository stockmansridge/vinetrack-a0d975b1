import { Card } from "@/components/ui/card";
import { GuideStepList } from "@/components/guide/GuideStepList";
import { visibleSteps, type GuideContentSection } from "@/lib/guide/guideContent";

/**
 * Preview of a section exactly as How VineTrack Works renders it — the same
 * GuideStepList component, so there is only one rendering implementation.
 */
export function GuideSectionPreview({ section }: { section: GuideContentSection }) {
  const steps = visibleSteps(section);
  return (
    <Card className="space-y-4 border-dashed p-4 sm:p-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
          Guide preview
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
          {section.heading}
        </h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
          {section.intro}
        </p>
      </div>
      {steps.length > 0 ? (
        <GuideStepList steps={steps} />
      ) : (
        <p className="text-sm text-muted-foreground">No enabled steps to show.</p>
      )}
    </Card>
  );
}
