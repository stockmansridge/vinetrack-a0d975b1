import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const landing = source("pages/admin/SoilAnalysisPage.tsx");
const detail = source("pages/admin/SoilSampleDetailPage.tsx");
const tabs = ["overview", "samples", "trends", "compare", "traffic-lights", "reports"];

describe("released Soil Analysis fluid workspace", () => {
  it("keeps the page, header and tab container fluid without a centred width cap", () => {
    expect(landing).not.toMatch(/max-w-(?:6xl|7xl)|mx-auto/);
    expect(landing).toContain('className="p-4 md:p-6 w-full max-w-none min-w-0"');
    expect(landing.match(/<div className="w-full max-w-none">/g)).toHaveLength(2);
    expect(landing).toContain('<Tabs className="w-full max-w-none min-w-0"');
    expect(landing).toContain('<TabsList className="max-w-full flex-wrap justify-start">');
  });

  it.each(tabs)("keeps the %s tab full workspace width", (tab) => {
    expect(landing).toContain(`<TabsContent value="${tab}" className="mt-4 w-full max-w-none min-w-0">`);
  });

  it("expands review and its two-column coverage layout while preserving table scrolling", () => {
    expect(detail).not.toMatch(/max-w-(?:6xl|7xl)|mx-auto/);
    expect(detail).toContain('className="p-4 md:p-6 w-full max-w-none min-w-0"');
    expect(detail).toContain('className="grid w-full min-w-0 gap-4 lg:grid-cols-2"');
    expect(detail).toContain('<CardContent className="p-0 overflow-auto">');
  });

  it.each(["OverviewTab", "SamplesTab", "TrendsTab", "CompareTab", "TrafficLightsTab", "ReportsTab"])("keeps %s containers unconstrained", (name) => {
    const tab = source(`components/soil-analysis/${name}.tsx`);
    expect(tab).not.toMatch(/max-w-(?:6xl|7xl)|mx-auto/);
    expect(tab).toMatch(/className="[^"]*w-full[^"]*max-w-none/);
  });

  it("expands each analyte graph without replacing responsive chart sizing", () => {
    const trends = source("components/soil-analysis/TrendsTab.tsx");
    expect(trends).toContain('className="w-full max-w-none min-w-0 space-y-3 rounded-md border bg-card p-3"');
    expect(trends).toContain('className="h-96 w-full min-w-0"');
    expect(trends).toContain('<ResponsiveContainer width="100%" height="100%">');
    expect(trends).toContain('className="overflow-x-auto"');
  });

  it("retains the help dialog’s intentional compact width", () => {
    expect(source("components/soil-analysis/SoilAnalysisHelpDialog.tsx")).toContain("max-w-2xl");
  });

  it("preserves full-width Reports and local status-matrix scrolling", () => {
    expect(source("components/soil-analysis/ReportsTab.tsx")).toContain('<Card className="w-full max-w-none">');
    expect(source("components/soil-analysis/CompareTab.tsx")).toContain('className="max-h-[70vh] overflow-auto"');
  });
});