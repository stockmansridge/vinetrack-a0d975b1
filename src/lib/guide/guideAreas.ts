// How VineTrack Works — landing areas + drill-down definitions (Stage 2.6).
//
// The landing page shows ONE large card per area. Everything detailed lives in
// the drill-down guide view for that area at
// /dashboard/how-vinetrack-works/<slug>.
//
// This file is presentation architecture only: it groups existing catalogue
// items into the high-level story. The catalogue
// (howVineTrackWorksCatalogue.ts) stays the authority for what each feature is,
// where it runs and whether it is available. Nothing here grants access —
// routing/RequireSystemAdmin/RLS still enforce that.

import {
  HOW_VINETRACK_WORKS_CATALOGUE,
  SHARED_OPERATIONAL_TOOL_IDS,
  type HowVineTrackWorksItem,
} from "@/lib/guide/howVineTrackWorksCatalogue";

/** Where the image block sits on the large landing card (desktop). */
export type GuideImagePosition = "left" | "right";

/** How the drill-down view lays out its detail. */
export type GuideAreaDetailKind =
  | "setup"
  | "features"
  | "operational_tools"
  | "platforms";

export interface GuideAreaWorkflowStep {
  label: string;
  detail?: string;
}

export interface GuideArea {
  id: string;
  /** URL segment under /dashboard/how-vinetrack-works. */
  slug: string;
  /** Small step marker — a learning sequence, NOT a setup requirement. */
  stepLabel: string;
  /** Landing card + drill-down title. */
  title: string;
  /** 1–2 sentences. Nothing longer belongs on the landing page. */
  description: string;
  /** Slightly longer framing shown at the top of the drill-down view. */
  detailIntro: string;
  /** Landing card call to action. */
  actionLabel: string;
  /** Visual library hook — resolved through guideVisuals.ts. */
  visualKey: string;
  /** Real asset when supplied. Never invent VineTrack screenshots. */
  imageSrc?: string;
  imageAlt: string;
  imagePosition: GuideImagePosition;
  /** Catalogue items surfaced in the drill-down view. */
  itemIds: string[];
  detailKind: GuideAreaDetailKind;
  /**
   * Only the Setup area contributes to Stage 3 setup completion. Every other
   * area must never render a red "not started" status just because a tool has
   * not been used yet.
   */
  showsSetupStatus?: boolean;
  /** Neutral factual caption (e.g. "13 vineyard tools"). Never a fake metric. */
  metaLabel?: string;
  /** "How it works" sequence shown in the drill-down view. */
  workflow?: GuideAreaWorkflowStep[];
}

export const GUIDE_AREAS: GuideArea[] = [
  {
    id: "setup",
    slug: "setup",
    stepLabel: "Get started",
    title: "Getting Started — Setup",
    description:
      "Set up your vineyard, blocks, boundaries, rows, planting information, weather, equipment and team.",
    detailIntro:
      "These are the foundations every VineTrack vineyard needs. Get them right and every workflow, calculation and report downstream is accurate.",
    actionLabel: "View setup",
    visualKey: "area.setup",
    imageAlt: "Aerial view of vineyard blocks and rows",
    imagePosition: "right",
    itemIds: [
      "core.vineyard",
      "core.blocks",
      "core.planting",
      "core.weather",
      "core.equipment",
      "core.team",
      "core.spray_setup",
      "core.irrigation_setup",
      "core.preferences",
    ],
    detailKind: "setup",
    showsSetupStatus: true,
  },
  {
    id: "pins",
    slug: "pins",
    stepLabel: "Field observations",
    title: "Pins, Repairs & Observations",
    description:
      "Record issues and observations where they happen, attach them to the vineyard and follow them through to completion.",
    detailIntro:
      "Pins capture what someone sees in the vineyard — a broken post, a disease hot spot, an irrigation leak — against the exact block and row, so nothing is lost between the field and the office.",
    actionLabel: "Learn how Pins work",
    visualKey: "area.pins",
    imageAlt: "Vineyard rows with location pins recorded on a phone",
    imagePosition: "left",
    itemIds: ["field.pins", "field.maintenance_fuel"],
    detailKind: "features",
    workflow: [
      { label: "Find an issue", detail: "Someone spots something in the vineyard." },
      { label: "Drop a pin", detail: "Placed against the block and row." },
      { label: "Add information", detail: "Type, notes and photos." },
      { label: "Assign / action", detail: "Turn it into work when needed." },
      { label: "Complete", detail: "Closed off in the mobile app." },
      { label: "Retain history", detail: "Kept against the vineyard record." },
    ],
  },
  {
    id: "trips",
    slug: "trips",
    stepLabel: "Field trips",
    title: "Field Trips",
    description:
      "Track vineyard work by GPS, record machinery activity and keep an accurate history of field operations.",
    detailIntro:
      "Trips are the record of work actually performed in the vineyard — who, what machinery, which blocks and rows, and how long it took.",
    actionLabel: "Learn about Trips",
    visualKey: "area.trips",
    imageAlt: "Tractor working a vineyard row with a recorded GPS path",
    imagePosition: "right",
    itemIds: ["field.trips", "field.pruning", "field.growth_yield"],
    detailKind: "features",
    workflow: [
      { label: "Start a trip", detail: "In the field, on iPhone or Android." },
      { label: "Record by GPS", detail: "Path, blocks and rows captured as you work." },
      { label: "Add detail", detail: "Machinery, operator and activity." },
      { label: "Finish", detail: "Trip closed and synced." },
      { label: "Review in the portal", detail: "History and reporting." },
    ],
  },
  {
    id: "sprays",
    slug: "sprays",
    stepLabel: "Spray workflow",
    title: "Spray Planning & Sprays",
    description:
      "Plan spray applications, select blocks and products, perform the work in the vineyard and retain the final spray record.",
    detailIntro:
      "The spray workflow runs from planning in the portal through to the compliance record: plan the application, prepare the job, perform it in the field, complete it, and keep the spray record.",
    actionLabel: "Learn the spray workflow",
    visualKey: "area.sprays",
    imageAlt: "Sprayer working in a vineyard alongside the spray planning portal",
    imagePosition: "left",
    itemIds: ["field.spray_planner", "field.spray_jobs", "field.spray_trips"],
    detailKind: "features",
    workflow: [
      { label: "Plan", detail: "Resistance planner and spray program." },
      { label: "Prepare", detail: "Blocks, target, growth stage, equipment, products." },
      { label: "Perform", detail: "Spray trip recorded in the field." },
      { label: "Complete", detail: "Actuals confirmed against the job." },
      { label: "Spray record", detail: "Retained for compliance and reporting." },
    ],
  },
  {
    id: "work-tasks",
    slug: "work-tasks",
    stepLabel: "Work tasks",
    title: "Work Tasks",
    description:
      "Create vineyard work, assign people, record labour and machinery, and follow progress through to completion.",
    detailIntro:
      "Work Tasks are how vineyard work is organised and costed — hourly or piece rate, per block, with labour and machinery captured against the task.",
    actionLabel: "Learn about Work Tasks",
    visualKey: "area.work_tasks",
    imageAlt: "Vineyard crew working rows with tasks tracked on a mobile device",
    imagePosition: "right",
    itemIds: ["field.work_tasks", "tools.work_tasks", "field.pruning"],
    detailKind: "features",
    workflow: [
      { label: "Create the task", detail: "What needs doing, and where." },
      { label: "Assign", detail: "People, crews and machinery." },
      { label: "Perform", detail: "Recorded in the field." },
      { label: "Record labour", detail: "Hours or piece rate." },
      { label: "Complete", detail: "Costs flow into reporting." },
    ],
  },
  {
    id: "operational-tools",
    slug: "operational-tools",
    stepLabel: "Operational tools",
    title: "Operational Tools",
    description:
      "Explore specialist tools for pruning, irrigation, disease risk, growth stages, ripeness, yields, costs and more.",
    detailIntro:
      "The shared VineTrack tool set. The same thirteen tools appear on the iOS and Android home grid; a subset also has a portal surface.",
    actionLabel: "Explore Operational Tools",
    visualKey: "area.tools",
    imageAlt: "Grid of VineTrack operational tools",
    imagePosition: "left",
    itemIds: SHARED_OPERATIONAL_TOOL_IDS.map((k) => `tools.${k}`),
    detailKind: "operational_tools",
    metaLabel: `${SHARED_OPERATIONAL_TOOL_IDS.length} vineyard tools`,
  },
  {
    id: "reports",
    slug: "reports",
    stepLabel: "Reports & insights",
    title: "Reports & Insights",
    description:
      "Turn vineyard records into activity, cost, labour, spray, equipment and production information.",
    detailIntro:
      "Everything recorded in the field becomes reporting: activity, costs, labour, spray compliance, yield, environment, exports and team management.",
    actionLabel: "Explore Reports & Insights",
    visualKey: "area.reports",
    imageAlt: "VineTrack reporting dashboard with vineyard charts",
    imagePosition: "right",
    itemIds: [
      "reports.activity",
      "reports.costs",
      "reports.spray",
      "reports.yield",
      "reports.environment",
      "reports.exports",
      "reports.data_coverage",
      "reports.team_management",
    ],
    detailKind: "features",
  },
  {
    id: "platforms",
    slug: "platforms",
    stepLabel: "Across devices",
    title: "VineTrack Across Devices",
    description:
      "Record work in the field on iPhone or Android, then manage and analyse the vineyard through the Web Portal.",
    detailIntro:
      "VineTrack is one platform across three surfaces. The mobile apps are built for the field — offline, GPS and quick capture. The portal is built for setup, planning and analysis.",
    actionLabel: "See how the platforms connect",
    visualKey: "area.platforms",
    imageAlt: "iPhone, Android phone and laptop running VineTrack",
    imagePosition: "left",
    itemIds: [
      "platform.ios",
      "platform.android",
      "platform.web",
      "platform.api",
      "platform.support",
    ],
    detailKind: "platforms",
  },
];

export function guideAreaBySlug(slug?: string): GuideArea | undefined {
  return GUIDE_AREAS.find((a) => a.slug === slug);
}

export function guideAreaRoute(area: GuideArea): string {
  return `/dashboard/how-vinetrack-works/${area.slug}`;
}

/** Catalogue items for an area, in catalogue display order, de-duplicated. */
export function guideAreaItems(area: GuideArea): HowVineTrackWorksItem[] {
  const seen = new Set<string>();
  const items: HowVineTrackWorksItem[] = [];
  for (const id of area.itemIds) {
    if (seen.has(id)) continue;
    const item = HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === id);
    if (item) {
      seen.add(id);
      items.push(item);
    }
  }
  return items;
}
