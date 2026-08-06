import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(
  path.resolve(process.cwd(), "src/components/AppSidebar.tsx"),
  "utf8",
);

/** Titles of the `work` nav array, in declaration order. */
function workTitles(): string[] {
  const start = src.indexOf("const work: NavItem[] = [");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/title:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function workUrls(): string[] {
  const start = src.indexOf("const work: NavItem[] = [");
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("Work sidebar ordering", () => {
  const titles = workTitles();

  it("puts Pins first", () => {
    expect(titles[0]).toBe("Pins / Repairs / Observations");
  });

  it("puts Field Trips second", () => {
    expect(titles[1]).toBe("Field Trips");
  });

  it("puts Spray Jobs third", () => {
    expect(titles[2]).toBe("Spray Jobs & Templates");
  });

  it("puts Work Tasks fourth", () => {
    expect(titles[3]).toBe("Work Tasks");
  });

  it("puts Pruning Tracker fifth", () => {
    expect(titles[4]).toBe("Pruning Tracker");
  });

  it("preserves the previous relative order of the remaining items", () => {
    expect(titles.slice(5)).toEqual([
      "Maintenance Logs",
      "Yields",
      "Damage Records",
    ]);
  });

  it("keeps routes unchanged", () => {
    expect(workUrls()).toEqual([
      "/pins",
      "/trips",
      "/spray-jobs",
      "/work-tasks",
      "/tools/pruning-tracker",
      "/maintenance",
      "/yield",
      "/damage-records",
    ]);
  });

  it("does not duplicate any Work item", () => {
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("appends permission-gated irrigation items after the base list", () => {
    expect(src).toContain("[...work, ...irrigationWork]");
  });
});
