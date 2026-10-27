// Yield page tab deep links.
//
// The Dashboard "Grape allocation" card links straight to the Grape Allocation
// tab with ?tab=allocation. Any value that is not a real tab (including a
// missing parameter) falls back to the Overview tab, so a stale or mistyped
// link still opens the page normally.
export const YIELD_TABS = [
  "overview",
  "sessions",
  "bunch-weights",
  "historical",
  "picking",
  "allocation",
] as const;

export type YieldTab = (typeof YIELD_TABS)[number];

export function initialYieldTab(param: string | null): YieldTab {
  return YIELD_TABS.includes(param as YieldTab) ? (param as YieldTab) : "overview";
}
