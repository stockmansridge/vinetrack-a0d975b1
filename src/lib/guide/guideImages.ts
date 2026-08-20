// How VineTrack Works — guide image slot definitions (Stage 2.9, extended in Stage 4A).
//
// These are STABLE KEYS, never display titles. One area key feeds both the
// landing row image and that area's drill-down hero, so a System Admin uploads
// once.
//
// Stage 4A adds WORKFLOW step image keys (`<area>.step.<name>`) used by the
// visual workflow guides. They reuse the exact same persistence mechanism —
// no second image-management system, no schema changes.

/** Landing row + drill-down hero images. */
export type GuideAreaImageKey =
  | "hero"
  | "setup"
  | "pins"
  | "trips"
  | "sprays"
  | "work-tasks"
  | "operational-tools"
  | "reports";

/** Stage 4A workflow step screenshots, shown below the drill-down hero. */
export type GuideWorkflowImageKey =
  | "pins.step.drop"
  | "pins.step.details"
  | "pins.step.complete"
  | "trips.step.start"
  | "trips.step.tracking"
  | "trips.step.complete"
  | "sprays.step.plan"
  | "sprays.step.products"
  | "sprays.step.field"
  | "sprays.step.record"
  | "work-tasks.step.create"
  | "work-tasks.step.assign"
  | "work-tasks.step.progress"
  | "work-tasks.step.complete";

/**
 * Stage 4B — one primary image per Operational Tool guide. The key uses the
 * stable shared OperationalToolCatalog ID so the slot, the route and the
 * catalogue entry always agree.
 */
export type GuideToolImageKey =
  | "tool.work_tasks"
  | "tool.equipment_maintenance"
  | "tool.fuel_log"
  | "tool.irrigation_advisor"
  | "tool.disease_risk"
  | "tool.yield_records"
  | "tool.growth_stages"
  | "tool.optimal_ripeness"
  | "tool.cost_reports"
  | "tool.fertiliser_calculator"
  | "tool.pruning_tracker"
  | "tool.irrigation_records"
  | "tool.resistance_planner";

/** Stage 4B — a small number of supporting visuals on the Reports guide. */
export type GuideReportImageKey =
  | "reports.activity"
  | "reports.costs"
  | "reports.sprays";

export type GuideImageKey =
  | GuideAreaImageKey
  | GuideWorkflowImageKey
  | GuideToolImageKey
  | GuideReportImageKey;


export type GuideImageFocus = "left" | "center" | "right";

/**
 * How the asset should be presented. Stored in code (not the database) so no
 * schema is needed for the distinction.
 *  - `photo`      → object-fit: cover (vineyard photography)
 *  - `screenshot` → object-fit: contain on a neutral surface (real app UI)
 */
export type GuideImageKind = "photo" | "screenshot";

export interface GuideImageSlot {
  key: GuideImageKey;
  label: string;
  usage: string;
  guidance: string;
  minWidth: number;
  defaultFocus: GuideImageFocus;
  /** Admin grouping — the guide area this slot belongs to. */
  group: string;
  groupLabel: string;
  kind: GuideImageKind;
  /** True for the landing row / drill-down hero image of an area. */
  primary?: boolean;
}

const AREA_SLOTS: GuideImageSlot[] = [
  {
    key: "hero",
    label: "Hero",
    usage: "How VineTrack Works landing hero banner",
    guidance:
      "Wide landscape image — vineyard, tractor, devices — with the interesting content biased to the right (the left side sits under the text fade).",
    minWidth: 1600,
    defaultFocus: "right",
    group: "landing",
    groupLabel: "Landing page",
    kind: "photo",
    primary: true,
  },
  {
    key: "setup",
    label: "Getting Started — Setup",
    usage: "Landing row + Setup guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
    group: "setup",
    groupLabel: "Getting Started — Setup",
    kind: "photo",
    primary: true,
  },
  {
    key: "pins",
    label: "Pins, Repairs & Observations",
    usage: "Landing row + Pins guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
    group: "pins",
    groupLabel: "Pins, Repairs & Observations",
    kind: "photo",
    primary: true,
  },
  {
    key: "trips",
    label: "Field Trips",
    usage: "Landing row + Trips guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
    group: "trips",
    groupLabel: "Field Trips",
    kind: "photo",
    primary: true,
  },
  {
    key: "sprays",
    label: "Spray Planning & Sprays",
    usage: "Landing row + Sprays guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
    group: "sprays",
    groupLabel: "Spray Planning & Sprays",
    kind: "photo",
    primary: true,
  },
  {
    key: "work-tasks",
    label: "Work Tasks",
    usage: "Landing row + Work Tasks guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
    group: "work-tasks",
    groupLabel: "Work Tasks",
    kind: "photo",
    primary: true,
  },
  {
    key: "operational-tools",
    label: "Operational Tools",
    usage: "Landing row + Operational Tools guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
    group: "operational-tools",
    groupLabel: "Operational Tools",
    kind: "photo",
    primary: true,
  },
  {
    key: "reports",
    label: "Reports & Insights",
    usage: "Landing row + Reports guide hero",
    guidance: "Landscape image with useful content across the frame.",
    minWidth: 1000,
    defaultFocus: "center",
    group: "reports",
    groupLabel: "Reports & Insights",
    kind: "photo",
    primary: true,
  },
];

function workflowSlot(
  key: GuideWorkflowImageKey,
  group: string,
  groupLabel: string,
  label: string,
  usage: string,
  kind: GuideImageKind = "screenshot",
): GuideImageSlot {
  return {
    key,
    label,
    usage,
    guidance:
      kind === "screenshot"
        ? "A real VineTrack screenshot for this step. Shown whole (never cropped) on a neutral surface."
        : "Real vineyard photography for this step.",
    minWidth: kind === "screenshot" ? 600 : 1000,
    defaultFocus: "center",
    group,
    groupLabel,
    kind,
  };
}

const WORKFLOW_SLOTS: GuideImageSlot[] = [
  workflowSlot("pins.step.drop", "pins", "Pins, Repairs & Observations", "Drop a Pin", "Pins guide — step 2"),
  workflowSlot("pins.step.details", "pins", "Pins, Repairs & Observations", "Add information", "Pins guide — step 3"),
  workflowSlot("pins.step.complete", "pins", "Pins, Repairs & Observations", "Complete the Pin", "Pins guide — step 5"),

  workflowSlot("trips.step.start", "trips", "Field Trips", "Start the Trip", "Trips guide — step 2"),
  workflowSlot("trips.step.tracking", "trips", "Field Trips", "Recording the work", "Trips guide — step 3"),
  workflowSlot("trips.step.complete", "trips", "Field Trips", "Complete the Trip", "Trips guide — step 5"),

  workflowSlot("sprays.step.plan", "sprays", "Spray Planning & Sprays", "Plan the application", "Sprays guide — step 1"),
  workflowSlot("sprays.step.products", "sprays", "Spray Planning & Sprays", "Products & settings", "Sprays guide — step 3"),
  workflowSlot("sprays.step.field", "sprays", "Spray Planning & Sprays", "Perform the spray", "Sprays guide — step 4"),
  workflowSlot("sprays.step.record", "sprays", "Spray Planning & Sprays", "The spray record", "Sprays guide — step 6"),

  workflowSlot("work-tasks.step.create", "work-tasks", "Work Tasks", "Create the task", "Work Tasks guide — step 1"),
  workflowSlot("work-tasks.step.assign", "work-tasks", "Work Tasks", "Assign people", "Work Tasks guide — step 2"),
  workflowSlot("work-tasks.step.progress", "work-tasks", "Work Tasks", "Track progress", "Work Tasks guide — step 5"),
  workflowSlot("work-tasks.step.complete", "work-tasks", "Work Tasks", "Complete & report", "Work Tasks guide — step 6"),
];

/** Stage 4B — one primary image per Operational Tool guide. */
const TOOL_SLOTS: GuideImageSlot[] = (
  [
    ["tool.work_tasks", "Work Tasks"],
    ["tool.equipment_maintenance", "Maintenance Log"],
    ["tool.fuel_log", "Fuel Log"],
    ["tool.irrigation_advisor", "Irrigation Advisor"],
    ["tool.disease_risk", "Disease Risk"],
    ["tool.yield_records", "Yields"],
    ["tool.growth_stages", "Growth Stage Records"],
    ["tool.optimal_ripeness", "Optimal Ripeness"],
    ["tool.cost_reports", "Cost Reports"],
    ["tool.fertiliser_calculator", "Fertiliser Calculator"],
    ["tool.pruning_tracker", "Pruning Tracker"],
    ["tool.irrigation_records", "Irrigation Records"],
    ["tool.resistance_planner", "Resistance Planner"],
  ] as [GuideToolImageKey, string][]
).map(([key, label]) => ({
  key,
  label,
  usage: `${label} tool guide hero`,
  guidance:
    "A real VineTrack screenshot or vineyard photo for this tool. Shown whole on a neutral surface.",
  minWidth: 800,
  defaultFocus: "center" as GuideImageFocus,
  group: "operational-tools",
  groupLabel: "Operational Tools",
  kind: "screenshot" as GuideImageKind,
}));

/** Stage 4B — a few supporting visuals on the Reports & Insights guide. */
const REPORT_SLOTS: GuideImageSlot[] = (
  [
    ["reports.activity", "Activity reporting"],
    ["reports.costs", "Cost & labour reporting"],
    ["reports.sprays", "Spray records & compliance"],
  ] as [GuideReportImageKey, string][]
).map(([key, label]) => ({
  key,
  label,
  usage: `Reports guide — ${label.toLowerCase()} example`,
  guidance: "A real VineTrack report screenshot. Shown whole (never cropped).",
  minWidth: 600,
  defaultFocus: "center" as GuideImageFocus,
  group: "reports",
  groupLabel: "Reports & Insights",
  kind: "screenshot" as GuideImageKind,
}));

export const GUIDE_IMAGE_SLOTS: GuideImageSlot[] = [
  ...AREA_SLOTS,
  ...WORKFLOW_SLOTS,
  ...TOOL_SLOTS,
  ...REPORT_SLOTS,
];


export function guideImageSlot(key: string): GuideImageSlot | undefined {
  return GUIDE_IMAGE_SLOTS.find((s) => s.key === key);
}

export interface GuideImageGroup {
  group: string;
  groupLabel: string;
  primary: GuideImageSlot[];
  workflow: GuideImageSlot[];
  /** Label for the collapsed set of secondary slots in this group. */
  secondaryLabel: string;
}

const SECONDARY_LABEL: Record<string, string> = {
  "operational-tools": "Tool images",
  reports: "Supporting report images",
};

/** Slots grouped by guide area, for the System Admin manager. */
export function guideImageGroups(): GuideImageGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, GuideImageGroup>();
  for (const slot of GUIDE_IMAGE_SLOTS) {
    let g = byGroup.get(slot.group);
    if (!g) {
      g = {
        group: slot.group,
        groupLabel: slot.groupLabel,
        primary: [],
        workflow: [],
        secondaryLabel: SECONDARY_LABEL[slot.group] ?? "Workflow images",
      };
      byGroup.set(slot.group, g);
      order.push(slot.group);
    }
    (slot.primary ? g.primary : g.workflow).push(slot);
  }
  return order.map((k) => byGroup.get(k)!);
}


/** CSS object-position value for a focus setting. */
export function focusToObjectPosition(focus: GuideImageFocus | undefined): string {
  switch (focus) {
    case "left":
      return "left center";
    case "right":
      return "right center";
    default:
      return "center center";
  }
}

export const GUIDE_IMAGE_ACCEPT = ["image/jpeg", "image/png", "image/webp"];
export const GUIDE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Returns a friendly error string, or null when the file is acceptable. */
export function validateGuideImageFile(file: File): string | null {
  const type = (file.type || "").toLowerCase();
  if (!GUIDE_IMAGE_ACCEPT.includes(type)) {
    return "Unsupported file type. Please upload a JPEG, PNG or WebP image.";
  }
  if (file.size > GUIDE_IMAGE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That image is ${mb} MB. Please upload an image of 10 MB or less.`;
  }
  return null;
}
