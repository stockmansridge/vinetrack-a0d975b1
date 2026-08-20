// Reports & Insights guide categories.
//
// Extracted from ReportsGuide.tsx (unchanged copy) so the same canonical text
// can seed managed Guide Content without importing a component into lib code.

export interface ReportCategory {
  title: string;
  body: string;
  itemId: string;
  imageKey?: "reports.activity" | "reports.costs" | "reports.sprays";
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    title: "Activity reporting",
    body: "Trip reports, work task reports and pruning activity — what was done, where and how quickly.",
    itemId: "reports.activity",
    imageKey: "reports.activity",
  },
  {
    title: "Cost & labour reporting",
    body: "Season, block and variety costs built from labour lines, piece rates, machine time, fuel and maintenance.",
    itemId: "reports.costs",
    imageKey: "reports.costs",
  },
  {
    title: "Spray records & compliance",
    body: "Chemicals, rates, withholding and re-entry information, conditions and tank mix per application.",
    itemId: "reports.spray",
    imageKey: "reports.sprays",
  },
  {
    title: "Yield & production",
    body: "Estimated against actual yield, year-on-year comparison and picking analysis by block, variety and clone.",
    itemId: "reports.yield",
  },
  {
    title: "Rainfall, growth stage & irrigation",
    body: "Rainfall history and calendar, E-L growth stage history, and irrigation reporting where irrigation applies.",
    itemId: "reports.environment",
  },
  {
    title: "Team & access",
    body: "Who is in the vineyard team, their roles, and who can see financial information.",
    itemId: "reports.team_management",
  },
];
