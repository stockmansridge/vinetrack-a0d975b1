import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initialYieldTab, YIELD_TABS } from "@/lib/yieldTab";

const page = readFileSync("src/pages/setup/YieldReportsPage.tsx", "utf8");
const dashboard = readFileSync(
  "src/components/dashboard/VintageOverviewSection.tsx",
  "utf8",
);

describe("Grape Allocation deep link from the Dashboard", () => {
  it("the Dashboard Grape allocation card opens the Grape Allocation tab", () => {
    expect(dashboard).toContain('to="/yield?tab=allocation"');
  });

  it("every real tab value opens that tab", () => {
    for (const t of YIELD_TABS) expect(initialYieldTab(t)).toBe(t);
  });

  it("missing or unrecognised values fall back to Overview", () => {
    expect(initialYieldTab(null)).toBe("overview");
    expect(initialYieldTab("")).toBe("overview");
    expect(initialYieldTab("nope")).toBe("overview");
    expect(initialYieldTab("ALLOCATION")).toBe("overview");
  });

  it("the Yield page seeds its tab from the query parameter", () => {
    expect(page).toContain('initialYieldTab(searchParams.get("tab"))');
    // The tab control itself is unchanged: users can still switch tabs freely.
    expect(page).toContain("onValueChange={(v) => setTab(v as typeof tab)}");
  });
});
