import { describe, expect, it } from "vitest";
import {
  GROWTH_PINS_OR_FILTER,
  isGrowthPin,
} from "@/lib/growthStageRecordsQuery";

describe("GROWTH_PINS_OR_FILTER query contract", () => {
  it("is unchanged: growth mode OR any non-null stage code", () => {
    expect(GROWTH_PINS_OR_FILTER).toBe(
      "mode.eq.Growth,growth_stage_code.not.is.null",
    );
  });
});

describe("isGrowthPin — client mirror of the server OR filter", () => {
  it("classifies mode 'Growth' with a null stage code as growth (hidden when off)", () => {
    expect(isGrowthPin({ mode: "Growth", growth_stage_code: null })).toBe(true);
  });

  it("is case/whitespace tolerant on mode", () => {
    expect(isGrowthPin({ mode: " Growth " })).toBe(true);
    expect(isGrowthPin({ mode: "growth", growth_stage_code: null })).toBe(true);
    expect(isGrowthPin({ mode: "GROWTH" })).toBe(true);
  });

  it("classifies a non-Growth mode with a nonblank stage code as growth", () => {
    expect(isGrowthPin({ mode: "Scouting", growth_stage_code: "34" })).toBe(true);
    expect(isGrowthPin({ mode: null, growth_stage_code: "EL-34" })).toBe(true);
  });

  it("keeps an ordinary non-growth pin with no stage code visible", () => {
    expect(isGrowthPin({ mode: "Scouting", growth_stage_code: null })).toBe(false);
    expect(isGrowthPin({ mode: null, growth_stage_code: null })).toBe(false);
    expect(isGrowthPin({})).toBe(false);
  });

  it("does not classify a blank/whitespace stage code alone as growth", () => {
    expect(isGrowthPin({ mode: "Scouting", growth_stage_code: "   " })).toBe(false);
    expect(isGrowthPin({ mode: "Scouting", growth_stage_code: "" })).toBe(false);
  });

  it("tolerates null/undefined pins", () => {
    expect(isGrowthPin(null)).toBe(false);
    expect(isGrowthPin(undefined)).toBe(false);
  });
});
