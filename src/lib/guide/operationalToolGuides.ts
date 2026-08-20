// How VineTrack Works — Stage 4B operational tool guides.
//
// One configuration entry per shared OperationalToolCatalog ID (the 13 stable
// IDs used by iOS and Android). Every tool guide renders through ONE shared
// component and ONE parameterised route — there are no per-tool page files.
//
// Platform availability and the "Open tool" destination are DERIVED from the
// verified catalogue (howVineTrackWorksCatalogue.ts), never hand-typed here, so
// a guide can never claim a surface or route the catalogue does not verify.
// Mobile-only tools therefore get no product action at all.
//
// Copy rules: only verified behaviour. Where the current platform information
// does not confirm a detail, the wording stays deliberately conservative.

import {
  HOW_VINETRACK_WORKS_CATALOGUE,
  SHARED_OPERATIONAL_TOOL_IDS,
  type GuidePlatform,
  type HowVineTrackWorksItem,
  type SharedOperationalToolId,
} from "@/lib/guide/howVineTrackWorksCatalogue";
import type { GuideToolImageKey } from "@/lib/guide/guideImages";

export interface OperationalToolGuide {
  /** Stable shared tool ID — also the URL slug. */
  toolId: SharedOperationalToolId;
  /** One sentence. Used on the catalogue card and the guide hero. */
  purpose: string;
  /** Plain-language framing at the top of the guide. */
  intro: string;
  /** "When you would use it" — real vineyard situations. */
  useCases: string[];
  /** "How it works" — 3–5 steps. */
  steps: string[];
  /** "What VineTrack records or calculates" — verified behaviour only. */
  recordedOrCalculated: string[];
  /** "What you get from it" — the outcome. */
  outcomes: string[];
  /** Guide image slot for the hero. */
  imageKey: GuideToolImageKey;
  /** Catalogue item that supplies platforms + the verified web route. */
  catalogueItemId: string;
  /** Shown only where the platform information records a real difference. */
  platformNote?: string;
}

const g = (
  toolId: SharedOperationalToolId,
  rest: Omit<OperationalToolGuide, "toolId" | "imageKey" | "catalogueItemId"> &
    Partial<Pick<OperationalToolGuide, "imageKey" | "catalogueItemId">>,
): OperationalToolGuide => ({
  toolId,
  imageKey: (rest.imageKey ?? (`tool.${toolId}` as GuideToolImageKey)),
  catalogueItemId: rest.catalogueItemId ?? `tools.${toolId}`,
  ...rest,
});

export const OPERATIONAL_TOOL_GUIDES: OperationalToolGuide[] = [
  g("work_tasks", {
    purpose: "Organise vineyard work and capture the labour and machinery behind it.",
    intro:
      "Work Tasks are how vineyard jobs are set up, worked and costed — hourly or piece rate, against the blocks the work covers.",
    useCases: [
      "Sending a crew out to do canopy work across several blocks",
      "Recording contractor or casual hours against a job",
      "Costing a piece-rate job such as pruning or thinning",
    ],
    steps: [
      "Create the task and choose the blocks it covers.",
      "Assign the people or team doing the work.",
      "Record labour — hours worked or piece-rate output — and any machinery used.",
      "Track the task while it is underway and complete it when finished.",
    ],
    recordedOrCalculated: [
      "The task, its blocks and its status",
      "Workers assigned to the task",
      "Labour lines — hours or piece rate",
      "Machinery time recorded against the task",
    ],
    outcomes: [
      "A record of what work was done, where and by whom",
      "Labour and machinery input for cost reporting",
      "Progress visibility before a job is finished",
    ],
  }),
  g("equipment_maintenance", {
    purpose: "Keep a service and repair history for tractors, machines and equipment.",
    intro:
      "The Maintenance Log records what has been serviced or repaired, when it happened and what it cost — so equipment history lives with the vineyard, not in a notebook.",
    useCases: [
      "Logging a tractor service so the next one is not missed",
      "Recording a breakdown repair and its cost",
      "Keeping photos of a fault for a mechanic or warranty claim",
    ],
    steps: [
      "Choose the tractor, machine or item of equipment.",
      "Record the job — service, repair or maintenance work.",
      "Add notes, photos and cost information.",
      "Review the maintenance history against that machine.",
    ],
    recordedOrCalculated: [
      "The machine or equipment item",
      "The maintenance or repair performed and its date",
      "Notes and photos",
      "Cost recorded against the job",
    ],
    outcomes: [
      "A complete service and repair history per machine",
      "Maintenance cost that feeds machinery cost reporting",
    ],
  }),
  g("fuel_log", {
    purpose: "Track fuel purchases and refuelling by machine so running costs stay real.",
    intro:
      "Fuel is one of the largest running costs in a vineyard. Recording purchases and refuelling by tractor keeps machinery costs accurate rather than estimated.",
    useCases: [
      "Recording a bulk diesel delivery",
      "Logging a refuel against the tractor that used it",
      "Checking what a machine has consumed across the season",
    ],
    steps: [
      "Record a fuel purchase or a refuelling event.",
      "Attach it to the tractor or machine involved.",
      "Enter the quantity and cost information.",
      "Review fuel use and cost by machine.",
    ],
    recordedOrCalculated: [
      "Fuel purchases",
      "Refuelling events per tractor",
      "Quantity and cost recorded",
    ],
    outcomes: [
      "Accurate machinery running costs",
      "Fuel input into season and block cost reporting",
    ],
  }),
  g("irrigation_advisor", {
    purpose: "Work out how much water to apply using forecast evapotranspiration and rainfall.",
    intro:
      "The Irrigation Advisor turns forecast weather into an irrigation recommendation: it takes forecast ETo and rainfall, applies your crop coefficient and rainfall-effectiveness settings, and converts the resulting deficit into a run time at your application rate.",
    useCases: [
      "Deciding whether a block needs water this week",
      "Converting a water requirement into an irrigation run time",
      "Checking whether forecast rainfall covers expected crop use",
    ],
    steps: [
      "Confirm the block and its irrigation application rate.",
      "Load the forecast period — daily ETo and rainfall are retrieved for your vineyard location.",
      "Adjust the crop coefficient, soil buffer and rainfall effectiveness if your settings differ.",
      "Review the calculated deficit and the recommended run time.",
    ],
    recordedOrCalculated: [
      "Forecast ETo and rainfall for the vineyard location",
      "Crop water use from the crop coefficient",
      "Effective rainfall from your rainfall-effectiveness setting",
      "The water deficit and the recommended irrigation duration",
    ],
    outcomes: [
      "A clear irrigation recommendation in hours and minutes",
      "A defensible basis for the irrigation decision, rather than a guess",
    ],
    platformNote:
      "The calculation is a planning aid. It does not create an irrigation record — water actually applied is recorded in Irrigation Records.",
  }),
  g("disease_risk", {
    purpose: "Assess Downy Mildew, Powdery Mildew and Botrytis pressure from vineyard conditions.",
    intro:
      "Disease Risk uses vineyard conditions and weather information to indicate current pressure for the three diseases that drive most spray decisions.",
    useCases: [
      "Checking pressure before deciding to bring a spray forward",
      "Understanding why conditions have become risky after rain",
      "Discussing the season's disease pressure with the team",
    ],
    steps: [
      "Open Disease Risk in the mobile app.",
      "Review current pressure for Downy Mildew, Powdery Mildew and Botrytis.",
      "Use the indication alongside your own vineyard observations and Pins.",
      "Feed the decision into spray planning where appropriate.",
    ],
    recordedOrCalculated: [
      "An indicative risk assessment for Downy Mildew, Powdery Mildew and Botrytis",
      "Based on vineyard conditions and weather information",
    ],
    outcomes: [
      "An informed view of disease pressure when planning protection",
      "Support for spray timing decisions — it is guidance, not a spray instruction",
    ],
    platformNote:
      "Disease Risk is a mobile tool. There is no portal screen for it — spray decisions it informs are planned and recorded in the portal spray workflow.",
  }),
  g("yield_records", {
    purpose: "Forecast, sample and record actual harvested fruit by block and variety.",
    intro:
      "Yields covers the whole production picture: an estimate before harvest, bunch-count sampling to test it, and the picking records of what was actually harvested.",
    useCases: [
      "Estimating a block's crop before harvest",
      "Running bunch counts to sharpen the estimate",
      "Recording what each picking session actually delivered",
    ],
    steps: [
      "Set or review the yield estimate for the block and variety.",
      "Record bunch-count sampling in the field to test the estimate.",
      "Record actual harvested fruit as picking sessions occur.",
      "Compare estimated against actual production.",
    ],
    recordedOrCalculated: [
      "Yield estimates by block and variety",
      "Bunch-count sampling sessions and sampling density",
      "Picking records for fruit actually harvested",
      "Estimated versus actual comparison",
    ],
    outcomes: [
      "A production record per block, variety and picking session",
      "Yield analytics, including year-on-year comparison",
    ],
    platformNote:
      "Financial values such as price per tonne are visible only to owners and managers.",
  }),
  g("growth_stages", {
    purpose: "Record E-L phenology observations against blocks and varieties.",
    intro:
      "Growth Stage Records capture where the vineyard is in the season using the E-L scale, with reference imagery to keep observations consistent between people.",
    useCases: [
      "Recording budburst, flowering or veraison as it happens",
      "Keeping phenology consistent across blocks and staff",
      "Supplying growth stage information for a spray record",
    ],
    steps: [
      "Record the observation in the field against the block and variety.",
      "Choose the E-L stage, using the reference images as a guide.",
      "Review the growth stage history in the portal.",
      "Export the growth stage report when you need it on paper.",
    ],
    recordedOrCalculated: [
      "E-L growth stage observations by block and variety",
      "Observation date and vineyard context",
      "Growth stage history across the season",
    ],
    outcomes: [
      "A phenology record for the season",
      "Growth stage context for spray records and planning",
      "A PDF growth stage report",
    ],
    platformNote:
      "Observations are recorded in the mobile apps; the portal is where the history is reviewed and exported.",
  }),
  g("optimal_ripeness", {
    purpose: "Track growing-degree-day progress by variety against your harvest target.",
    intro:
      "Optimal Ripeness follows accumulated growing degree days per variety against the target for that variety, and shows the projected harvest window.",
    useCases: [
      "Judging how far a variety is from its harvest target",
      "Planning picking order across varieties",
      "Sanity-checking a season that is running early or late",
    ],
    steps: [
      "Open Optimal Ripeness in the mobile app.",
      "Review growing-degree-day progress for each variety.",
      "Compare progress against the variety's harvest target.",
      "Use the projected window when planning harvest.",
    ],
    recordedOrCalculated: [
      "Accumulated growing degree days by variety",
      "Progress against the variety harvest target",
      "A projected harvest window",
    ],
    outcomes: [
      "An early view of harvest timing by variety",
      "Support for picking sequence and logistics planning",
    ],
    platformNote:
      "Optimal Ripeness is a mobile tool. There is no portal screen for it. It depends on the vineyard location and GDD settings in Setup.",
  }),
  g("cost_reports", {
    purpose: "See what the season, each block and each variety actually cost.",
    intro:
      "Cost Reports do not ask you to enter costs — they are built from the work already recorded: work tasks, trips, spray jobs, fuel and maintenance.",
    useCases: [
      "Understanding the cost per hectare of a block",
      "Comparing cost by variety across the season",
      "Reviewing where labour and machinery spend is going",
    ],
    steps: [
      "Record work normally — tasks, trips, sprays, fuel and maintenance.",
      "Open Cost Reports and choose the season and scope.",
      "Review costs by season, block and variety.",
      "Export the figures to PDF or CSV where you need them.",
    ],
    recordedOrCalculated: [
      "Labour cost from work task labour lines and piece rates",
      "Machinery cost from machine time recorded on work",
      "Fuel and maintenance cost recorded against machines",
      "Roll-ups by season, block and variety",
    ],
    outcomes: [
      "Cost per block, variety and season built from real recorded work",
      "PDF and CSV exports",
    ],
    platformNote:
      "Cost information is restricted — access to financial detail depends on your role and the vineyard's costing access.",
  }),
  g("fertiliser_calculator", {
    purpose: "Work out fertiliser rates, quantities and costs for a program across blocks.",
    intro:
      "The Fertiliser Calculator turns a planned application into the practical numbers: how much product per block, how much in total, and what it costs.",
    useCases: [
      "Planning a fertiliser application across several blocks",
      "Working out how many bags or litres to order",
      "Estimating the cost of a nutrition program",
    ],
    steps: [
      "Choose the blocks the application covers.",
      "Enter the product and the application rate.",
      "Review the calculated quantities and costs.",
      "Save the record so the plan is kept.",
    ],
    recordedOrCalculated: [
      "Application rate applied across the selected block areas",
      "Total product quantity required",
      "Cost of the application where cost information is entered",
      "Saved fertiliser records with their status",
    ],
    outcomes: [
      "Accurate ordering and application quantities",
      "A saved record of the fertiliser program",
    ],
    platformNote:
      "The portal surface is currently intended for administrators. On mobile it is available to the wider team.",
  }),
  g("pruning_tracker", {
    purpose: "Track pruning progress and labour performance across the vineyard.",
    intro:
      "Pruning is the biggest labour job of the year. The Pruning Tracker follows how much of the vineyard is done and how the work is performing.",
    useCases: [
      "Knowing how much of the vineyard is pruned",
      "Comparing crew performance between blocks",
      "Costing pruning on hourly or piece-rate work",
    ],
    steps: [
      "Record pruning activity as the work is done.",
      "Associate the work with the vineyard areas and the people doing it.",
      "Track the vines or rows completed.",
      "Review progress and labour performance for the vineyard.",
    ],
    recordedOrCalculated: [
      "Pruning activity and the blocks it covers",
      "Work completed against the vineyard area",
      "Linked work tasks carrying the labour and cost",
      "Progress across the vineyard",
    ],
    outcomes: [
      "A vineyard-level view of pruning progress",
      "Labour performance and cost through the pruning activity report",
    ],
  }),
  g("irrigation_records", {
    purpose: "Record the water actually applied by valve, zone and block.",
    intro:
      "Irrigation Records are the history of water applied — what ran, where, for how long — and they roll up into irrigation reporting.",
    useCases: [
      "Logging an irrigation run after it happens",
      "Keeping a water-use history per block",
      "Reporting water applied across the season",
    ],
    steps: [
      "Record the irrigation session against the valve, zone or block.",
      "Enter the timing and duration of the run.",
      "Save the record so it joins the irrigation history.",
      "Review irrigation reporting for the season.",
    ],
    recordedOrCalculated: [
      "Irrigation sessions by valve, zone and block",
      "Start, finish and duration",
      "Water applied, using the configured application rate",
    ],
    outcomes: [
      "A water-use history for the vineyard",
      "Irrigation reporting across the season",
    ],
    platformNote:
      "Irrigation surfaces appear only for vineyards with irrigation enabled.",
  }),
  g("resistance_planner", {
    purpose: "Plan the season's FRAC rotation and check resistance rules before spraying.",
    intro:
      "The Resistance Planner lays out the season's planned applications, checks them against resistance rules, and can drive real spray jobs from the plan.",
    useCases: [
      "Setting out the season's fungicide rotation in advance",
      "Checking a planned spray does not breach group rules",
      "Creating a spray job directly from a planned position",
    ],
    steps: [
      "Build the plan for the season, position by position.",
      "Review the live resistance check against the plan.",
      "Adjust products or ordering where the rules flag a problem.",
      "Create a spray job from a planned position when it is time to spray.",
    ],
    recordedOrCalculated: [
      "Planned spray positions across the season",
      "A live resistance assessment against the plan",
      "The link from a planned position through to the resulting spray job",
    ],
    outcomes: [
      "A resistance-aware spray program for the season",
      "Traceability from plan through to the actual spray record",
    ],
    platformNote:
      "The resistance assessment is guidance shown at the time you look at it. It is not stored as a verdict against the spray record.",
  }),
];

/** Guide entries in the shared catalogue order. */
export function operationalToolGuides(): OperationalToolGuide[] {
  return SHARED_OPERATIONAL_TOOL_IDS.map(
    (id) => OPERATIONAL_TOOL_GUIDES.find((t) => t.toolId === id)!,
  ).filter(Boolean);
}

export function operationalToolGuide(toolId?: string): OperationalToolGuide | undefined {
  if (!toolId) return undefined;
  return OPERATIONAL_TOOL_GUIDES.find((t) => t.toolId === toolId);
}

export function operationalToolCatalogueItem(
  guide: OperationalToolGuide,
): HowVineTrackWorksItem | undefined {
  return HOW_VINETRACK_WORKS_CATALOGUE.find((i) => i.id === guide.catalogueItemId);
}

const PLATFORM_ORDER: GuidePlatform[] = ["ios", "android", "web"];

/** Platforms verified by the catalogue for this tool. */
export function operationalToolPlatforms(guide: OperationalToolGuide): GuidePlatform[] {
  const item = operationalToolCatalogueItem(guide);
  const set = new Set(item?.platforms ?? []);
  return PLATFORM_ORDER.filter((p) => set.has(p));
}

/** The verified "Open tool" action, or undefined for mobile-only tools. */
export function operationalToolAction(
  guide: OperationalToolGuide,
): { label: string; route: string } | undefined {
  const item = operationalToolCatalogueItem(guide);
  if (!item?.webRoute) return undefined;
  return { label: `Open ${item.title}`, route: item.webRoute };
}

export const OPERATIONAL_TOOLS_ROUTE = "/dashboard/how-vinetrack-works/operational-tools";

export function operationalToolGuideRoute(toolId: string): string {
  return `${OPERATIONAL_TOOLS_ROUTE}/${toolId}`;
}
