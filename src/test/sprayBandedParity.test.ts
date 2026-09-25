// Portal Banded (Undervine / Midrow) parity with the iOS/Android ground-spray
// contract, plus planning-mode behaviour (Planned Spray saveable without blocks).
import { describe, expect, it } from "vitest";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import { applyOperationType, evaluateSaveGate, hydrateDraft } from "@/lib/sprayApplicationDraft";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { fromLegacySprayJob, type SprayApplication } from "@/lib/sprayApplicationDomain";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";

// 10 ha gross, 3.2 m rows → 31,250 m of row; 0.8 m band → 2.5 treated ha.
const geo = (over: Partial<ApplicationGeometry> = {}): ApplicationGeometry =>
  ({
    grossAreaHa: 10,
    treatedAreaHa: 2.5,
    canonicalRowLengthMetres: 31_250,
    rowSpacingMetres: 3.2,
    uniformRowSpacing: true,
    geometrySource: "mapped_rows",
    geometryQuality: "complete",
    blocks: [],
    issues: [],
    ...over,
  }) as unknown as ApplicationGeometry;

const emptyGeo = () =>
  geo({ grossAreaHa: null, treatedAreaHa: null, canonicalRowLengthMetres: null, rowSpacingMetres: null } as any);

function foliar(): SprayApplication {
  const a = hydrateDraft({ vineyardId: "v1", job: null, isTemplate: false });
  a.name = "Test";
  a.blockIds = ["b1"];
  const f = applyOperationType(a, "foliar");
  f.headTarget = "full_canopy";
  f.carrier = {
    basis: "l_per_100m",
    canopyType: "vsp",
    canopySize: "large",
    canopyDensity: "high",
    sprayerOutputChoice: "custom",
    appliedLitresPer100m: 20,
    litresPerHectare: 600,
  } as any;
  return f;
}

function banded(over: Partial<SprayApplication["carrier"]> = {}, target: "undervine" | "midrow" = "undervine") {
  const a = applyOperationType(foliar(), "banded");
  a.groundApplicationTarget = target;
  a.totalTreatedBandWidthMetres = 0.8;
  a.carrier = { ...a.carrier, basis: "l_per_ha", litresPerHectare: 200, carrierAreaBasis: "treated_area", ...over };
  return a;
}

describe("A — Foliar", () => {
  it("keeps canopy recommendation and concentration logic", () => {
    const c = calculateSprayApplication({ application: foliar(), geometry: geo() });
    expect(c.carrier.recommendedDiluteLitresPer100m).not.toBeNull();
    expect(c.carrier.concentrationFactor).not.toBeNull();
    expect(c.carrier.carrierAreaHa).toBe(10);
  });
});

describe("B — Banded Undervine, treated-area carrier", () => {
  it("200 L/treated ha × 2.5 ha = 500 L, no canopy, CF not used", () => {
    const app = banded();
    const c = calculateSprayApplication({ application: app, geometry: geo() });
    expect(app.groundApplicationTarget).toBe("undervine");
    expect(c.carrier.carrierAreaHa).toBe(2.5);
    expect(c.carrier.totalCarrierLitres).toBe(500);
    expect(c.carrier.recommendedDiluteLitresPer100m).toBeNull();
    expect(c.carrier.recommendedDiluteLitresPerHectare).toBeNull();
    expect(c.carrier.concentrationFactor).toBeNull();
    expect(c.carrier.appliedFromRecommendation).toBe(false);
    expect(c.carrier.litresPer100m).toBeNull();
  });
});

describe("C — Banded whole-block carrier", () => {
  it("200 L/gross ha × 10 ha = 2,000 L; treated-area product still uses 2.5 ha", () => {
    const app = banded({ carrierAreaBasis: "whole_block_area" });
    app.products = [
      { savedChemicalId: "c1", productName: "Herb", rate: 2, unit: "L", rateBasis: "treated_area", activityGroups: [], verificationStatus: "unverified" } as any,
    ];
    const c = calculateSprayApplication({ application: app, geometry: geo() });
    expect(c.carrier.totalCarrierLitres).toBe(2000);
    expect(c.products[0].multiplier).toBe(2.5);
    expect(c.products[0].totalQuantity).toBe(5);
  });

  it("requires an explicit carrier area basis — never assumes gross", () => {
    const c = calculateSprayApplication({ application: banded({ carrierAreaBasis: null }), geometry: geo() });
    expect(c.carrier.totalCarrierLitres).toBeNull();
    expect(c.diagnostics.map((d) => d.code)).toContain("missing_carrier_area_basis");
  });
});

describe("D — Banded Manual total water", () => {
  it("uses only the entered total, no canopy/CF", () => {
    const c = calculateSprayApplication({
      application: banded({ basis: "manual", manualTotalLitres: 750 }),
      geometry: geo(),
    });
    expect(c.carrier.totalCarrierLitres).toBe(750);
    expect(c.carrier.derivedRatesAreReferenceOnly).toBe(true);
    expect(c.carrier.recommendedDiluteLitresPer100m).toBeNull();
    expect(c.carrier.concentrationFactor).toBeNull();
  });
});

describe("E — Midrow", () => {
  it("same maths, persists midrow", () => {
    const app = banded({}, "midrow");
    const c = calculateSprayApplication({ application: app, geometry: geo() });
    expect(c.carrier.totalCarrierLitres).toBe(500);
    const { input } = toSprayJobInput({ application: app, geometry: geo(), calculation: c });
    expect(input.ground_application_target).toBe("midrow");
  });
});

describe("F — Foliar → Banded", () => {
  it("clears head target and every canopy value", () => {
    const b = applyOperationType(foliar(), "banded");
    expect(b.headTarget).toBeNull();
    expect(b.groundApplicationTarget).toBeNull();
    expect(b.carrier.basis).toBe("l_per_ha");
    expect(b.carrier.canopyType ?? null).toBeNull();
    expect(b.carrier.canopySize ?? null).toBeNull();
    expect(b.carrier.canopyDensity ?? null).toBeNull();
    expect(b.carrier.appliedLitresPer100m ?? null).toBeNull();
    expect(b.carrier.litresPerHectare ?? null).toBeNull();
    expect(b.carrier.sprayerOutputChoice ?? null).toBeNull();
    expect(b.carrier.carrierAreaBasis ?? null).toBeNull();
    const c = calculateSprayApplication({ application: b, geometry: geo() });
    const codes = c.diagnostics.map((d) => d.code);
    expect(codes).toContain("missing_ground_application_target");
    expect(c.carrier.recommendedDiluteLitresPer100m).toBeNull();
  });

  it("keeps a deliberate Manual total water", () => {
    const f = foliar();
    f.carrier = { basis: "manual", manualTotalLitres: 400 };
    expect(applyOperationType(f, "banded").carrier).toMatchObject({ basis: "manual", manualTotalLitres: 400 });
  });
});

describe("G — Banded → Foliar", () => {
  it("clears ground target, band width and carrier area basis", () => {
    const f = applyOperationType(banded(), "foliar");
    expect(f.groundApplicationTarget).toBeNull();
    expect(f.totalTreatedBandWidthMetres).toBeNull();
    expect(f.carrier.carrierAreaBasis ?? null).toBeNull();
    const c = calculateSprayApplication({ application: f, geometry: geo() });
    expect(c.carrier.carrierAreaHa).toBe(10);
  });
});

describe("Persistence and round-trip", () => {
  it("writes the Banded contract with no canopy facts and reopens it intact", () => {
    const app = banded();
    const c = calculateSprayApplication({ application: app, geometry: geo() });
    const { input } = toSprayJobInput({ application: app, geometry: geo(), calculation: c });
    expect(input).toMatchObject({
      operation_type: "Banded Spray",
      application_mode: "banded",
      ground_application_target: "undervine",
      carrier_area_basis: "treated_area",
      band_width_total_metres: 0.8,
      carrier_volume_basis: "l_per_ha",
      spray_rate_per_ha: 200,
      water_volume: 500,
      gross_area_ha: 10,
      treated_area_ha: 2.5,
      vsp_canopy_size: null,
      vsp_canopy_density: null,
      dilute_litres_per_100m: null,
      applied_litres_per_100m: null,
      concentration_factor: null,
      spray_head_target: null,
    });
    const back = fromLegacySprayJob({ id: "j1", ...input } as any, { paddockIds: ["b1"] });
    expect(back.groundApplicationTarget).toBe("undervine");
    expect(back.carrier.carrierAreaBasis).toBe("treated_area");
    expect(back.carrier.litresPerHectare).toBe(200);
    expect(back.totalTreatedBandWidthMetres).toBe(0.8);
  });

  it("historical canopy values on a Banded row never drive the calculation", () => {
    const back = fromLegacySprayJob({
      id: "j2", vineyard_id: "v1", operation_type: "Banded Spray", application_mode: "banded",
      carrier_volume_basis: "l_per_ha", spray_rate_per_ha: 200, carrier_area_basis: "whole_block_area",
      vsp_canopy_size: "Large", vsp_canopy_density: "High", concentration_factor: 2.5,
      dilute_litres_per_100m: 40, band_width_total_metres: 0.8, ground_application_target: "undervine",
    } as any);
    expect(back.carrier.canopySize).toBeNull();
    expect(back.carrier.concentrationFactor).toBeNull();
    const c = calculateSprayApplication({ application: back, geometry: geo() });
    expect(c.carrier.concentrationFactor).toBeNull();
    expect(c.carrier.totalCarrierLitres).toBe(2000);
  });
});

describe("Planning mode", () => {
  it("a Planned Banded Spray with no blocks saves its intent and defers totals", () => {
    const app = banded();
    app.blockIds = [];
    const c = calculateSprayApplication({ application: app, geometry: emptyGeo() });
    expect(c.blocksDeferred).toBe(true);
    expect(c.carrier.totalCarrierLitres).toBeNull();
    const gate = evaluateSaveGate({ application: app, calculation: c });
    expect(gate.canSave).toBe(true);
    const { input, paddockIds } = toSprayJobInput({ application: app, geometry: emptyGeo(), calculation: c });
    expect(paddockIds).toEqual([]);
    expect(input).toMatchObject({
      ground_application_target: "undervine",
      carrier_area_basis: "treated_area",
      band_width_total_metres: 0.8,
      spray_rate_per_ha: 200,
      water_volume: null,
      treated_area_ha: null,
      gross_area_ha: null,
    });
    expect(c.diagnostics.find((d) => d.message === "Calculated when blocks are confirmed.")).toBeTruthy();
  });

  it("with intended blocks, shows planning estimates", () => {
    const c = calculateSprayApplication({ application: banded(), geometry: geo() });
    expect(c.blocksDeferred).toBe(false);
    expect(c.carrier.totalCarrierLitres).toBe(500);
  });

  it("confirmed blocks recompute totals rather than reusing the earlier estimate", () => {
    const app = banded();
    const first = calculateSprayApplication({ application: app, geometry: geo() });
    const saved = toSprayJobInput({ application: app, geometry: geo(), calculation: first }).input;
    const reopened = fromLegacySprayJob({ id: "j3", ...saved } as any, { paddockIds: ["b1", "b2"] });
    const confirmed = calculateSprayApplication({
      application: reopened,
      geometry: geo({ grossAreaHa: 20, treatedAreaHa: 5 }),
    });
    expect(confirmed.carrier.totalCarrierLitres).toBe(1000);
  });

  it("a Program Step never requires blocks", () => {
    const app = banded();
    app.isTemplate = true;
    app.blockIds = [];
    const c = calculateSprayApplication({ application: app, geometry: emptyGeo() });
    expect(evaluateSaveGate({ application: app, calculation: c }).canSave).toBe(true);
    const { input } = toSprayJobInput({ application: app, geometry: emptyGeo(), calculation: c });
    expect(input.water_volume).toBeNull();
    expect(input.ground_application_target).toBe("undervine");
  });
});
