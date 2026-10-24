import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  "src/components/dashboard/VintageOverviewSection.tsx",
  "utf8",
);

describe("Sprays complete card link", () => {
  it("opens the Spray Records page", () => {
    const start = dashboard.indexOf('label="Sprays complete"');
    expect(start).toBeGreaterThan(-1);
    const card = dashboard.slice(start, dashboard.indexOf("/>", start));
    expect(card).toContain('to="/spray-records"');
    expect(card).not.toContain('to="/reports/spray"');
  });
});
