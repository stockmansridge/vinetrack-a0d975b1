import { BookOpen, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Top of the guide. Internal preview state is stated plainly. */
export function GuideHero() {
  return (
    <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/[0.10] via-primary/[0.04] to-transparent">
      <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
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
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
            How VineTrack Works
          </h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
            Set up your vineyard, learn the key workflows and understand how VineTrack
            connects field operations, mobile apps and the management portal.
          </p>
        </div>

        <div className="hidden shrink-0 lg:block" data-visual-key="hero.platforms">
          {/* Placeholder for the future hero visual (portal + iPhone + Android). */}
          <div className="flex h-36 w-64 items-center justify-center rounded-xl border border-dashed border-primary/30 bg-card/50 text-center text-[11.5px] leading-relaxed text-muted-foreground">
            Platform visual
            <br />
            (added in a later stage)
          </div>
        </div>
      </div>
    </Card>
  );
}
