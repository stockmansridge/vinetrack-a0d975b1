import { describe, it, expect } from "vitest";
import {
  CLONE_MASS_SELECTION_KEY,
  ROOTSTOCK_OWN_ROOTS_KEY,
  allocationCloneLabel,
  allocationRootstockLabel,
  cloneMatches,
  clonesForVariety,
  isLegacyFreeText,
  normaliseCloneRow,
  normaliseRootstockRow,
  rootstockMatches,
  type CatalogClone,
} from "@/lib/cloneRootstockCatalog";
import {
  deserialiseAllocations,
  serialiseAllocations,
} from "@/components/varieties/VarietyAllocationEditor";

const clone = (over: Partial<CatalogClone>): CatalogClone => ({
  key: "shiraz:pt23",
  variety_key: "shiraz",
  display_name: "PT23",
  clone_code: "PT23",
  selection_system: "Australian selection",
  source_country: "Australia",
  aliases: [],
  is_custom: false,
  is_active: true,
  ...over,
});

describe("clone & rootstock catalogue", () => {
  it("normalises catalogue rows", () => {
    const c = normaliseCloneRow(
      { key: "shiraz:mv6", variety_key: "shiraz", display_name: "MV6", aliases: ["Best's"] },
      false,
    );
    expect(c?.key).toBe("shiraz:mv6");
    expect(c?.aliases).toEqual(["Best's"]);
    const r = normaliseRootstockRow({ key: "101_14", canonical_name: "101-14 Mgt" }, false);
    expect(r?.display_name).toBe("101-14 Mgt");
  });

  it("filters clones by variety and active flag", () => {
    const rows = clonesForVariety(
      [clone({}), clone({ key: "pinot:mv6", variety_key: "pinot_noir" })],
      [clone({ key: "custom:v:shiraz:home", is_custom: true })],
      "shiraz",
    );
    expect(rows.map((r) => r.key)).toEqual(["shiraz:pt23", "custom:v:shiraz:home"]);
  });

  it("searches clone code, selection system and aliases", () => {
    const c = clone({ aliases: ["Best's Old Block"] });
    expect(cloneMatches(c, "pt2")).toBe(true);
    expect(cloneMatches(c, "australian")).toBe(true);
    expect(cloneMatches(c, "best's")).toBe(true);
    expect(cloneMatches(c, "chardonnay")).toBe(false);
    expect(
      rootstockMatches(
        { key: "101_14", display_name: "101-14 Mgt", parentage: "riparia", aliases: [], is_custom: false, is_active: true },
        "riparia",
      ),
    ).toBe(true);
  });

  it("treats keyless display text as legacy free text", () => {
    expect(isLegacyFreeText(null, "Old MV6 notes")).toBe(true);
    expect(isLegacyFreeText("shiraz:mv6", "MV6")).toBe(false);
  });

  it("labels sentinels when only a key is stored", () => {
    expect(allocationCloneLabel({ cloneKey: CLONE_MASS_SELECTION_KEY })).toBe("Mass selection");
    expect(allocationRootstockLabel({ rootstockKey: ROOTSTOCK_OWN_ROOTS_KEY })).toBe("Own roots");
    expect(allocationCloneLabel({ clone: "MV6" })).toBe("MV6");
    expect(allocationRootstockLabel({ root_stock: "101-14" })).toBe("101-14");
    expect(allocationCloneLabel({})).toBeNull();
  });
});

describe("allocation serialisation with catalogue keys", () => {
  it("round-trips keys and display snapshots", () => {
    const rows = deserialiseAllocations([
      {
        id: "a1",
        varietyKey: "shiraz",
        name: "Shiraz",
        percent: 60,
        clone: "PT23",
        cloneKey: "shiraz:pt23",
        rootstock: "Own roots",
        rootstockKey: "own_roots",
      },
      { id: "a2", varietyKey: "shiraz", name: "Shiraz", percent: 40, clone: "Old block text" },
    ]);
    expect(rows[0].cloneKey).toBe("shiraz:pt23");
    expect(rows[1].cloneKey).toBeNull();

    const out = serialiseAllocations(rows) as any[];
    expect(out[0]).toMatchObject({
      cloneKey: "shiraz:pt23",
      clone: "PT23",
      rootstockKey: "own_roots",
      rootstock: "Own roots",
    });
    // Legacy free text preserved, no invented key.
    expect(out[1].clone).toBe("Old block text");
    expect("cloneKey" in out[1]).toBe(false);
  });

  it("omits empty clone/rootstock rather than writing empty strings", () => {
    const out = serialiseAllocations([
      { id: "a", varietyKey: "shiraz", name: "Shiraz", percent: 100, clone: "  ", rootstock: null },
    ]) as any[];
    expect("clone" in out[0]).toBe(false);
    expect("rootstock" in out[0]).toBe(false);
  });
});
