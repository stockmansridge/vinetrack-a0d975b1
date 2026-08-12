import { describe, it, expect } from "vitest";
import {
  browseClones,
  browseRootstocks,
  canManageCatalogue,
  cloneUsage,
  collectCloneRefs,
  collectRootstockRefs,
  rootstockUsage,
  type UsagePaddock,
} from "@/lib/cloneRootstockUsage";
import type { CatalogClone, CatalogRootstock } from "@/lib/cloneRootstockCatalog";

const clone = (o: Partial<CatalogClone> = {}): CatalogClone => ({
  key: "shiraz:pt23",
  variety_key: "shiraz",
  display_name: "PT23",
  clone_code: "PT23",
  selection_system: "Australian selection",
  source_country: "Australia",
  aliases: [],
  is_custom: false,
  is_active: true,
  ...o,
});

const rootstock = (o: Partial<CatalogRootstock> = {}): CatalogRootstock => ({
  key: "101_14",
  display_name: "101-14 Mgt",
  canonical_name: "101-14 Millardet et de Grasset",
  parentage: "V. riparia x V. rupestris",
  aliases: ["101-14"],
  is_custom: false,
  is_active: true,
  ...o,
});

const paddock = (name: string, allocations: any[]): UsagePaddock => ({
  id: name,
  name,
  variety_allocations: allocations,
});

describe("clone & rootstock catalogue browsing", () => {
  it("browses built-ins together with vineyard customs", () => {
    const rows = browseClones(
      [clone(), clone({ key: "shiraz:mv6", display_name: "MV6", clone_code: "MV6" })],
      [clone({ key: "custom:v1:shiraz:home", display_name: "Home block", is_custom: true })],
    );
    expect(rows.map((r) => r.display_name)).toEqual(["Home block", "MV6", "PT23"]);
  });

  it("only lists customs from the active vineyard (scoping is the query's job)", () => {
    // Simulates list_vineyard_grape_clones returning only vineyard 1's rows.
    const v1 = [clone({ key: "custom:v1:shiraz:a", display_name: "A", is_custom: true })];
    const rows = browseClones([], v1);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toContain("custom:v1:");
  });

  it("filters clones by grape variety", () => {
    const rows = browseClones(
      [clone(), clone({ key: "pinot_noir:777", variety_key: "pinot_noir", display_name: "777" })],
      [],
      { varietyKey: "pinot_noir" },
    );
    expect(rows.map((r) => r.key)).toEqual(["pinot_noir:777"]);
  });

  it("browses rootstocks globally with no variety filter", () => {
    const rows = browseRootstocks(
      [rootstock(), rootstock({ key: "schwarzmann", display_name: "Schwarzmann" })],
      [rootstock({ key: "custom:v1:nursery-a", display_name: "Nursery A", is_custom: true })],
    );
    expect(rows.map((r) => r.display_name)).toEqual(["101-14 Mgt", "Nursery A", "Schwarzmann"]);
  });

  it("searches by clone code, alias and rootstock parentage", () => {
    expect(browseClones([clone({ aliases: ["Best's Old Block"] })], [], { query: "best's" })).toHaveLength(1);
    expect(browseClones([clone()], [], { query: "pt2" })).toHaveLength(1);
    expect(browseClones([clone()], [], { query: "chardonnay" })).toHaveLength(0);
    expect(browseRootstocks([rootstock()], [], { query: "rupestris" })).toHaveLength(1);
    expect(browseRootstocks([rootstock()], [], { query: "101-14" })).toHaveLength(1);
  });

  it("hides archived custom records", () => {
    const rows = browseClones([], [
      clone({ key: "custom:v1:a", display_name: "A", is_custom: true, is_active: true }),
      clone({ key: "custom:v1:b", display_name: "B", is_custom: true, is_active: false }),
    ]);
    expect(rows.map((r) => r.display_name)).toEqual(["A"]);
    expect(
      browseRootstocks([], [rootstock({ key: "custom:v1:z", is_custom: true, is_active: false })]),
    ).toHaveLength(0);
  });

  it("excludes sentinels from catalogue rows", () => {
    expect(
      browseClones([clone({ key: "mass_selection", display_name: "Mass selection" })], []),
    ).toHaveLength(0);
    expect(
      browseRootstocks([rootstock({ key: "own_roots", display_name: "Own roots" })], []),
    ).toHaveLength(0);
  });
});

describe("catalogue usage matching", () => {
  const blocks = [
    paddock("Block A", [{ cloneKey: "shiraz:pt23", clone: "PT23", rootstockKey: "101_14" }]),
    paddock("Block B", [{ clone: "PT23" }, { rootstock: "101-14" }]),
    paddock("Block C", [{ cloneKey: "mass_selection", rootstockKey: "own_roots" }]),
    paddock("Block D", [{ cloneKey: "shiraz:mv6", clone: "PT23" }]),
  ];

  it("matches by stable key and falls back to legacy text only when no key exists", () => {
    const refs = collectCloneRefs(blocks);
    const usage = cloneUsage(refs, clone());
    // Block A via key, Block B via legacy text. Block D has a different key -> excluded.
    expect(usage.blocks).toEqual(["Block A", "Block B"]);
    expect(usage.viaLegacyText).toBe(true);
  });

  it("matches rootstocks by key and alias text", () => {
    const usage = rootstockUsage(collectRootstockRefs(blocks), rootstock());
    expect(usage.blocks).toEqual(["Block A", "Block B"]);
  });

  it("never counts sentinel allocations as catalogue usage", () => {
    const refs = collectCloneRefs([paddock("Block C", [{ cloneKey: "mass_selection" }])]);
    expect(cloneUsage(refs, clone()).blocks).toEqual([]);
    expect(
      rootstockUsage(collectRootstockRefs([paddock("C", [{ rootstockKey: "own_roots" }])]), rootstock())
        .blocks,
    ).toEqual([]);
  });

  it("reports pure key matches without the legacy flag", () => {
    const usage = cloneUsage(collectCloneRefs([blocks[0]]), clone());
    expect(usage.blocks).toEqual(["Block A"]);
    expect(usage.viaLegacyText).toBe(false);
  });
});

describe("catalogue permissions", () => {
  it("allows only owners and managers to add or archive customs", () => {
    expect(canManageCatalogue("owner")).toBe(true);
    expect(canManageCatalogue("manager")).toBe(true);
    expect(canManageCatalogue("worker")).toBe(false);
    expect(canManageCatalogue(null)).toBe(false);
  });
});
