import { Lock, CircleDashed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { SetupStatusPill, type SetupStatus } from "./SetupCard";

/**
 * Guide hero — the dominant first screen.
 *
 * The media area is a full-bleed hero slot: register a real asset against the
 * `hero.platforms` visual key (or pass `imageSrc`) and it fills the panel with
 * no other change.
 *
 * The readiness area is Stage 3-ready: it renders the shared status pill plus
 * an optional caption ("6 of 7 setup areas complete"). Stage 2.6 shows
 * "Not checked yet" and NEVER a percentage.
 */
export function GuideHero({
  imageSrc,
  imageAlt = "VineTrack across the vineyard, mobile apps and management portal",
  coreSetupStatus = "not_checked",
  coreSetupCaption,
}: {
  imageSrc?: string;
  imageAlt?: string;
  coreSetupStatus?: SetupStatus;
  coreSetupCaption?: string;
}) {
  return (
    <Card className="overflow-hidden border-primary/25">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,46%)]">
        <div className="flex flex-col justify-center bg-gradient-to-br from-primary/[0.12] via-primary/[0.05] to-transparent p-6 sm:p-10 lg:p-12">
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Lock className="h-3 w-3" />
            Internal preview
          </span>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-[3rem] lg:leading-[1.05]">
            How VineTrack Works
          </h1>
          <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-muted-foreground">
            VineTrack brings your vineyard operations together across the vineyard,
            mobile apps and management portal. Start with the essentials, then follow the
            workflows that help you plan, record and understand your vineyard.
          </p>

          {/* Setup readiness — reserved for live Core Setup health in Stage 3. */}
          <div className="mt-7 inline-flex w-fit flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/80 px-4 py-3">
            <CircleDashed className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden />
            <p className="text-[13.5px] font-semibold text-foreground">Core setup</p>
            <SetupStatusPill status={coreSetupStatus} />
            {coreSetupCaption && (
              <span className="text-[12.5px] text-muted-foreground">{coreSetupCaption}</span>
            )}
          </div>
        </div>

        <GuideVisualSlot
          visualKey="hero.platforms"
          imageSrc={imageSrc}
          imageAlt={imageAlt}
          aspect="aspect-[16/9] lg:aspect-auto"
          iconClassName="h-14 w-14"
          className="order-first min-h-[220px] lg:order-last lg:min-h-[380px]"
          caption="One platform — from the vineyard row to the management portal."
        />
      </div>
    </Card>
  );
}
