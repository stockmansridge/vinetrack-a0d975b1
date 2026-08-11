// Overview (quick view) model: block × variety estimated/actual tonnes.
import { describe, it, expect } from "vitest";
import { buildYieldOverview } from "@/lib/yieldOverview";

const B1 = "b1";
const B2 = "b2";

describe("buildYieldOverview", () => {
  it("shows the sole variety with the full block estimate", () => {
    const [card] = buildYieldOverview({
      blocks: [{ id: B1, name: "Cab Franc", areaHa: 1, varieties: [{ name: "Cabernet Franc", percent: 100 }] }],
      estimatedByBlock: new Map([[B1, 8.37]]),
      actuals: [],
    });
    expect(card.blockName).toBe("Cab Franc");
    expect(card.varieties).toHaveLength(1);
    expect(card.varieties[0]).toMatchObject({ variety: "Cabernet Franc", estimatedTonnes: 8.37, actualTonnes: null });
  });

  it("apportions the estimate across a mixed block by allocation percent", () => {
    const [card] = buildYieldOverview({
      blocks: [
        {
          id: B2,
          name: "Block 7",
          areaHa: 3,
          varieties: [
            { name: "Shiraz", percent: 74 },
            { name: "Cabernet Franc", percent: 26 },
          ],
        },
      ],
      estimatedByBlock: new Map([[B2, 13.2]]),
      actuals: [],
    });
    expect(card.varieties.map((v) => v.variety)).toEqual(["Shiraz", "Cabernet Franc"]);
    expect(card.varieties[0].estimatedTonnes).toBeCloseTo(9.768, 3);
    expect(card.varieties[1].estimatedTonnes).toBeCloseTo(3.432, 3);
  });

  it("splits equally when no percentages are configured", () => {
    const [card] = buildYieldOverview({
      blocks: [{ id: B1, name: "B", areaHa: null, varieties: [{ name: "A", percent: null }, { name: "B", percent: null }] }],
      estimatedByBlock: new Map([[B1, 10]]),
      actuals: [],
    });
    expect(card.varieties.map((v) => v.estimatedTonnes)).toEqual([5, 5]);
  });

  it("attaches actual tonnes per variety", () => {
    const [card] = buildYieldOverview({
      blocks: [
        { id: B2, name: "Block 7", areaHa: 3, varieties: [{ name: "Shiraz", percent: 50 }, { name: "Cabernet Franc", percent: 50 }] },
      ],
      estimatedByBlock: new Map([[B2, 10]]),
      actuals: [
        { blockId: B2, variety: "Shiraz", tonnes: 9.8 },
        { blockId: B2, variety: "Cabernet Franc", tonnes: 3.4 },
      ],
    });
    expect(card.varieties[0].actualTonnes).toBe(9.8);
    expect(card.varieties[1].actualTonnes).toBe(3.4);
    expect(card.actualTonnes).toBeCloseTo(13.2, 5);
  });

  it("attributes a variety-less actual to a single-variety block", () => {
    const [card] = buildYieldOverview({
      blocks: [{ id: B1, name: "Cab Franc", areaHa: 1, varieties: [{ name: "Cabernet Franc", percent: 100 }] }],
      estimatedByBlock: new Map(),
      actuals: [{ blockId: B1, variety: null, tonnes: 4 }],
    });
    expect(card.varieties[0].actualTonnes).toBe(4);
  });

  it("returns a placeholder row for blocks with no configured varieties", () => {
    const [card] = buildYieldOverview({
      blocks: [{ id: B1, name: "Unallocated", areaHa: 1, varieties: [] }],
      estimatedByBlock: new Map([[B1, 6]]),
      actuals: [],
    });
    expect(card.varieties).toHaveLength(1);
    expect(card.varieties[0]).toMatchObject({ variety: null, estimatedTonnes: 6 });
  });
});
