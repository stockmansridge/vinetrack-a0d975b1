// Canopy Reference Images — override, fallback and calculation isolation.
import { describe, it, expect } from "vitest";
import {
  CANOPY_IMAGE_SLOTS,
  bundledCanopyImageUrl,
  canopyImageKey,
  canopyImageSlot,
  resolveCanopyImage,
} from "@/lib/canopyImages";
import { parseCanopyImageMap, parseCanopyImagePayload } from "@/lib/canopyImageStore";
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

// ---------------------------------------------------------------------------
// Cross-platform read contract: get_canopy_reference_images_v1()
// ---------------------------------------------------------------------------
describe("get_canopy_reference_images_v1 payload contract", () => {
  const payload = (images: Record<string, unknown>) => ({
    bucket: "guide-images",
    config_updated_at: "2026-09-09T02:33:03.509Z",
    images,
  });

  it("keeps every configured semantic key and its exact path/updated_at", () => {
    const images = {
      "canopy.vsp.small": {
        path: "canopy-reference/canopy.vsp.small/1757383593677.png",
        updated_at: "2026-09-09T02:26:33.677Z",
      },
      "canopy.sprawl.full": {
        path: "canopy-reference/canopy.sprawl.full/1757383599999.webp",
        updated_at: "2026-09-09T02:27:00.000Z",
      },
    };
    const map = parseCanopyImagePayload(payload(images));
    expect(map).toEqual(images);
  });

  it("returns only canopy image configuration — other feature flags are not part of the payload", () => {
    const map = parseCanopyImagePayload(
      payload({
        "canopy.vsp.large": { path: "canopy-reference/canopy.vsp.large/1.png" },
        "chemical_search_v2": { path: "should-be-ignored.png" },
        "spray.something_else": { path: "x.png" },
      }),
    );
    expect(Object.keys(map)).toEqual(["canopy.vsp.large"]);
  });

  it("a slot missing from images resolves to the bundled default", () => {
    const map = parseCanopyImagePayload(payload({}));
    expect(map["canopy.vsp.medium"]).toBeUndefined();
    expect(resolveCanopyImage("canopy.vsp.medium", undefined)).toEqual({
      url: "/canopy/vsp-medium.png",
      source: "default",
    });
  });

  it("replacing one image changes only that slot", () => {
    const before = {
      "canopy.vsp.small": { path: "canopy-reference/canopy.vsp.small/1.png", updated_at: "a" },
      "canopy.vsp.large": { path: "canopy-reference/canopy.vsp.large/2.png", updated_at: "b" },
    };
    const after = parseCanopyImagePayload(
      payload({
        ...before,
        "canopy.vsp.small": { path: "canopy-reference/canopy.vsp.small/3.png", updated_at: "c" },
      }),
    );
    expect(after["canopy.vsp.large"]).toEqual(before["canopy.vsp.large"]);
    expect(after["canopy.vsp.small"]).toEqual({
      path: "canopy-reference/canopy.vsp.small/3.png",
      updated_at: "c",
    });
  });

  it("resetting one image removes only that slot from the custom map", () => {
    const after = parseCanopyImagePayload(
      payload({ "canopy.vsp.large": { path: "canopy-reference/canopy.vsp.large/2.png" } }),
    );
    expect(after["canopy.vsp.small"]).toBeUndefined();
    expect(after["canopy.vsp.large"]).toBeDefined();
    // Portal rendering still falls back custom → bundled for the reset slot.
    expect(resolveCanopyImage("canopy.vsp.small", undefined).source).toBe("default");
  });

  it("tolerates an empty or unavailable payload (e.g. anonymous caller denied)", () => {
    expect(parseCanopyImagePayload(null)).toEqual({});
    expect(parseCanopyImagePayload(undefined)).toEqual({});
    expect(parseCanopyImagePayload({ bucket: "guide-images" })).toEqual({});
  });
});
