import { describe, expect, it } from "vitest";
import {
  classifyOverviewPin,
  currentGrowthStagePinIds,
  isOverviewPinVisible,
  pinVarietyKey,
} from "@/lib/overviewPinClasses";

const ALL = { repairs: true, growth: true, currentGrowthStages: true };

describe("overview pin classes", () => {
  it("classifies repairs, growth and growth-stage pins", () => {
    expect(classifyOverviewPin({ mode: "Repairs", category: "broken_post" } as any)).toBe("repairs");
    expect(classifyOverviewPin({ mode: null, growth_stage_code: null })).toBe("repairs");
    expect(classifyOverviewPin({ mode: null, growth_stage_code: "   " })).toBe("repairs");
    expect(classifyOverviewPin({ mode: " growth " })).toBe("growth");
    expect(classifyOverviewPin({ mode: "GROWTH", growth_stage_code: null })).toBe("growth");
    expect(classifyOverviewPin({ mode: "Growth", growth_stage_code: "E-L 23" })).toBe("growth_stage");
    // A non-Growth mode with an E-L code is still an E-L observation.
    expect(classifyOverviewPin({ mode: "Other", growth_stage_code: "EL18" })).toBe("growth_stage");
  });

  it("groups Current Growth Stages by variety and keeps the highest E-L", () => {
    const pins = [
      { id: "shz-low", growth_stage_code: "EL 19", variety: "Shiraz", date: "2026-01-02" },
      { id: "shz-high", growth_stage_code: "EL 31", variety: "shiraz", date: "2026-01-05" },
      { id: "cab", growth_stage_code: "EL 27", variety: "Cabernet", date: "2026-01-04" },
    ];
    const current = currentGrowthStagePinIds(pins);
    expect(Array.from(current).sort()).toEqual(["cab", "shz-high"]);
  });

  it("falls back to the block variety, then the block, when the pin has none", () => {
    const varieties = new Map([["blk-1", "Chardonnay"]]);
    expect(pinVarietyKey({ paddock_id: "blk-1" }, varieties)).toBe("chardonnay");
    expect(pinVarietyKey({ paddock_id: "blk-2" }, varieties)).toBe("block:blk-2");
    expect(pinVarietyKey({}, varieties)).toBe("unknown");
  });

  it("breaks an equal E-L tie on the most recent observation", () => {
    const current = currentGrowthStagePinIds([
      { id: "old", growth_stage_code: "23", variety: "Shiraz", date: "2026-01-01" },
      { id: "new", growth_stage_code: "23", variety: "Shiraz", date: "2026-01-09" },
    ]);
    expect(Array.from(current)).toEqual(["new"]);
  });

  it("shows only the current growth-stage pins when that toggle is on", () => {
    const pins = [
      { id: "repair", mode: "Repairs" },
      { id: "growth", mode: "Growth" },
      { id: "el-low", mode: "Growth", growth_stage_code: "19", variety: "Shiraz" },
      { id: "el-high", mode: "Growth", growth_stage_code: "31", variety: "Shiraz" },
    ];
    const current = currentGrowthStagePinIds(pins);
    const visible = (v: typeof ALL) =>
      pins.filter((p) => isOverviewPinVisible(p, v, current)).map((p) => p.id);

    expect(visible(ALL)).toEqual(["repair", "growth", "el-high"]);
    expect(visible({ ...ALL, currentGrowthStages: false })).toEqual(["repair", "growth"]);
    expect(visible({ repairs: false, growth: true, currentGrowthStages: false })).toEqual(["growth"]);
    expect(visible({ repairs: true, growth: false, currentGrowthStages: false })).toEqual(["repair"]);
    expect(visible({ repairs: false, growth: false, currentGrowthStages: false })).toEqual([]);
  });
});
