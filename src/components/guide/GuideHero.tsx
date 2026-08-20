import { Lock, CircleDashed } from "lucide-react";
import { GuideVisualSlot } from "./GuideVisualSlot";
import { SetupPresentationPill } from "./SetupPresentationPill";
import type { SetupPresentation } from "@/lib/guide/setupPresentation";
import { useGuideImage } from "@/lib/guide/guideImageStore";
import { focusToObjectPosition } from "@/lib/guide/guideImages";

/**
 * Guide hero — one broad, image-led dashboard banner (Stage 2.8).
 *
 * The photograph/composition (vineyard, tractor, phone + portal screenshots)
 * fills the whole banner via the `hero.platforms` visual key, right-biased, with
 * a white-to-transparent fade under the copy. It must never read as "a text card
 * plus a coloured panel", and it spans exactly the same width as the rows below.
 *
 * The readiness area is Stage 3-ready: shared status pill plus an optional
 * caption. Stage 2.8 shows "Not checked yet" and NEVER a percentage.
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
  const uploaded = useGuideImage("hero");
  return (
    <section className="relative w-full overflow-hidden rounded-[10px] border border-border bg-card">
      {/* Full-bleed hero visual, right-biased */}
      <div className="absolute inset-0">
        <GuideVisualSlot
          visualKey="hero.platforms"
          imageSrc={uploaded.url ?? imageSrc}
          imageAlt={imageAlt}
          objectPosition={focusToObjectPosition(uploaded.focus ?? "right")}
          aspect=""
          subtle
          className="h-full"
        />
      </div>

      {/* Left-to-right fade so hero copy stays readable over photography */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-card from-30% via-card/85 via-60% to-transparent"
        aria-hidden
      />

      <div className="relative flex h-[218px] flex-col justify-center gap-2 px-7 py-6 lg:max-w-[64%]">
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Lock className="h-3 w-3" />
          Internal preview
        </span>

        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground sm:text-[32px]">
          How VineTrack Works
        </h1>
        <p className="max-w-2xl text-[13.5px] leading-[1.45] text-muted-foreground">
          VineTrack brings your vineyard operations together across the vineyard, the
          iPhone and Android apps, and the management portal. Start with the essentials,
          then follow the workflows that plan, record and explain your vineyard.
        </p>

        {/* Setup readiness — reserved for live Core Setup health in Stage 3. */}
        <div className="inline-flex w-fit flex-wrap items-center gap-2 rounded-lg border border-border bg-card/90 px-3 py-1.5">
          <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <p className="text-[12.5px] font-semibold text-foreground">Core setup</p>
          <GuideRowStatusPill status={coreSetupStatus} />
          {coreSetupCaption && (
            <span className="text-[12px] text-muted-foreground">{coreSetupCaption}</span>
          )}
        </div>
      </div>
    </section>
  );
}
