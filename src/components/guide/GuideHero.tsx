import { Lock, CircleDashed } from "lucide-react";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { SetupStatusPill, type SetupStatus } from "./SetupCard";

/**
 * Guide hero — one image-led banner (Stage 2.7).
 *
 * The photograph/composition (vineyard, tractor, phone + portal screenshots)
 * fills the whole banner via the `hero.platforms` visual key; the left side
 * carries a soft surface fade so the text stays readable. It must never read as
 * "a text card plus a coloured panel".
 *
 * The readiness area is Stage 3-ready: shared status pill plus an optional
 * caption. Stage 2.7 shows "Not checked yet" and NEVER a percentage.
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
    <section className="relative overflow-hidden rounded-[11px] border border-border bg-card">
      {/* Full-bleed hero visual */}
      <div className="absolute inset-0">
        <GuideVisualSlot
          visualKey="hero.platforms"
          imageSrc={imageSrc}
          imageAlt={imageAlt}
          aspect=""
          iconClassName="h-10 w-10"
          className="h-full"
        />
      </div>

      {/* Soft fade so hero copy stays readable over photography */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-card via-card/95 to-card/10"
        aria-hidden
      />

      <div className="relative flex min-h-[268px] flex-col justify-center gap-3 p-6 sm:p-8 lg:max-w-[62%]">
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Lock className="h-3 w-3" />
          Internal preview
        </span>

        <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-foreground sm:text-[36px]">
          How VineTrack Works
        </h1>
        <p className="max-w-xl text-[14.5px] leading-relaxed text-muted-foreground">
          VineTrack brings your vineyard operations together across the vineyard, the
          iPhone and Android apps, and the management portal. Start with the essentials,
          then follow the workflows that plan, record and explain your vineyard.
        </p>

        {/* Setup readiness — reserved for live Core Setup health in Stage 3. */}
        <div className="mt-1 inline-flex w-fit flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card/90 px-3.5 py-2">
          <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
          <p className="text-[13px] font-semibold text-foreground">Core setup</p>
          <SetupStatusPill status={coreSetupStatus} />
          {coreSetupCaption && (
            <span className="text-[12.5px] text-muted-foreground">{coreSetupCaption}</span>
          )}
        </div>
      </div>
    </section>
  );
}
