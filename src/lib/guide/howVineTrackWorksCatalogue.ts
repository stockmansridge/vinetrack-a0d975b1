// How VineTrack Works — guide catalogue (Stage 2).
//
// PURPOSE: this catalogue *describes* the VineTrack platform for the guide page.
// It is deliberately NOT a navigation or permission authority:
//   - actual access is enforced by routes, `canAccessRoute`, `RequireSystemAdmin`,
//     `useIsSystemAdmin()`, `get_irrigation_capabilities` / `is_irrigated` and RLS.
//   - nothing here grants, hides or checks a permission. `visibilityGate` is a
//     presentation hint only (it marks internal cards for the System Admin preview).
//
// Platform availability is taken from the accepted Stage 1 + Stage 1B audits
// (docs/how-vinetrack-works-stage1-audit.md,
//  docs/how-vinetrack-works-stage1b-cross-platform.md).
//
// `mobileFeatureKey` values for Operational Tools are the 13 stable IDs shared by
// the iOS and Android `OperationalToolCatalog` (and `sql/159` display order).

export type GuidePlatform = "ios" | "android" | "web";

export type GuideAvailability =
  | "available"
  | "internal"
  | "coming_soon"
  | "unclassified";

export type GuideImportance =
  | "required"
  | "recommended"
  | "optional"
  | "conditional";

export type GuideSectionId =
  | "core_setup"
  | "field_workflows"
  | "operational_tools"
  | "maps_intelligence"
  | "reports_management"
  | "platform_advanced";

export interface HowVineTrackWorksItem {
  id: string;
  section: GuideSectionId;
  title: string;
  shortDescription: string;
  platforms: GuidePlatform[];
  /** Only set when a real, verified portal route exists. Never invent one. */
  webRoute?: string;
  /** Stable shared iOS/Android OperationalToolCatalog id, where applicable. */
  mobileFeatureKey?: string;
  importance?: GuideImportance;
  availability: GuideAvailability;
  /** Presentation hint only — never used to grant or deny access. */
  visibilityGate?: "system_admin";
  /** Reserved for Stage 3 setup-health wiring. No calculation happens in Stage 2. */
  setupHealthKey?: string;
  /** Hook for the future visual library (screenshots, photography, diagrams). */
  visualKey?: string;
  /** Sub-points shown inside a card so we don't create a card per database field. */
  subItems?: string[];
  displayOrder: number;
}

export interface GuideSectionMeta {
  id: GuideSectionId;
  title: string;
  description: string;
  displayOrder: number;
}

export const GUIDE_SECTIONS: GuideSectionMeta[] = [
  {
    id: "core_setup",
    title: "Core Setup",
    description:
      "The foundations every VineTrack vineyard needs. Get these right and every workflow, calculation and report downstream is accurate.",
    displayOrder: 1,
  },
  {
    id: "field_workflows",
    title: "Field Workflows",
    description:
      "How work actually flows through VineTrack — planned in the portal, performed in the field on mobile, recorded, completed and reported.",
    displayOrder: 2,
  },
  {
    id: "operational_tools",
    title: "Operational Tools",
    description:
      "The shared VineTrack tool set. The same thirteen tools appear on the iOS and Android home grid; a subset also has a portal surface.",
    displayOrder: 3,
  },
  {
    id: "maps_intelligence",
    title: "Maps & Vineyard Intelligence",
    description:
      "Spatial features — vineyard mapping, boundaries, rows and in-field guidance.",
    displayOrder: 4,
  },
  {
    id: "reports_management",
    title: "Reports & Management",
    description:
      "Turning recorded work into activity, cost, labour, compliance and yield reporting — plus exports and team management.",
    displayOrder: 5,
  },
  {
    id: "platform_advanced",
    title: "Platform & Advanced",
    description:
      "VineTrack is one platform across three surfaces: iOS, Android and the web portal — plus integrations and support.",
    displayOrder: 6,
  },
];

/** The 13 stable operational tool IDs shared by iOS and Android. */
export const SHARED_OPERATIONAL_TOOL_IDS = [
  "work_tasks",
  "equipment_maintenance",
  "fuel_log",
  "irrigation_advisor",
  "disease_risk",
  "yield_records",
  "growth_stages",
  "optimal_ripeness",
  "cost_reports",
  "fertiliser_calculator",
  "pruning_tracker",
  "irrigation_records",
  "resistance_planner",
] as const;

export type SharedOperationalToolId = (typeof SHARED_OPERATIONAL_TOOL_IDS)[number];

const ALL: GuidePlatform[] = ["ios", "android", "web"];
const MOBILE: GuidePlatform[] = ["ios", "android"];

export const HOW_VINETRACK_WORKS_CATALOGUE: HowVineTrackWorksItem[] = [
  // ────────────────────────────────── Core Setup ──────────────────────────────
  {
    id: "core.vineyard",
    section: "core_setup",
    title: "Vineyard & Location",
    shortDescription:
      "Your vineyard profile, coordinates, growing-degree-day mode, region, country, currency and units. Everything else is calculated relative to these settings.",
    subItems: [
      "Vineyard details & logo",
      "Location and GDD calculation mode",
      "Region, country, currency & units",
    ],
    platforms: ALL,
    webRoute: "/setup/vineyard",
    importance: "required",
    availability: "available",
    setupHealthKey: "vineyard_profile",
    visualKey: "core.vineyard",
    displayOrder: 1,
  },
  {
    id: "core.blocks",
    section: "core_setup",
    title: "Blocks, Boundaries & Rows",
    shortDescription:
      "Define each block, draw its boundary, configure rows and vine counts. This is what makes area, rate, cost-per-hectare and productivity figures real.",
    subItems: [
      "Blocks / paddocks",
      "Mapped boundaries & hectares",
      "Row configuration & vine counts",
      "Soil profiles (optional)",
    ],
    platforms: ALL,
    webRoute: "/setup/paddocks",
    importance: "required",
    availability: "available",
    setupHealthKey: "blocks_boundaries_rows",
    visualKey: "core.blocks",
    displayOrder: 2,
  },
  {
    id: "core.planting",
    section: "core_setup",
    title: "Planting & Variety Information",
    shortDescription:
      "Varieties, clones and rootstocks allocated to each block, from the shared VineTrack catalogue. Drives yield, ripeness and reporting by variety.",
    platforms: ALL,
    webRoute: "/setup/grape-varieties",
    importance: "required",
    availability: "available",
    setupHealthKey: "planting_varieties",
    visualKey: "core.planting",
    displayOrder: 3,
  },
  {
    id: "core.weather",
    section: "core_setup",
    title: "Weather",
    shortDescription:
      "Connect a forecast source, weather station or sensors. Weather feeds rainfall history, irrigation planning, disease risk and spray records.",
    platforms: ALL,
    webRoute: "/setup/weather",
    importance: "required",
    availability: "available",
    setupHealthKey: "weather_source",
    visualKey: "core.weather",
    displayOrder: 4,
  },
  {
    id: "core.equipment",
    section: "core_setup",
    title: "Equipment",
    shortDescription:
      "Tractors, vineyard machines, spray equipment and other assets — with running costs so trips, work tasks and spray jobs can be costed.",
    subItems: [
      "Tractors",
      "Vineyard machines & implements",
      "Spray equipment",
      "Other equipment & assets",
    ],
    platforms: ALL,
    webRoute: "/setup/tractors",
    importance: "recommended",
    availability: "available",
    setupHealthKey: "equipment",
    visualKey: "core.equipment",
    displayOrder: 5,
  },
  {
    id: "core.team",
    section: "core_setup",
    title: "Team & Roles",
    shortDescription:
      "Invite owners, managers and workers, and define worker types / operator categories used for labour costing.",
    subItems: ["Members & invitations", "Roles & permissions", "Operator categories"],
    platforms: ALL,
    webRoute: "/team",
    importance: "required",
    availability: "available",
    setupHealthKey: "team",
    visualKey: "core.team",
    displayOrder: 6,
  },
  {
    id: "core.spray_setup",
    section: "core_setup",
    title: "Spray Setup",
    shortDescription:
      "Saved chemicals with verified label intelligence, sprayers and calibration, plus reusable spray job templates.",
    subItems: ["Saved chemicals & label intelligence", "Spray equipment", "Job templates"],
    platforms: ALL,
    webRoute: "/setup/chemicals",
    importance: "conditional",
    availability: "available",
    setupHealthKey: "spray_setup",
    visualKey: "core.spray",
    displayOrder: 7,
  },
  {
    id: "core.irrigation_setup",
    section: "core_setup",
    title: "Irrigation Setup",
    shortDescription:
      "Applies only to irrigated vineyards. Valves, zones and application rates so water use can be recorded and reported.",
    platforms: ALL,
    webRoute: "/irrigation/setup",
    importance: "conditional",
    availability: "available",
    setupHealthKey: "irrigation_setup",
    visualKey: "core.irrigation",
    displayOrder: 8,
  },
  {
    id: "core.preferences",
    section: "core_setup",
    title: "Operational Preferences",
    shortDescription:
      "Season start, enabled E-L growth stages, tank and yield defaults, and the quick-action buttons crews see in the field.",
    subItems: [
      "Season & E-L stage configuration",
      "Spray / tank & yield defaults",
      "Quick actions & button templates (mobile)",
    ],
    platforms: ALL,
    webRoute: "/setup/operational-preferences",
    importance: "recommended",
    availability: "available",
    visualKey: "core.preferences",
    displayOrder: 9,
  },

  // ─────────────────────────────── Field Workflows ────────────────────────────
  {
    id: "field.pins",
    section: "field_workflows",
    title: "Pins, Repairs & Observations",
    shortDescription:
      "Drop a pin where something needs attention — a repair, an observation or an issue — with photo, block and row context. Pins are closed in the mobile app.",
    platforms: ALL,
    webRoute: "/pins",
    importance: "recommended",
    availability: "available",
    visualKey: "field.pins",
    displayOrder: 1,
  },
  {
    id: "field.trips",
    section: "field_workflows",
    title: "Field Trips",
    shortDescription:
      "GPS-tracked passes through the vineyard on mobile — rows worked, hours, fuel and cost allocation — reviewed and reported in the portal.",
    platforms: ALL,
    webRoute: "/trips",
    importance: "recommended",
    availability: "available",
    visualKey: "field.trips",
    displayOrder: 2,
  },
  {
    id: "field.spray_trips",
    section: "field_workflows",
    title: "Spray Trips & Records",
    shortDescription:
      "The spray as it was actually applied — blocks, chemicals, rates, weather, WHP and REI — captured in the field and retained for compliance.",
    platforms: ALL,
    webRoute: "/spray-records",
    importance: "conditional",
    availability: "available",
    visualKey: "field.spray_trips",
    displayOrder: 3,
  },
  {
    id: "field.spray_jobs",
    section: "field_workflows",
    title: "Spray Jobs & Templates",
    shortDescription:
      "The guided spray workflow: application mode, blocks, target, growth stage, equipment, carrier, products and a live resistance check before the tank is filled.",
    platforms: ALL,
    webRoute: "/spray-jobs",
    importance: "conditional",
    availability: "available",
    visualKey: "field.spray_jobs",
    displayOrder: 4,
  },
  {
    id: "field.spray_planner",
    section: "field_workflows",
    title: "Spray Planner (Resistance Planner)",
    shortDescription:
      "Plan the season's FRAC rotation first, then create spray jobs from planned positions. VineTrack tracks plan → proposed → actual coverage and any deviation.",
    platforms: ALL,
    webRoute: "/tools/resistance-planner",
    mobileFeatureKey: "resistance_planner",
    importance: "optional",
    availability: "available",
    visualKey: "field.spray_planner",
    displayOrder: 5,
  },
  {
    id: "field.work_tasks",
    section: "field_workflows",
    title: "Work Tasks",
    shortDescription:
      "The cost record for vineyard work — labour lines, machine lines and piece-rate pruning — linked to blocks and to pruning activities.",
    platforms: ALL,
    webRoute: "/work-tasks",
    mobileFeatureKey: "work_tasks",
    importance: "recommended",
    availability: "available",
    visualKey: "field.work_tasks",
    displayOrder: 6,
  },
  {
    id: "field.pruning",
    section: "field_workflows",
    title: "Pruning Activities",
    shortDescription:
      "The operational record of pruning — rows, quarters, vines and skipped sections — with linked work tasks supplying labour and cost.",
    platforms: ALL,
    webRoute: "/tools/pruning-tracker",
    mobileFeatureKey: "pruning_tracker",
    importance: "optional",
    availability: "available",
    visualKey: "field.pruning",
    displayOrder: 7,
  },
  {
    id: "field.maintenance_fuel",
    section: "field_workflows",
    title: "Maintenance, Fuel & Damage",
    shortDescription:
      "Service and repair logs with photos, fuel purchases and refuelling, and damage records captured in the field.",
    subItems: ["Maintenance logs", "Fuel purchases & tractor fuel logs", "Damage records"],
    platforms: ALL,
    webRoute: "/maintenance",
    importance: "optional",
    availability: "available",
    visualKey: "field.maintenance",
    displayOrder: 8,
  },
  {
    id: "field.growth_yield",
    section: "field_workflows",
    title: "Growth Stage & Yield Recording",
    shortDescription:
      "E-L growth stage observations with reference photos, bunch-count sampling, yield estimates and the picking log of actual harvested fruit.",
    subItems: ["Growth stage records", "Yield sampling & estimates", "Picking log"],
    platforms: ALL,
    webRoute: "/yield",
    importance: "optional",
    availability: "available",
    visualKey: "field.yield",
    displayOrder: 9,
  },

  // ───────────────────────── Operational Tools (13 shared IDs) ────────────────
  {
    id: "tools.work_tasks",
    section: "operational_tools",
    title: "Work Tasks",
    shortDescription:
      "Log and calculate vineyard work — labour, machine time and piece rates — against blocks and activities.",
    platforms: ALL,
    webRoute: "/work-tasks",
    mobileFeatureKey: "work_tasks",
    availability: "available",
    visualKey: "tool.work_tasks",
    displayOrder: 1,
  },
  {
    id: "tools.equipment_maintenance",
    section: "operational_tools",
    title: "Maintenance Log",
    shortDescription:
      "Record repairs, servicing and jobs against tractors, machines and equipment, with photos and costs.",
    platforms: ALL,
    webRoute: "/maintenance",
    mobileFeatureKey: "equipment_maintenance",
    availability: "available",
    visualKey: "tool.maintenance",
    displayOrder: 2,
  },
  {
    id: "tools.fuel_log",
    section: "operational_tools",
    title: "Fuel Log",
    shortDescription:
      "Track fuel purchases and refuelling by tractor so machine running costs stay accurate.",
    platforms: ALL,
    webRoute: "/fuel",
    mobileFeatureKey: "fuel_log",
    availability: "available",
    visualKey: "tool.fuel",
    displayOrder: 3,
  },
  {
    id: "tools.irrigation_advisor",
    section: "operational_tools",
    title: "Irrigation Advisor",
    shortDescription:
      "Water planning using forecast, rainfall and canopy demand to suggest how much to apply and when.",
    platforms: ALL,
    webRoute: "/tools/irrigation",
    mobileFeatureKey: "irrigation_advisor",
    availability: "available",
    visualKey: "tool.irrigation_advisor",
    displayOrder: 4,
  },
  {
    id: "tools.disease_risk",
    section: "operational_tools",
    title: "Disease Risk",
    shortDescription:
      "Use vineyard conditions and weather information to assess Downy Mildew, Powdery Mildew and Botrytis pressure.",
    platforms: MOBILE,
    mobileFeatureKey: "disease_risk",
    availability: "available",
    visualKey: "tool.disease_risk",
    displayOrder: 5,
  },
  {
    id: "tools.yield_records",
    section: "operational_tools",
    title: "Yields",
    shortDescription:
      "Forecasting, bunch-count sampling and recording of actual harvested fruit by block, variety and picking session.",
    platforms: ALL,
    webRoute: "/yield",
    mobileFeatureKey: "yield_records",
    availability: "available",
    visualKey: "tool.yields",
    displayOrder: 6,
  },
  {
    id: "tools.growth_stages",
    section: "operational_tools",
    title: "Growth Stage Records",
    shortDescription:
      "E-L phenology observations with reference imagery and PDF export. Recorded in the field, reported in the portal.",
    platforms: ALL,
    webRoute: "/reports/growth-stage",
    mobileFeatureKey: "growth_stages",
    availability: "available",
    visualKey: "tool.growth_stages",
    displayOrder: 7,
  },
  {
    id: "tools.optimal_ripeness",
    section: "operational_tools",
    title: "Optimal Ripeness",
    shortDescription:
      "Growing-degree-day progress by variety against your harvest target, with the projected harvest window.",
    platforms: MOBILE,
    mobileFeatureKey: "optimal_ripeness",
    availability: "available",
    visualKey: "tool.optimal_ripeness",
    displayOrder: 8,
  },
  {
    id: "tools.cost_reports",
    section: "operational_tools",
    title: "Cost Reports",
    shortDescription:
      "Season, block and variety costing built from trips, work tasks, spray jobs, fuel and maintenance.",
    platforms: ALL,
    webRoute: "/reports/costs",
    mobileFeatureKey: "cost_reports",
    availability: "available",
    visualKey: "tool.cost_reports",
    displayOrder: 9,
  },
  {
    id: "tools.fertiliser_calculator",
    section: "operational_tools",
    title: "Fertiliser Calculator",
    shortDescription:
      "Work out application rates, pack quantities and costs for a fertiliser program across blocks.",
    platforms: ALL,
    webRoute: "/tools/fertiliser-calculator",
    mobileFeatureKey: "fertiliser_calculator",
    availability: "available",
    visualKey: "tool.fertiliser",
    displayOrder: 10,
  },
  {
    id: "tools.pruning_tracker",
    section: "operational_tools",
    title: "Pruning Tracker",
    shortDescription:
      "Track pruning progress, labour performance and vineyard completion — row by row, block by block.",
    platforms: ALL,
    webRoute: "/tools/pruning-tracker",
    mobileFeatureKey: "pruning_tracker",
    availability: "available",
    visualKey: "tool.pruning_tracker",
    displayOrder: 11,
  },
  {
    id: "tools.irrigation_records",
    section: "operational_tools",
    title: "Irrigation Records",
    shortDescription:
      "Water applied by valve, zone and block — recorded in the field and rolled up into irrigation reporting.",
    platforms: ALL,
    webRoute: "/irrigation",
    mobileFeatureKey: "irrigation_records",
    availability: "available",
    visualKey: "tool.irrigation_records",
    displayOrder: 12,
  },
  {
    id: "tools.resistance_planner",
    section: "operational_tools",
    title: "Resistance Planner",
    shortDescription:
      "Plan the season's FRAC rotation, check resistance rules live and drive spray jobs from the plan.",
    platforms: ALL,
    webRoute: "/tools/resistance-planner",
    mobileFeatureKey: "resistance_planner",
    availability: "available",
    visualKey: "tool.resistance_planner",
    displayOrder: 13,
  },

  // ───────────────────── Maps & Vineyard Intelligence ─────────────────────────
  {
    id: "maps.vineyard_map",
    section: "maps_intelligence",
    title: "Vineyard Map",
    shortDescription:
      "Satellite base map with blocks, boundaries, rows, pins and live location — available offline in the field.",
    platforms: ALL,
    webRoute: "/dashboard",
    availability: "available",
    visualKey: "maps.vineyard_map",
    displayOrder: 1,
  },
  {
    id: "maps.boundary_editor",
    section: "maps_intelligence",
    title: "Boundary & Row Editor",
    shortDescription:
      "Draw and correct block boundaries and row geometry, then derive hectares, row lengths and vine counts.",
    platforms: ALL,
    webRoute: "/setup/paddocks",
    availability: "available",
    visualKey: "maps.boundary_editor",
    displayOrder: 2,
  },
  {
    id: "maps.row_guidance",
    section: "maps_intelligence",
    title: "In-field Guidance & Offline Maps",
    shortDescription:
      "Row guidance, trail display, compass heading and cached map tiles so the apps keep working with no signal.",
    platforms: MOBILE,
    availability: "available",
    visualKey: "maps.row_guidance",
    displayOrder: 3,
  },
  {
    id: "maps.satellite_mapping",
    section: "maps_intelligence",
    title: "Mapping (Satellite Mapping)",
    shortDescription:
      "Satellite mapping workspace. Under active internal development — System Admin only and not offered to customers.",
    platforms: ["web"],
    webRoute: "/tools/satellite-mapping",
    availability: "internal",
    visibilityGate: "system_admin",
    visualKey: "maps.satellite_mapping",
    displayOrder: 4,
  },
  {
    id: "maps.crop_health",
    section: "maps_intelligence",
    title: "Crop Health / NDVI",
    shortDescription:
      "No implementation exists on iOS, Android or the portal. Retained as an unclassified internal entry pending a product decision — not a customer capability.",
    platforms: [],
    availability: "unclassified",
    visibilityGate: "system_admin",
    visualKey: "maps.crop_health",
    displayOrder: 5,
  },

  // ───────────────────────── Reports & Management ─────────────────────────────
  {
    id: "reports.activity",
    section: "reports_management",
    title: "Activity Reporting",
    shortDescription:
      "Trip reports, work task reports and pruning activity — what was done, where, by whom and how quickly.",
    subItems: ["Trip Reports", "Work Task Reports", "Pruning Activity"],
    platforms: ALL,
    webRoute: "/reports",
    availability: "available",
    visualKey: "reports.activity",
    displayOrder: 1,
  },
  {
    id: "reports.costs",
    section: "reports_management",
    title: "Cost & Labour Reporting",
    shortDescription:
      "Season, block and variety costs built from labour lines, machine lines, piece rates, fuel and maintenance.",
    platforms: ALL,
    webRoute: "/reports/costs",
    availability: "available",
    visualKey: "reports.costs",
    displayOrder: 2,
  },
  {
    id: "reports.spray",
    section: "reports_management",
    title: "Spray Records & Compliance",
    shortDescription:
      "Chemicals, rates, WHP/REI, weather and tank mix per application, plus yearly spray program exports.",
    platforms: ALL,
    webRoute: "/reports/spray",
    availability: "available",
    visualKey: "reports.spray",
    displayOrder: 3,
  },
  {
    id: "reports.yield",
    section: "reports_management",
    title: "Yield Analytics",
    shortDescription:
      "Estimated versus actual yield, year-on-year comparison and picking analysis by block, variety and clone.",
    platforms: ALL,
    webRoute: "/reports/yield",
    availability: "available",
    visualKey: "reports.yield",
    displayOrder: 4,
  },
  {
    id: "reports.environment",
    section: "reports_management",
    title: "Rainfall, Growth Stage & Irrigation Reporting",
    shortDescription:
      "Rainfall history and calendar, E-L growth stage history, and irrigation reporting where irrigation applies.",
    platforms: ALL,
    webRoute: "/reports/rainfall",
    availability: "available",
    visualKey: "reports.environment",
    displayOrder: 5,
  },
  {
    id: "reports.exports",
    section: "reports_management",
    title: "Documents & Exports",
    shortDescription:
      "Central launcher for PDF and CSV exports across trips, spray, pruning, growth stage and rainfall.",
    platforms: ALL,
    webRoute: "/reports/documents",
    availability: "available",
    visualKey: "reports.exports",
    displayOrder: 6,
  },
  {
    id: "reports.data_coverage",
    section: "reports_management",
    title: "Data Coverage",
    shortDescription:
      "Where vineyard data is complete and where it is missing. This is the basis for the future setup-health engine.",
    platforms: ["web"],
    webRoute: "/reports/data-coverage",
    availability: "available",
    visualKey: "reports.data_coverage",
    displayOrder: 7,
  },
  {
    id: "reports.team_management",
    section: "reports_management",
    title: "Team & Access Management",
    shortDescription:
      "Manage members, invitations and roles, and control who can see financial information such as rates and prices.",
    platforms: ALL,
    webRoute: "/team",
    availability: "available",
    visualKey: "reports.team",
    displayOrder: 8,
  },

  // ─────────────────────────── Platform & Advanced ────────────────────────────
  {
    id: "platform.ios",
    section: "platform_advanced",
    title: "VineTrack for iOS",
    shortDescription:
      "The field app: pins, GPS trips, spray recording, the thirteen operational tools, offline-first sync, alerts, quick actions and Face ID unlock.",
    subItems: [
      "Offline-first sync with pending-write queue",
      "GPS trips, row guidance & offline maps",
      "Alerts, quick actions & biometric unlock",
      "Operational tool grid (customisable)",
    ],
    platforms: ["ios"],
    availability: "available",
    visualKey: "platform.ios",
    displayOrder: 1,
  },
  {
    id: "platform.android",
    section: "platform_advanced",
    title: "VineTrack for Android",
    shortDescription:
      "The same field workflows and the same thirteen operational tools as iOS, with Android-specific extras such as self-service account deletion and canopy water rates.",
    subItems: [
      "Identical operational tool catalogue to iOS",
      "Offline-first sync & offline readiness check",
      "Fingerprint unlock, alerts & quick actions",
      "Android-only: account deletion, canopy water rates",
    ],
    platforms: ["android"],
    availability: "available",
    visualKey: "platform.android",
    displayOrder: 2,
  },
  {
    id: "platform.web",
    section: "platform_advanced",
    title: "Web Portal",
    shortDescription:
      "Where the vineyard is set up, work is planned, costs and compliance are reported, and the team and account are managed.",
    subItems: ["Setup", "Planning", "Reporting", "Management & administration"],
    platforms: ["web"],
    webRoute: "/dashboard",
    availability: "available",
    visualKey: "platform.web",
    displayOrder: 3,
  },
  {
    id: "platform.api",
    section: "platform_advanced",
    title: "API, Webhooks & Integrations",
    shortDescription:
      "Issue API clients and keys, subscribe to webhook events, review request logs and download the developer docs and Postman collection.",
    platforms: ["web"],
    webRoute: "/settings/integrations",
    availability: "available",
    visualKey: "platform.api",
    displayOrder: 4,
  },
  {
    id: "platform.support",
    section: "platform_advanced",
    title: "Support",
    shortDescription:
      "Send feedback, feature requests or issue reports from any platform. Requests are triaged by the VineTrack team.",
    platforms: ALL,
    availability: "available",
    visualKey: "platform.support",
    displayOrder: 5,
  },
];

export function guideItemsForSection(section: GuideSectionId): HowVineTrackWorksItem[] {
  return HOW_VINETRACK_WORKS_CATALOGUE.filter((i) => i.section === section).sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );
}

/** Items safe to show to a normal customer once the page is released. */
export function customerVisibleItems(): HowVineTrackWorksItem[] {
  return HOW_VINETRACK_WORKS_CATALOGUE.filter(
    (i) => !i.visibilityGate && i.availability === "available",
  );
}
