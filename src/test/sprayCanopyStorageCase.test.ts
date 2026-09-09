// Canopy persistence casing: `spray_jobs` check constraints require title-case
// canopy values, while the wizard and the AWRI maths stay lowercase.
import { describe, it, expect } from "vitest";
import {
  canopyDensityForStorage,
  canopySizeForStorage,
  toSprayJobInput,
} from "@/lib/sprayApplicationSave";
import { hydrateDraft } from "@/lib/sprayApplicationDraft";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { normaliseCanopyDensity, normaliseCanopySize } from "@/lib/sprayCanopy";

function build(carrier: Record<string, unknown>) {
  const app = hydrateDraft({ vineyardId: "v1", job: null, isTemplate: false }) as any;
  app.operationType = "foliar";
  app.carrier = { ...app.carrier, ...carrier };
  const geometry = resolveApplicationGeometry({
    paddocks: [],
    blockIds: [],
    mode: app.mode,
    override: app.geometryOverride,
    totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
  } as any);
  const calculation = calculateSprayApplication({ application: app, geometry } as any);
  const { input } = toSprayJobInput({ application: app, geometry, calculation });
  return { input, calculation };
}

describe("canopy storage mapping", () => {
  it("maps every size to its title-case storage value", () => {
    expect(canopySizeForStorage("small")).toBe("Small");
    expect(canopySizeForStorage("medium")).toBe("Medium");
    expect(canopySizeForStorage("large")).toBe("Large");
    expect(canopySizeForStorage("full")).toBe("Full");
  });

  it("maps every density to its title-case storage value", () => {
    expect(canopyDensityForStorage("low")).toBe("Low");
    expect(canopyDensityForStorage("high")).toBe("High");
  });

  it("keeps null for unanswered or invalid values, inventing no default", () => {
    for (const v of [null, undefined, "", "  ", "enormous", 3]) {
      expect(canopySizeForStorage(v)).toBeNull();
      expect(canopyDensityForStorage(v)).toBeNull();
    }
  });

  it("round-trips stored title-case values back to lowercase on reopen", () => {
    expect(normaliseCanopySize("Small")).toBe("small");
    expect(normaliseCanopySize("Medium")).toBe("medium");
    expect(normaliseCanopySize("Large")).toBe("large");
    expect(normaliseCanopySize("Full")).toBe("full");
    expect(normaliseCanopyDensity("Low")).toBe("low");
    expect(normaliseCanopyDensity("High")).toBe("high");
  });
});

describe("canopy values in the saved payload", () => {
  it("writes title-case canopy values for a canopy-based application", () => {
    const { input } = build({
      basis: "l_per_ha",
      litresPerHectare: 500,
      canopyType: "vsp",
      canopySize: "large",
      canopyDensity: "high",
    });
    expect(input.vsp_canopy_size).toBe("Large");
    expect(input.vsp_canopy_density).toBe("High");
  });

  it("leaves canopy values null when unanswered", () => {
    const { input } = build({ basis: "l_per_ha", litresPerHectare: 500 });
    expect(input.vsp_canopy_size ?? null).toBeNull();
    expect(input.vsp_canopy_density ?? null).toBeNull();
  });

  it("leaves canopy values null for a manual total-water application", () => {
    const { input } = build({
      basis: "manual",
      manualTotalLitres: 800,
      canopySize: "small",
      canopyDensity: "low",
    });
    expect(input.vsp_canopy_size ?? null).toBeNull();
    expect(input.vsp_canopy_density ?? null).toBeNull();
    expect(input.water_volume).toBe(800);
    expect(input.concentration_factor).toBe(1);
  });

  it("does not alter water volume, concentration factor or chemical lines", () => {
    const carrier = {
      basis: "l_per_ha" as const,
      litresPerHectare: 500,
      canopyType: "vsp",
      canopySize: "medium",
      canopyDensity: "low",
    };
    const { input, calculation } = build(carrier);
    expect(input.spray_rate_per_ha).toBe(500);
    const cf = calculation.carrier.concentrationFactor;
    expect(input.concentration_factor).toBe(
      cf == null || !Number.isFinite(cf) ? null : Math.round(cf * 1000) / 1000,
    );
    expect(input.chemical_lines).toEqual([]);
  });
});
