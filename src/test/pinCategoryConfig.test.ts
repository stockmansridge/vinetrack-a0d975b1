import { describe, expect, it } from "vitest";
import {
  buildPinCategoryColours,
  configuredPinColour,
  EMPTY_PIN_CATEGORY_COLOURS,
  pinStableKeys,
} from "@/lib/pinCategoryConfig";
import { pinDisplayStyle } from "@/lib/pinStyle";
import { parseColourToken } from "@/lib/colourToken";

const CANONICAL_GREEN = "#34C759";
const CANONICAL_BROWN = "#A2845E";
const GREY = "#8E8E93";

const vineyardA = buildPinCategoryColours([
  {
    config_type: "repair_buttons",
    config_data: [
      { id: "vine_issue", name: "Vine Issue", color: "#7B1FA2" },
      { id: "broken_post", name: "Broken Post", color: "purple" },
      { id: "custom_gate", name: "Gate Damage", color: "#123456" },
    ],
  },
]);

const vineyardB = buildPinCategoryColours([
  {
    config_type: "repair_buttons",
    config_data: [{ button_id: "vine_issue", label: "Vine Issue", colour: "#0AA1DD" }],
  },
]);

const pin = (patch: Record<string, any> = {}) => ({
  id: "p1",
  mode: "Repair",
  category_id: "vine_issue",
  paddock_id: "block-1",
  pin_row_number: 87.5,
  latitude: -33.5,
  longitude: 151.2,
  ...patch,
});

describe("vineyard-configured category colours", () => {
  it("a configured Vine Issue colour overrides the canonical green fallback", () => {
    expect(pinDisplayStyle(pin() as any, vineyardA).hex).toBe("#7B1FA2");
    expect(pinDisplayStyle(pin() as any, vineyardA).hex).not.toBe(CANONICAL_GREEN);
  });

  it("two pins with the same stable category use the same configured colour", () => {
    const a = pinDisplayStyle(pin({ id: "a" }) as any, vineyardA).hex;
    const b = pinDisplayStyle(
      pin({ id: "b", category_id: "vine_issue", title: "Totally different title", button_color: "#FF0000" }) as any,
      vineyardA,
    ).hex;
    expect(a).toBe(b);
    expect(b).toBe("#7B1FA2");
  });

  it("a missing block or row does not alter the configured category colour", () => {
    const unassigned = pin({ paddock_id: null, pin_row_number: null, driving_row_number: null });
    expect(pinDisplayStyle(unassigned as any, vineyardA).hex).toBe("#7B1FA2");
  });

  it("completion does not alter the configured category colour", () => {
    expect(pinDisplayStyle(pin({ is_completed: true, completed_at: "2026-08-01" }) as any, vineyardA).hex).toBe("#7B1FA2");
  });

  it("sync state, creator, platform and manual-vs-GPS do not alter the colour", () => {
    const noisy = pin({
      sync_version: 12,
      created_by: "someone-else",
      platform: "android",
      source: "manual",
      snapped_to_row: false,
    });
    expect(pinDisplayStyle(noisy as any, vineyardA).hex).toBe("#7B1FA2");
  });

  it("a different vineyard can configure a different colour for the same category", () => {
    expect(pinDisplayStyle(pin() as any, vineyardB).hex).toBe("#0AA1DD");
    expect(pinDisplayStyle(pin() as any, vineyardA).hex).toBe("#7B1FA2");
  });

  it("missing configuration uses the canonical fallback", () => {
    expect(pinDisplayStyle(pin() as any, EMPTY_PIN_CATEGORY_COLOURS).hex).toBe(CANONICAL_GREEN);
    expect(pinDisplayStyle(pin() as any).hex).toBe(CANONICAL_GREEN);
    // configured for vine_issue only — broken_post falls back
    expect(pinDisplayStyle(pin({ category_id: "broken_post" }) as any, vineyardB).hex).toBe(CANONICAL_BROWN);
  });

  it("invalid configuration uses the canonical fallback", () => {
    const broken = buildPinCategoryColours([
      {
        config_type: "repair_buttons",
        config_data: [
          { id: "vine_issue", color: "not-a-colour" },
          { id: "broken_post", color: "" },
          { id: "irrigation" },
        ],
      },
    ]);
    expect(pinDisplayStyle(pin() as any, broken).hex).toBe(CANONICAL_GREEN);
    expect(pinDisplayStyle(pin({ category_id: "broken_post" }) as any, broken).hex).toBe(CANONICAL_BROWN);
  });

  it("malformed config payloads are ignored safely", () => {
    expect(buildPinCategoryColours(null)).toEqual(EMPTY_PIN_CATEGORY_COLOURS);
    expect(buildPinCategoryColours([{ config_type: "repair_buttons", config_data: "nope" }])).toEqual(
      EMPTY_PIN_CATEGORY_COLOURS,
    );
  });

  it("unknown category uses neutral grey", () => {
    expect(pinDisplayStyle(pin({ category_id: "brand_new_thing", category: null }) as any, vineyardA).hex).toBe(GREY);
    expect(pinDisplayStyle({ mode: "Repair" } as any, vineyardA).hex).toBe(GREY);
  });

  it("honours a configured colour for a non-canonical button via its stable id", () => {
    const p = pin({ category_id: "custom_gate", category: null });
    expect(pinDisplayStyle(p as any, vineyardA).hex).toBe("#123456");
  });

  it("joins on stable identifiers, not display text alone", () => {
    expect(pinStableKeys({ category_id: "Vine_Issue", button_name: "Vine Issue" })).toEqual([
      "vine_issue",
      "vineissue",
    ]);
    // Same colour whether the pin carries the id or only the legacy name.
    expect(configuredPinColour({ category_id: "vine_issue" }, vineyardA)).toBe("#7B1FA2");
    expect(configuredPinColour({ button_name: "Vine Issue" }, vineyardA)).toBe("#7B1FA2");
    expect(configuredPinColour({ button_name: "Something Else" }, vineyardA)).toBeNull();
  });

  it("accepts named colours and hex from configuration", () => {
    expect(parseColourToken("purple")).toBe("#AF52DE");
    expect(parseColourToken("a2845e")).toBe("#A2845E");
    expect(parseColourToken("#abc")).toBe("#AABBCC");
    expect(parseColourToken("banana")).toBeNull();
    expect(pinDisplayStyle(pin({ category_id: "broken_post" }) as any, vineyardA).hex).toBe("#AF52DE");
  });

  it("uses the configured label for the category badge when present", () => {
    expect(pinDisplayStyle(pin({ category_id: "custom_gate", category: null }) as any, vineyardA).categoryId).toBe(
      "unknown",
    );
    expect(pinDisplayStyle(pin() as any, vineyardA).label).toBe("Vine Issue");
  });
});
