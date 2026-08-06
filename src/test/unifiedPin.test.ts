import { describe, expect, it } from "vitest";
import {
  applyPinScopeChange,
  buildCustomPinArgs,
  buildPinInsertRow,
  emptyUnifiedPinForm,
  parseButtonCatalogue,
  pinSegments,
  polygonCentroid,
  validateUnifiedPin,
} from "@/lib/unifiedPin";

describe("unified pin (SQL 170)", () => {
  it("parses repair and growth button catalogues", () => {
    const cat = parseButtonCatalogue([
      { config_type: "repair_buttons", config_data: [{ id: "broken_post", name: "Broken Post", color: "#A2845E" }] },
      { config_type: "growth_buttons", config_data: [{ id: "budburst", name: "Budburst", growth_stage_code: "E-L 4" }] },
      { config_type: "button_templates", config_data: [{ id: "x", name: "Ignored" }] },
    ]);
    expect(cat.repair).toEqual([
      { id: "broken_post", name: "Broken Post", colour: "#A2845E", growthStageCode: null },
    ]);
    expect(cat.growth[0].growthStageCode).toBe("E-L 4");
  });

  it("validates location before button selection", () => {
    const form = emptyUnifiedPinForm();
    expect(validateUnifiedPin(form)).toMatch(/tap the map/i);
    const placed = { ...form, latitude: -33.1, longitude: 149.2 };
    expect(validateUnifiedPin(placed)).toMatch(/repair button/i);
    expect(validateUnifiedPin({ ...placed, buttonId: "broken_post" })).toBeNull();
  });

  it("requires a block and rows for row scope, and a custom item for custom pins", () => {
    const row = applyPinScopeChange(emptyUnifiedPinForm(), "row");
    expect(validateUnifiedPin(row)).toMatch(/block/i);
    const withBlock = { ...row, paddockId: "p1" };
    expect(validateUnifiedPin(withBlock)).toMatch(/row/i);
    const withRows = { ...withBlock, rowSelection: "8-9", pinType: "custom" as const };
    expect(validateUnifiedPin(withRows)).toMatch(/custom item/i);
    expect(pinSegments(withRows)).toHaveLength(8);
  });

  it("clears point state when the scope changes", () => {
    const point = { ...emptyUnifiedPinForm(), latitude: 1, longitude: 2, drivingRowNumber: 5 };
    const block = applyPinScopeChange(point, "block");
    expect(block.latitude).toBeNull();
    expect(block.drivingRowNumber).toBeNull();
  });

  it("uses the block centroid for block-scoped pins", () => {
    const centre = polygonCentroid([
      { lat: 0, lng: 0 },
      { lat: 2, lng: 0 },
      { lat: 2, lng: 2 },
      { lat: 0, lng: 2 },
    ]);
    expect(centre).toEqual({ lat: 1, lng: 1 });
    const form = { ...emptyUnifiedPinForm(), scope: "block" as const, paddockId: "p1", pinType: "custom" as const, customTypeId: "c1" };
    const args = buildCustomPinArgs(form, { id: "id1", vineyardId: "v1", title: "Fence gate", centre });
    expect(args.p_latitude).toBe(1);
    expect(args.p_location_scope).toBe("block");
    expect(args.p_custom_type_id).toBe("c1");
    expect(args.p_segments).toBeNull();
  });

  it("writes repair pins with the shared mobile mode", () => {
    const form = { ...emptyUnifiedPinForm(), latitude: -33.1, longitude: 149.2, buttonId: "broken_post" };
    const row = buildPinInsertRow(form, {
      id: "id1",
      vineyardId: "v1",
      button: { id: "broken_post", name: "Broken Post", colour: "#A2845E", growthStageCode: null },
    });
    expect(row.mode).toBe("Repairs");
    expect(row.button_name).toBe("Broken Post");
    expect(row.category_id).toBe("broken_post");
    expect(row.is_completed).toBe(false);
  });
});
