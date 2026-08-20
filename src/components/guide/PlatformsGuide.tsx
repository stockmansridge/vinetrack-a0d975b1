import { Link } from "react-router-dom";
import { Apple, ArrowRight, ChevronRight, Monitor, Plug, LifeBuoy, Smartphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PlatformBadges } from "@/components/guide/PlatformBadges";
import { HOW_VINETRACK_WORKS_CATALOGUE } from "@/lib/guide/howVineTrackWorksCatalogue";

/**
 * Stage 4B — VineTrack across iOS, Android and the Web Portal.
 *
 * Answers one question: what do I use the phone apps for, and what do I use the
 * portal for? Not a feature-by-feature comparison. Only platform differences
 * that materially change how someone uses VineTrack are shown; internal
 * implementation differences stay out of this copy.
 *
 * Nothing here is promoted that the catalogue marks internal or unclassified —
 * Mapping and Crop Health are deliberately absent.
 */

interface Surface {
  id: string;
  title: string;
  Icon: typeof Apple;
  headline: string;
  groups: { label: string; items: string[] }[];
  note?: string;
}

const SURFACES: Surface[] = [
  {
    id: "platform.ios",
    title: "VineTrack for iOS",
    Icon: Apple,
    headline: "The field app. Record work where it happens, with or without signal.",
    groups: [
      {
        label: "Mobile field experience",
        items: [
          "Pins, repairs and observations recorded at the exact spot",
          "GPS trips, row guidance and the vineyard map offline",
          "Spray recording in the field",
          "The thirteen operational tools on the home grid",
        ],
      },
      {
        label: "Working away from coverage",
        items: [
          "Offline-first — work is queued and syncs when back in range",
          "Alerts, quick actions and biometric unlock",
        ],
      },
    ],
  },
  {
    id: "platform.android",
    title: "VineTrack for Android",
    Icon: Smartphone,
    headline: "The same field role as iOS, for Android crews.",
    groups: [
      {
        label: "Mobile field experience",
        items: [
          "The same thirteen operational tools, in the same order",
          "Pins, GPS trips, spray recording and the offline vineyard map",
          "Offline-first sync with an offline readiness check",
          "Alerts, quick actions and fingerprint unlock",
        ],
      },
      {
        label: "Android-specific",
        items: [
          "Self-service account deletion is available on Android",
          "Canopy water rates is an Android tool",
        ],
      },
    ],
    note: "iOS and Android share the same field workflows and the same tool catalogue. The differences worth knowing are listed above.",
  },
  {
    id: "platform.web",
    title: "Web Portal",
    Icon: Monitor,
    headline: "Where the vineyard is set up, planned, managed and analysed.",
    groups: [
      {
        label: "Web management",
        items: [
          "Setup — vineyard, blocks, boundaries, rows, planting, equipment",
          "Planning — spray programs, resistance planning and work",
          "Team and access management, including who sees financial detail",
        ],
      },
      {
        label: "Review & administration",
        items: [
          "Reporting across activity, cost, spray, yield and environment",
          "Exports and documents",
          "Account and vineyard administration",
        ],
      },
    ],
  },
];

const DIFFERENCES = [
  {
    title: "Account deletion",
    body: "Available in the Android app. iOS users request deletion through support.",
  },
  {
    title: "Canopy water rates",
    body: "Available as a tool on Android only.",
  },
  {
    title: "Billing & subscription",
    body: "Purchase and subscription flows differ between the App Store and Google Play.",
  },
];

function route(id: string): string | undefined {
  return HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === id)?.webRoute;
}

export function PlatformsGuide() {
  const apiRoute = route("platform.api");

  return (
    <div className="space-y-8" data-guide-view="platforms">
      <section className="space-y-3">
        <SectionHeading
          title="Record work where it happens; manage and analyse it from the portal"
          description="Many VineTrack workflows can move naturally between planning, field recording and management — they do not all have to start in the same place."
        />
        <FlowStrip
          steps={[
            "Plan on Web",
            "Work in the vineyard on iOS / Android",
            "Sync",
            "Review & report on Web",
          ]}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {SURFACES.map((s) => {
          const item = HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === s.id);
          return (
            <Card key={s.id} className="flex h-full flex-col gap-3 p-5" data-surface={s.id}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <h3 className="text-[15px] font-semibold text-foreground">{s.title}</h3>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{s.headline}</p>
              {item && <PlatformBadges platforms={item.platforms} />}
              <div className="space-y-3 pt-1">
                {s.groups.map((g) => (
                  <div key={g.label}>
                    <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-primary">
                      {g.label}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {g.items.map((i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-[13px] leading-relaxed text-foreground/90"
                        >
                          <span
                            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            aria-hidden
                          />
                          {i}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {s.note && (
                <p className="mt-auto pt-2 text-[12px] leading-relaxed text-muted-foreground">
                  {s.note}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <section className="space-y-3">
        <SectionHeading
          title="Differences worth knowing"
          description="Only the differences that change how you actually use VineTrack."
        />
        <div className="grid gap-2 sm:grid-cols-3">
          {DIFFERENCES.map((d) => (
            <div key={d.title} className="rounded-xl border border-border bg-card p-3">
              <p className="text-[13.5px] font-semibold text-foreground">{d.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="API & integrations"
          description="For vineyards that want VineTrack information in other systems."
        />
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plug className="h-4.5 w-4.5" aria-hidden />
            </span>
            <h3 className="text-[15px] font-semibold text-foreground">API & webhooks</h3>
          </div>
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            VineTrack supports API access and webhooks so vineyard information can be connected
            to external systems. Access is managed by the vineyard from the portal, and the
            developer documentation lives alongside it.
          </p>
          {apiRoute && (
            <Link
              to={apiRoute}
              className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"
            >
              Open Integrations
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Need help?"
          description="Support is built into VineTrack — there is no separate form to fill in here."
        />
        <Card className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LifeBuoy className="h-4.5 w-4.5" aria-hidden />
            </span>
            <h3 className="text-[15px] font-semibold text-foreground">Contact support</h3>
          </div>
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            Use <span className="font-semibold text-foreground">Contact support</span> at the
            bottom of the portal sidebar, or the support option in the mobile apps, to send
            feedback, a feature request or an issue report. Requests are triaged by the VineTrack
            team.
          </p>
        </Card>
      </section>
    </div>
  );
}

function FlowStrip({ steps }: { steps: string[] }) {
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

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-border pb-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
