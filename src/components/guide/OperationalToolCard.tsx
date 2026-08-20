import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PlatformBadges } from "./PlatformBadges";
import { guideVisual } from "./guideVisuals";
import {
  operationalToolAction,
  operationalToolCatalogueItem,
  operationalToolGuideRoute,
  operationalToolPlatforms,
  type OperationalToolGuide,
} from "@/lib/guide/operationalToolGuides";

/**
 * Stage 4B — compact catalogue card for one Operational Tool.
 *
 * Deliberately low density: icon, name, one sentence, platform badges and
 * "Learn more". The optional "Open tool" link appears only when the verified
 * catalogue carries a real portal route — mobile-only tools never get a fake
 * web destination.
 */
export function OperationalToolCard({ guide }: { guide: OperationalToolGuide }) {
  const item = operationalToolCatalogueItem(guide);
  const { Icon, tone } = guideVisual(item?.visualKey);
  const platforms = operationalToolPlatforms(guide);
  const action = operationalToolAction(guide);

  return (
    <Card
      className="flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-md"
      data-tool-id={guide.toolId}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
            tone,
          )}
          aria-hidden
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
        <h3 className="pt-1 text-[14.5px] font-semibold leading-tight text-foreground">
          {item?.title ?? guide.toolId}
        </h3>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">{guide.purpose}</p>

      <div className="mt-auto space-y-2.5 pt-1">
        <PlatformBadges platforms={platforms} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Link
            to={operationalToolGuideRoute(guide.toolId)}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
          >
            Learn more
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          {action && (
            <Link
              to={action.route}
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
            >
              Open tool
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
