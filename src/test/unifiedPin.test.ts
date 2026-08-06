import { describe, expect, it } from "vitest";
import {
  applyPinScopeChange,
  buildCustomPinArgs,
  buildPinInsertRow,
  canonicalButtonKey,
  dedupePinButtons,
  isGrowthStageButton,
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

  it("row scope asks for rows first, then derives the block", () => {
    const row = applyPinScopeChange(emptyUnifiedPinForm(), "row");
    expect(validateUnifiedPin(row)).toMatch(/row/i);
    // Rows chosen but no block derived → the exact match failure message.
    expect(validateUnifiedPin({ ...row, rowSelection: "8-9" })).toBe(ROW_BLOCK_MATCH_ERROR);
    const withRows = { ...row, paddockId: "p1", rowSelection: "8-9", pinType: "custom" as const };
    expect(validateUnifiedPin(withRows)).toMatch(/custom item/i);
    expect(pinSegments(withRows)).toHaveLength(8);
  });

  it("groups mapped rows by block and derives the block from the picked row", () => {
    const groups = buildBlockRowGroups([
      { id: "p2", name: "Shiraz", rows: [{ number: 3 }, { number: 1 }] },
      { id: "p1", name: "Chardonnay", rows: JSON.stringify([{ row_number: 68 }]) },
      { id: "p3", name: "No rows", rows: [] },
    ]);
    expect(groups.map((g) => g.blockName)).toEqual(["Chardonnay", "Shiraz"]);
    expect(groups[1].rows).toEqual([1, 3]);

    let form = applyPinScopeChange(emptyUnifiedPinForm(), "row");
    form = toggleRowInBlock(form, "p1", 68);
    expect(form.paddockId).toBe("p1");
    expect(form.rowSelection).toBe("68");
    expect(pinSegments(form)).toEqual([
      { row: 68, segment: 1 },
      { row: 68, segment: 2 },
      { row: 68, segment: 3 },
      { row: 68, segment: 4 },
    ]);
    // Picking a row in another block starts a fresh, single-block selection.
    form = toggleRowInBlock(form, "p2", 3);
    expect(form.paddockId).toBe("p2");
    expect(form.rowSelection).toBe("3");
  });

  it("orders the Growth tab exactly as the mobile apps do", () => {
    const cat = parseButtonCatalogue([
      {
        config_type: "growth_buttons",
        config_data: [
          { id: "blackberries", name: "Blackberries" },
          { id: "downy", name: "Downy" },
          { id: "powdery", name: "Powdery" },
          { id: "growth_stage", name: "Growth Stage" },
        ],
      },
    ]);
    expect(orderGrowthButtons(dedupePinButtons(cat.growth)).map((b) => b.name)).toEqual([
      "Growth Stage",
      "Powdery",
      "Downy",
      "Blackberries",
    ]);
  });

  it("writes Growth Stage pins with the mobile title, mode and colour", () => {
    const form = { ...emptyUnifiedPinForm(), pinType: "growth" as const, latitude: -33, longitude: 149 };
    const rowOut = buildPinInsertRow(form, {
      id: "pin-1",
      vineyardId: "v1",
      button: { id: "growth_stage", name: "Growth Stage", colour: null, growthStageCode: null },
      growthStageCode: "EL23",
    });
    expect(rowOut.mode).toBe("Growth");
    expect(rowOut.title).toBe("Growth Stage EL23");
    expect(rowOut.button_name).toBe("Growth Stage EL23");
    expect(rowOut.button_color).toBe("darkgreen");
    expect(rowOut.growth_stage_code).toBe("EL23");
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
    // The unified workflow never stores a side.
    expect(Object.keys(row)).not.toContain("pin_side");
    expect(JSON.stringify(row)).not.toMatch(/left|right/i);
  });

  const sided = [
    { id: "growth_stage_left", name: "Growth Stage Left", colour: null, growthStageCode: null },
    { id: "growth_stage_right", name: "Growth Stage Right", colour: "#34C759", growthStageCode: null },
    { id: "powdery_l", name: "Powdery (L)", colour: "#FF9500", growthStageCode: null },
    { id: "powdery_r", name: "Powdery (R)", colour: null, growthStageCode: null },
    { id: "blackberries", name: "Blackberries", colour: null, growthStageCode: null },
  ];

  it("collapses left/right catalogue variants to one canonical button", () => {
    const deduped = dedupePinButtons(sided);
    expect(deduped.map((b) => b.name)).toEqual(["Growth Stage", "Powdery", "Blackberries"]);
    expect(deduped[0].id).toBe("growth_stage");
    expect(deduped[1].id).toBe("powdery");
    // Detail missing on the first variant is filled from its sibling.
    expect(deduped[0].colour).toBe("#34C759");
  });

  it("deduplicates repair buttons the same way", () => {
    const deduped = dedupePinButtons([
      { id: "broken_post_left", name: "Broken Post Left", colour: "#A2845E", growthStageCode: null },
      { id: "broken_post_right", name: "Broken Post Right", colour: "#A2845E", growthStageCode: null },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual({ id: "broken_post", name: "Broken Post", colour: "#A2845E", growthStageCode: null });
  });

  it("keeps distinct buttons apart and identifies the growth stage action", () => {
    expect(canonicalButtonKey(sided[0])).toBe("growthstage");
    expect(isGrowthStageButton(sided[0])).toBe(true);
    expect(isGrowthStageButton(sided[4])).toBe(false);
    expect(dedupePinButtons([
      { id: "downy", name: "Downy", colour: null, growthStageCode: null },
      { id: "powdery", name: "Powdery", colour: null, growthStageCode: null },
    ])).toHaveLength(2);
  });

  it("stores the picked growth stage identifier on the pin", () => {
    const form = { ...emptyUnifiedPinForm(), pinType: "growth" as const, latitude: -33.1, longitude: 149.2, buttonId: "growth_stage" };
    const row = buildPinInsertRow(form, {
      id: "id1",
      vineyardId: "v1",
      button: { id: "growth_stage", name: "Growth Stage", colour: null, growthStageCode: null },
      growthStageCode: "EL23",
    });
    expect(row.mode).toBe("Growth");
    expect(row.growth_stage_code).toBe("EL23");
    expect(row.category_id).toBe("growth_stage");
  });
});
