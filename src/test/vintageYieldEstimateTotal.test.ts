import { describe, it, expect } from "vitest";
import { sumBlockEstimates } from "@/lib/vintageYieldEstimateTotal";

describe("sumBlockEstimates", () => {
  it("uses the trip estimate over pruning and skips unknown blocks", () => {
    const r = sumBlockEstimates(
      ["A", "B", "C"],
      new Map([["a", 10]]),
      new Map([["a", 99], ["b", 5], ["c", null]]),
    );
    expect(r).toEqual({ tonnes: 15, blocksEstimated: 2, blocksTotal: 3 });
  });
  it("a trip with no tonnes never falls back to pruning", () => {
    const r = sumBlockEstimates(["A"], new Map([["a", null]]), new Map([["a", 7]]));
    expect(r.tonnes).toBe(0);
    expect(r.blocksEstimated).toBe(0);
  });
});
