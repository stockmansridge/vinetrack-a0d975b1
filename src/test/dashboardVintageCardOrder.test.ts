import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  "src/components/dashboard/VintageOverviewSection.tsx",
  "utf8",
);

describe("Vintage metric card order", () => {
  it("shows Pruning complete before Sprays complete", () => {
    const pruning = dashboard.indexOf('label="Pruning complete"');
    const sprays = dashboard.indexOf('label="Sprays complete"');
    expect(pruning).toBeGreaterThan(-1);
    expect(sprays).toBeGreaterThan(-1);
    expect(pruning).toBeLessThan(sprays);
  });

  it("shows Yield estimate before Grape allocation", () => {
    const yieldCard = dashboard.indexOf('label="Yield estimate"');
    const allocation = dashboard.indexOf('label="Grape allocation"');
    expect(yieldCard).toBeGreaterThan(-1);
    expect(allocation).toBeGreaterThan(-1);
    expect(yieldCard).toBeLessThan(allocation);
  });
});
