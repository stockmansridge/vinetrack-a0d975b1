import { ArrowRight, type LucideIcon } from "lucide-react";
import { Grape, ClipboardList, Wrench, FileBarChart, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The five-part VineTrack journey — the page's primary orientation device.
 *
 * These are high-level tiles only: no feature lists, no platform badges (they
 * would be noise at this level). Each tile is an in-page anchor, so no new
 * routes are introduced and browser back/forward keeps working.
 */
export interface JourneyStep {
  id: string;
  anchor: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  tone: string;
}

export const GUIDE_JOURNEY: JourneyStep[] = [
  {
    id: "setup",
    anchor: "#setup",
    title: "Setup",
    description: "Get the vineyard, blocks, weather, equipment and team ready.",
    Icon: Grape,
    tone: "from-primary/15 to-primary/5 text-primary",
  },
  {
    id: "field-work",
    anchor: "#field-work",
    title: "Field Work",
    description: "Record what happens in the vineyard.",
    Icon: ClipboardList,
    tone: "from-orange-500/15 to-orange-500/5 text-orange-600 dark:text-orange-400",
  },
  {
    id: "operational-tools",
    anchor: "#operational-tools",
    title: "Operational Tools",
    description: "Use specialist tools for vineyard operations and decisions.",
    Icon: Wrench,
    tone: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-400",
  },
  {
    id: "reports-management",
    anchor: "#reports-management",
    title: "Reports & Management",
    description:
      "Turn field activity into useful records, reporting and management information.",
    Icon: FileBarChart,
    tone: "from-teal-500/15 to-teal-500/5 text-teal-600 dark:text-teal-400",
  },
  {
    id: "platform-advanced",
    anchor: "#platform-advanced",
    title: "Platform & Advanced",
    description:
      "Understand iOS, Android, Web, API, integrations and advanced capabilities.",
    Icon: Layers,
    tone: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400",
  },
];

function scrollToAnchor(anchor: string) {
  const el = document.querySelector(anchor);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function GuideJourney() {
  return (
    <nav aria-label="VineTrack journey" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {GUIDE_JOURNEY.map((step, i) => (
        <Card
          key={step.id}
          className="group h-full overflow-hidden transition-shadow hover:shadow-md"
        >
          <a
            href={step.anchor}
            onClick={(e) => {
              // Preserve the hash in the URL, but scroll smoothly.
              if (e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              history.replaceState(null, "", step.anchor);
              scrollToAnchor(step.anchor);
            }}
            className="flex h-full flex-col gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br",
                  step.tone,
                )}
                aria-hidden
              >
                <step.Icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold leading-tight text-foreground">
                {step.title}
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
              Explore
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </a>
        </Card>
      ))}
    </nav>
  );
}
