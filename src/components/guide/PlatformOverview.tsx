import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PlatformBadges } from "./PlatformBadges";
import { guideVisual } from "./guideVisuals";
import type { HowVineTrackWorksItem } from "@/lib/guide/howVineTrackWorksCatalogue";

/**
 * VineTrack across devices — three strong, high-level cards.
 *
 * Capability lists (offline sync, GPS/trips, alerts, quick actions, biometrics,
 * operational tools) come from the catalogue's `subItems`, so the genuine
 * iOS/Android differences recorded in Stage 1B are preserved. They stay hidden
 * until the card is expanded.
 */
export function PlatformOverview({
  items,
  headline,
}: {
  items: HowVineTrackWorksItem[];
  headline?: Record<string, string>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {items.map((item) => (
        <PlatformCard key={item.id} item={item} headline={headline?.[item.id]} />
      ))}
    </div>
  );
}

function PlatformCard({
  item,
  headline,
}: {
  item: HowVineTrackWorksItem;
  headline?: string;
}) {
  const [open, setOpen] = useState(false);
  const { Icon, tone } = guideVisual(item.visualKey);
  const panelId = `platform-${item.id}`;
  const hasDetail = (item.subItems?.length ?? 0) > 0;

  return (
    <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      <div
        className={cn("flex h-20 items-center justify-center bg-gradient-to-br", tone)}
        aria-hidden
        data-visual-key={item.visualKey}
      >
        <Icon className="h-7 w-7" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-[15px] font-semibold leading-tight text-foreground">
            {item.title}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {headline ?? item.shortDescription}
          </p>
        </div>

        {open && hasDetail && (
          <ul className="space-y-1 rounded-md bg-muted/50 p-3 text-[12.5px] text-muted-foreground">
            {item.subItems!.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-primary">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <PlatformBadges platforms={item.platforms} />
          <div className="flex items-center gap-3">
            {hasDetail && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls={panelId}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
              >
                {open ? "Hide capabilities" : "View capabilities"}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                />
              </button>
            )}
            {item.webRoute && (
              <Link
                to={item.webRoute}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
              >
                Open
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
