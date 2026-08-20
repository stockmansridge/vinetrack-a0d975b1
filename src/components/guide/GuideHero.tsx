import { BookOpen, Lock, Grape, Tractor, Smartphone, Monitor, CircleDashed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SetupStatusPill, type SetupStatus } from "./SetupCard";

/**
 * Guide hero — the dominant introductory element of the page.
 *
 * The media area is a reserved slot: pass `imageSrc` once the VineTrack hero
 * image (vineyard + tractor + phone + portal) exists and it replaces the
 * placeholder without any other change.
 *
 * The progress area is Stage 3-ready: it renders the shared status pill and an
 * optional caption. Stage 2.5 shows "Not checked yet" and NEVER a percentage.
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
    <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/[0.12] via-primary/[0.05] to-transparent">
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,42%)] lg:items-center lg:gap-10 lg:p-10">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-primary">
              <BookOpen className="h-3.5 w-3.5" />
              Guide
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              <Lock className="h-3 w-3" />
              Internal preview — System Admin only
            </span>
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
            How VineTrack Works
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            VineTrack brings your vineyard operations together across the vineyard, mobile
            apps and management portal. Start with the essentials, then explore the
            workflows and tools available to your team.
          </p>

          {/* Progress area — reserved for live Core Setup health in Stage 3. */}
          <div className="mt-6 inline-flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
            <CircleDashed className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden />
            <div>
              <p className="text-[13px] font-semibold text-foreground">Core setup</p>
              <p className="text-[12px] text-muted-foreground">
                {coreSetupCaption ?? "Setup checks are not connected yet."}
              </p>
            </div>
            <SetupStatusPill status={coreSetupStatus} />
          </div>
        </div>

        <HeroVisual imageSrc={imageSrc} imageAlt={imageAlt} />
      </div>
    </Card>
  );
}

const HERO_ICONS = [
  { Icon: Grape, label: "Vineyard" },
  { Icon: Tractor, label: "Field work" },
  { Icon: Smartphone, label: "Mobile apps" },
  { Icon: Monitor, label: "Portal" },
];

function HeroVisual({ imageSrc, imageAlt }: { imageSrc?: string; imageAlt: string }) {
  return (
    <div
      className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent"
      data-visual-key="hero.platforms"
    >
      {imageSrc ? (
        <img src={imageSrc} alt={imageAlt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {HERO_ICONS.map(({ Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-card/80 text-primary",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
          <p className="max-w-[16rem] text-[11.5px] leading-relaxed text-muted-foreground">
            One platform — from the vineyard row to the management portal.
          </p>
        </div>
      )}
    </div>
  );
}
