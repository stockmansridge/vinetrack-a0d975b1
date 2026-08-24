// Canopy Reference Images — override, fallback and calculation isolation.
import { describe, it, expect } from "vitest";
import {
  CANOPY_IMAGE_SLOTS,
  bundledCanopyImageUrl,
  canopyImageKey,
  canopyImageSlot,
  resolveCanopyImage,
} from "@/lib/canopyImages";
import { parseCanopyImageMap } from "@/lib/canopyImageStore";
import { recommendedDiluteLitresPer100m, canopyDiluteRange } from "@/lib/sprayCanopy";

describe("canopy reference image slots", () => {
  it("exposes exactly the eight stable canopy combinations", () => {
    expect(CANOPY_IMAGE_SLOTS).toHaveLength(8);
    expect(CANOPY_IMAGE_SLOTS.map((s) => s.key)).toEqual([
      "canopy.vsp.small",
      "canopy.vsp.medium",
      "canopy.vsp.large",
      "canopy.vsp.full",
      "canopy.sprawl.small",
      "canopy.sprawl.medium",
      "canopy.sprawl.large",
      "canopy.sprawl.full",
    ]);
  });

  it("every slot keeps its bundled default asset", () => {
    for (const slot of CANOPY_IMAGE_SLOTS) {
      expect(slot.defaultUrl).toBe(`/canopy/${slot.type}-${slot.size}.png`);
      expect(bundledCanopyImageUrl(slot.key)).toBe(slot.defaultUrl);
    }
  });

  it("falls back to the bundled default when no custom image is configured", () => {
    const r = resolveCanopyImage(canopyImageKey("vsp", "large"), null);
    expect(r.source).toBe("default");
    expect(r.url).toBe("/canopy/vsp-large.png");
  });

  it("uses the System Admin custom override when present", () => {
    const r = resolveCanopyImage("canopy.sprawl.full", "https://cdn/x.png?v=1");
    expect(r.source).toBe("custom");
    expect(r.url).toBe("https://cdn/x.png?v=1");
  });

  it("reset (no stored asset) resolves back to the bundled default", () => {
    const afterReset = resolveCanopyImage("canopy.sprawl.full", undefined);
    expect(afterReset.source).toBe("default");
    expect(afterReset.url).toBe("/canopy/sprawl-full.png");
  });

  it("ignores unknown or malformed persisted slots", () => {
    const map = parseCanopyImageMap({
      "canopy.vsp.small": { path: "canopy-reference/canopy.vsp.small/1.png" },
      "canopy.nope.small": { path: "x.png" },
      "canopy.vsp.large": { path: "" },
      "canopy.vsp.full": "not-an-object",
    });
    expect(Object.keys(map)).toEqual(["canopy.vsp.small"]);
  });

  it("unknown keys have no slot and no default", () => {
    expect(canopyImageSlot("canopy.nope.small")).toBeNull();
    expect(bundledCanopyImageUrl("canopy.nope.small")).toBeNull();
    expect(resolveCanopyImage("canopy.nope.small", null)).toEqual({ url: null, source: "none" });
  });
});

describe("images never influence the calculation", () => {
  it("dilute range and recommendation are identical with or without an override", () => {
    const before = {
      range: canopyDiluteRange("vsp", "large"),
      low: recommendedDiluteLitresPer100m("vsp", "large", "low"),
      high: recommendedDiluteLitresPer100m("vsp", "large", "high"),
    };
    // Applying an override is a pure presentation resolution — it returns a URL
    // and touches nothing else.
    resolveCanopyImage("canopy.vsp.large", "https://cdn/override.png");
    expect({
      range: canopyDiluteRange("vsp", "large"),
      low: recommendedDiluteLitresPer100m("vsp", "large", "low"),
      high: recommendedDiluteLitresPer100m("vsp", "large", "high"),
    }).toEqual(before);
  });
});
