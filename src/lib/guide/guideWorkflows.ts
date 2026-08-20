// How VineTrack Works — Stage 4A visual workflow guides.
//
// Educational content only. Nothing here is a setup requirement, nothing here
// contributes to Core Setup health, and nothing here reads live vineyard data.
//
// Platforms and product routes are DERIVED from the verified cross-platform
// catalogue (howVineTrackWorksCatalogue.ts) — never hand-typed here — so the
// guide can never claim a surface the catalogue does not confirm.

import {
  HOW_VINETRACK_WORKS_CATALOGUE,
  type GuidePlatform,
} from "@/lib/guide/howVineTrackWorksCatalogue";
import type { GuideWorkflowImageKey } from "@/lib/guide/guideImages";

export interface GuideWorkflowStep {
  /** Short imperative title, e.g. "Drop a Pin". */
  title: string;
  /** One or two plain sentences. No technical or database language. */
  body: string;
  /** Optional short concrete examples. */
  examples?: string[];
  /** Where this step happens, when the catalogue verifies a difference. */
  where?: string;
  /** Supporting screenshot slot; falls back safely when nothing is uploaded. */
  imageKey?: GuideWorkflowImageKey;
  imageAlt?: string;
}

export interface GuideWorkflow {
  /** Matches GuideArea.id. */
  areaKey: string;
  /** Plain-language framing shown under "How it works". */
  intro: string;
  /** 4–6 steps. Order is the taught order. */
  steps: GuideWorkflowStep[];
  /** Compact chips for the visual sequence. */
  sequence: string[];
  /** "What gets recorded". */
  recordedItems: string[];
  /** "Where the information goes". */
  downstreamUses: string[];
  /** Verified web/mobile split, shown as simple rows. */
  platformRoles?: { stage: string; where: string }[];
  /** Catalogue items whose platforms define this workflow's availability. */
  catalogueItemIds: string[];
  /** Catalogue item whose webRoute becomes the product-action button. */
  productItemId: string;
}

export const GUIDE_WORKFLOWS: GuideWorkflow[] = [
  {
    areaKey: "pins",
    intro:
      "A Pin records something at the exact place it happens in the vineyard, and follows it through until it is resolved.",
    sequence: ["Observe", "Drop Pin", "Add Details", "Action", "Complete", "History"],
    steps: [
      {
        title: "Find something in the vineyard",
        body: "Someone working in the vineyard notices something that needs attention or is worth recording.",
        examples: [
          "Broken post",
          "Irrigation leak",
          "Pest or disease observation",
          "Damaged vine",
          "Repair requirement",
          "General observation",
        ],
      },
      {
        title: "Drop a Pin",
        body: "The Pin is recorded from the mobile app at the spot where you are standing, and attached to the vineyard block and row it belongs to.",
        where: "iOS / Android",
        imageKey: "pins.step.drop",
        imageAlt: "Dropping a pin in the VineTrack mobile app",
      },
      {
        title: "Add information",
        body: "Choose the pin type and add the detail that makes it useful later.",
        examples: ["Pin type", "Notes", "Photos", "Priority where supported"],
        imageKey: "pins.step.details",
        imageAlt: "Adding notes and photos to a pin",
      },
      {
        title: "Assign or action it",
        body: "A Pin can become work the team follows up, so a repair or observation is not left sitting in someone's memory.",
      },
      {
        title: "Complete the Pin",
        body: "Once the repair or action is done, the Pin is closed in the mobile app.",
        where: "iOS / Android",
        imageKey: "pins.step.complete",
        imageAlt: "Completing a pin in the VineTrack mobile app",
      },
      {
        title: "Keep the history",
        body: "Completed Pins stay part of the vineyard record rather than disappearing, so you can see what happened and where.",
      },
    ],
    recordedItems: [
      "Location in the vineyard",
      "Block and row context",
      "Pin type",
      "Notes and photos",
      "Status and completion history",
    ],
    downstreamUses: [
      "A permanent vineyard history of repairs and observations",
      "Follow-up work for the team",
      "Portal review and reporting of open and completed items",
    ],
    platformRoles: [
      { stage: "Record & complete", where: "iOS / Android" },
      { stage: "Review & report", where: "Web Portal" },
    ],
    catalogueItemIds: ["field.pins"],
    productItemId: "field.pins",
  },
  {
    areaKey: "trips",
    intro:
      "A Trip records machinery and field activity while the work is happening, and turns it into operational history.",
    sequence: ["Choose Work", "Start", "Track", "Perform", "Complete", "Record"],
    steps: [
      {
        title: "Select the work",
        body: "Choose the type of work you are about to do before you begin, so the record is filed correctly.",
      },
      {
        title: "Start the Trip",
        body: "The operator starts the trip from the mobile app in the vineyard.",
        where: "iOS / Android",
        imageKey: "trips.step.start",
        imageAlt: "Starting a field trip in the VineTrack mobile app",
      },
      {
        title: "VineTrack records the work",
        body: "While you work, VineTrack captures the path travelled, the time taken and the vineyard context.",
        examples: ["GPS path", "Time", "Machinery activity", "Blocks and rows worked"],
        imageKey: "trips.step.tracking",
        imageAlt: "Live GPS tracking of a field trip",
      },
      {
        title: "Do the vineyard work",
        body: "Carry out the job as normal — the trip keeps recording in the background.",
        examples: ["Mowing", "Slashing", "Cultivation", "General maintenance"],
      },
      {
        title: "Complete the Trip",
        body: "The operator finishes the trip and confirms the record.",
        where: "iOS / Android",
        imageKey: "trips.step.complete",
        imageAlt: "Completing a field trip",
      },
      {
        title: "Operational history",
        body: "The completed Trip becomes part of your equipment and activity history. Spray work uses a specialised Spray Trip workflow, explained in the Spray guide.",
      },
    ],
    recordedItems: [
      "Field activity and work type",
      "GPS path through the vineyard",
      "Time taken",
      "Machinery and operator context",
      "Blocks and rows covered",
    ],
    downstreamUses: [
      "Operational and equipment activity history",
      "Coverage of which blocks and rows were worked",
      "Portal reporting on field activity",
    ],
    platformRoles: [
      { stage: "Start, track & complete", where: "iOS / Android" },
      { stage: "Review & report", where: "Web Portal" },
    ],
    catalogueItemIds: ["field.trips"],
    productItemId: "field.trips",
  },
  {
    areaKey: "sprays",
    intro:
      "Spray planning and spraying are one connected workflow: you plan the application, prepare the job, apply it in the vineyard, and keep the finished spray record.",
    sequence: ["Plan", "Blocks", "Products", "Apply", "Complete", "Spray Record"],
    steps: [
      {
        title: "Plan the application",
        body: "Start from the Spray Planner or create a spray job — you can also start from a saved template you use every season.",
        where: "Web Portal",
        imageKey: "sprays.step.plan",
        imageAlt: "Planning a spray application in the VineTrack portal",
      },
      {
        title: "Select vineyard blocks",
        body: "Choose the area to be treated. The blocks you pick define the job and everything that follows.",
      },
      {
        title: "Add products and application settings",
        body: "Add the products you are applying, the rates and the water or application configuration for the job.",
        examples: ["Products and chemicals", "Rate information", "Water and application settings", "Equipment"],
        imageKey: "sprays.step.products",
        imageAlt: "Adding products and application settings to a spray job",
      },
      {
        title: "Perform the spray",
        body: "The operator carries out the spray in the vineyard using the mobile app and the chosen equipment.",
        where: "iOS / Android",
        imageKey: "sprays.step.field",
        imageAlt: "Performing a spray in the vineyard",
      },
      {
        title: "Complete the job",
        body: "Confirm what was actually applied, so the record reflects the real work rather than the plan.",
      },
      {
        title: "Keep the spray record",
        body: "The completed spray becomes part of your permanent spray history and feeds reporting and exports.",
        imageKey: "sprays.step.record",
        imageAlt: "A completed spray record in the VineTrack portal",
      },
    ],
    recordedItems: [
      "Blocks treated",
      "Products applied",
      "Rates and application information",
      "Equipment used",
      "The completed spray record",
    ],
    downstreamUses: [
      "Spray records kept for compliance",
      "Spray reporting across the season",
      "Exports for auditors and processors",
    ],
    platformRoles: [
      { stage: "Plan & prepare", where: "Web Portal" },
      { stage: "Perform", where: "iOS / Android" },
      { stage: "Review, report & export", where: "Web Portal" },
    ],
    catalogueItemIds: ["field.spray_planner", "field.spray_jobs", "field.spray_trips"],
    productItemId: "field.spray_jobs",
  },
  {
    areaKey: "work-tasks",
    intro:
      "Work Tasks connect planned vineyard work with the people, labour and machinery that carry it out — and with what it cost.",
    sequence: ["Create", "Assign", "Perform", "Record", "Track", "Complete"],
    steps: [
      {
        title: "Create the task",
        body: "Set up the work that needs doing and where in the vineyard it applies.",
        examples: ["Pruning", "Canopy work", "Vineyard maintenance", "Picking", "General field work"],
        imageKey: "work-tasks.step.create",
        imageAlt: "Creating a work task in the VineTrack portal",
      },
      {
        title: "Assign people and resources",
        body: "Add the workers and machinery involved so the task reflects who is doing the work.",
        imageKey: "work-tasks.step.assign",
        imageAlt: "Assigning people to a work task",
      },
      {
        title: "Do the work",
        body: "Workers and operators carry out the vineyard task.",
      },
      {
        title: "Record labour and machinery",
        body: "Capture hours worked or piece-rate output, plus the machinery used on the task.",
        examples: ["Hours worked", "Piece rate", "Machine time"],
      },
      {
        title: "Track progress",
        body: "Follow the task while it is underway, so you can see how the work is going before it finishes.",
        imageKey: "work-tasks.step.progress",
        imageAlt: "Tracking work task progress",
      },
      {
        title: "Complete and report",
        body: "Completed work flows into activity, labour and cost reporting.",
        imageKey: "work-tasks.step.complete",
        imageAlt: "A completed work task with labour and cost detail",
      },
    ],
    recordedItems: [
      "The task and the blocks it covers",
      "Workers assigned",
      "Labour — hours or piece rate",
      "Machinery used",
      "Progress and completion",
    ],
    downstreamUses: [
      "Activity reporting",
      "Labour reporting",
      "Cost reporting per block and per job",
    ],
    platformRoles: [
      { stage: "Create & assign", where: "Web Portal" },
      { stage: "Perform & record", where: "iOS / Android" },
      { stage: "Track, cost & report", where: "Web Portal" },
    ],
    catalogueItemIds: ["field.work_tasks"],
    productItemId: "field.work_tasks",
  },
];

export function guideWorkflow(areaKey?: string): GuideWorkflow | undefined {
  if (!areaKey) return undefined;
  return GUIDE_WORKFLOWS.find((w) => w.areaKey === areaKey);
}

const PLATFORM_ORDER: GuidePlatform[] = ["ios", "android", "web"];

/** Platforms verified by the catalogue for this workflow. */
export function workflowPlatforms(workflow: GuideWorkflow): GuidePlatform[] {
  const found = new Set<GuidePlatform>();
  for (const id of workflow.catalogueItemIds) {
    const item = HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === id);
    item?.platforms.forEach((p) => found.add(p));
  }
  return PLATFORM_ORDER.filter((p) => found.has(p));
}

/** The single product action for this workflow, from the catalogue. */
export function workflowProductAction(
  workflow: GuideWorkflow,
): { label: string; route: string } | undefined {
  const item = HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === workflow.productItemId);
  if (!item?.webRoute) return undefined;
  return { label: `Open ${item.title}`, route: item.webRoute };
}
