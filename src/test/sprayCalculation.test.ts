import { describe, it, expect } from "vitest";
import {
  fromLegacySprayJob,
  normaliseApplicationMode,
  normaliseCarrierBasis,
  normaliseProductRateBasis,
  legacyTargetCompat,
  buildCandidateApplication,
  emptySprayApplication,
  type SprayProductLine,
} from "@/lib/sprayApplicationDomain";
import {
  resolveBlockGeometry,
  buildApplicationGeometry,
  resolveApplicationGeometry,
} from "@/lib/sprayApplicationGeometry";
import {
  calculateCarrier,
  calculateProducts,
  calculateTanks,
  calculateSprayApplication,
  validateRate,
} from "@/lib/sprayCalculation";
import { readApplicationBlocks, resolveRecordedBlockNames } from "@/lib/sprayRecordAttribution";
import {
  buildChemicalSnapshot,
  readChemicalSnapshot,
  preserveExistingSnapshot,
  shouldCaptureSnapshot,
} from "@/lib/sprayChemicalSnapshot";
import { toChemicalIntelligence } from "@/lib/chemicalIntelligence";

/* -------------------------------------------------------------- fixtures */

/** 10 ha, 3 m rows, no mapped rows → geometry derived from area × spacing. */
const derivedBlock = { id: "b-derived", name: "Derived", area_ha: 10, row_width: 3 };

/** 20 rows × 250 m mapped, 3 m spacing. */
const mappedBlock = {
  id: "b-mapped",
  name: "Mapped",
  area_ha: 1.5,
  row_width: 3,
  rows: Array.from({ length: 20 }, (_, i) => ({ number: i + 1, length: 250 })),
};

const line = (over: Partial<SprayProductLine> = {}): SprayProductLine => ({
  savedChemicalId: "chem-1",
  productName: "Product A",
  rate: 1,
  unit: "L",
  rateBasis: "per_hectare",
  activityGroups: [],
  verificationStatus: "verified",
  ...over,
});

/* ------------------------------------------------------------ vocabulary */

describe("spray vocabulary", () => {
  it("maps legacy operation labels to canonical modes", () => {
    expect(normaliseApplicationMode("Foliar Spray")).toBe("foliar");
    expect(normaliseApplicationMode("banded")).toBe("banded");
    expect(normaliseApplicationMode("Something odd")).toBeNull();
  });

  it("normalises carrier and rate bases including legacy spellings", () => {
    expect(normaliseCarrierBasis("L/100m")).toBe("litres_per_100m");
    expect(normaliseCarrierBasis("litres_per_hectare")).toBe("litres_per_hectare");
    expect(normaliseProductRateBasis("per_100L")).toBe("per_100_litres");
    expect(normaliseProductRateBasis("per_hectare")).toBe("per_hectare");
  });

  it("only maps free-text targets it can prove", () => {
    expect(legacyTargetCompat("Powdery Mildew")).toBe("powdery_mildew");
    expect(legacyTargetCompat("general clean up")).toBeNull();
  });
});

/* -------------------------------------------------------------- geometry */

describe("block geometry precedence", () => {
  it("prefers the operator override over mapped rows", () => {
    const g = resolveBlockGeometry({
      paddock: mappedBlock,
      override: { canonicalRowLengthMetres: 4000, rowSpacingMetres: 2.5 },
      mode: "foliar",
    });
    expect(g.canonicalRowLengthMetres).toBe(4000);
    expect(g.rowSpacingMetres).toBe(2.5);
    expect(g.geometrySource).toBe("operator_override");
  });

  it("uses mapped rows when no override exists", () => {
    const g = resolveBlockGeometry({ paddock: mappedBlock, mode: "foliar" });
    expect(g.canonicalRowLengthMetres).toBe(5000);
    expect(g.rowCount).toBe(20);
    expect(g.geometrySource).toBe("mapped_rows");
  });

  it("derives row length from area and spacing as a last resort", () => {
    const g = resolveBlockGeometry({ paddock: derivedBlock, mode: "foliar" });
    expect(g.geometrySource).toBe("derived_area_spacing");
    expect(g.canonicalRowLengthMetres).toBeCloseTo((10 * 10000) / 3, 6);
    expect(g.geometryQuality).toBe("partial");
  });

  it("reports incomplete geometry instead of guessing", () => {
    const g = resolveBlockGeometry({ paddock: { id: "x", name: "Bare" }, mode: "foliar" });
    expect(g.geometrySource).toBe("incomplete");
    expect(g.geometryQuality).toBe("incomplete");
    expect(g.issues).toContain("missing_gross_area");
  });

  it("treats the whole block for foliar and the band only for banded", () => {
    const foliar = resolveBlockGeometry({ paddock: mappedBlock, mode: "foliar" });
    expect(foliar.treatedAreaHa).toBeCloseTo(1.5, 6);
    const banded = resolveBlockGeometry({
      paddock: mappedBlock,
      mode: "banded",
      totalTreatedBandWidthMetres: 1,
    });
    // 5000 m of row × 1 m band = 5000 m² = 0.5 ha
    expect(banded.treatedAreaHa).toBeCloseTo(0.5, 6);
  });

  it("flags banded applications with no band width", () => {
    const g = resolveBlockGeometry({ paddock: mappedBlock, mode: "banded" });
    expect(g.issues).toContain("missing_band_width");
    expect(g.treatedAreaHa).toBeNull();
  });

  it("aggregates mixed row spacing with a warning", () => {
    const a = resolveBlockGeometry({ paddock: mappedBlock, mode: "foliar" });
    const b = resolveBlockGeometry({
      paddock: { ...derivedBlock, row_width: 2 },
      mode: "foliar",
    });
    const agg = buildApplicationGeometry([a, b]);
    expect(agg.uniformRowSpacing).toBe(false);
    expect(agg.issues).toContain("mixed_row_spacing");
    expect(agg.grossAreaHa).toBeCloseTo(11.5, 6);
    expect(agg.geometrySource).toBe("derived_area_spacing");
  });

  it("resolves a whole application from paddock rows", () => {
    const agg = resolveApplicationGeometry({
      paddocks: [mappedBlock, derivedBlock],
      blockIds: ["b-mapped"],
      mode: "foliar",
    });
    expect(agg.blocks).toHaveLength(1);
    expect(agg.treatedAreaHa).toBeCloseTo(1.5, 6);
  });
});

/* --------------------------------------------------------------- carrier */

describe("carrier volume", () => {
  const geometry = buildApplicationGeometry([
    resolveBlockGeometry({ paddock: mappedBlock, mode: "foliar" }),
  ]);

  it("computes total litres from L/ha", () => {
    const c = calculateCarrier({
      geometry,
      mode: "foliar",
      carrier: { basis: "litres_per_hectare", litresPerHectare: 400 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(600, 6); // 400 × 1.5 ha
    expect(c.litresPer100m).toBeCloseTo(12, 6); // 400 × 3 / 100
  });

  it("computes total litres from L/100 m and derives L/ha", () => {
    const c = calculateCarrier({
      geometry,
      mode: "foliar",
      carrier: { basis: "litres_per_100m", appliedLitresPer100m: 12 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(600, 6); // 5000 m / 100 × 12
    expect(c.litresPerHectare).toBeCloseTo(400, 6); // 12 × 100 / 3
  });

  it("derives the concentration factor from dilute ÷ applied", () => {
    const c = calculateCarrier({
      geometry,
      mode: "foliar",
      carrier: { basis: "litres_per_100m", appliedLitresPer100m: 5, diluteLitresPer100m: 20 },
    });
    expect(c.concentrationFactor).toBeCloseTo(4, 6);
  });

  it("applies a banded L/ha rate to the treated hectares", () => {
    const banded = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: mappedBlock, mode: "banded", totalTreatedBandWidthMetres: 1 }),
    ]);
    const c = calculateCarrier({
      geometry: banded,
      mode: "banded",
      carrier: { basis: "litres_per_hectare", litresPerHectare: 400 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(200, 6); // 400 × 0.5 ha
  });

  it("does not require a carrier for spreader applications", () => {
    const c = calculateCarrier({ geometry, mode: "spreader", carrier: { basis: null } });
    expect(c.totalCarrierLitres).toBeNull();
    expect(c.diagnostics.every((d) => d.severity !== "error")).toBe(true);
  });

  it("refuses to compute when geometry is incomplete", () => {
    const bare = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: { id: "x" }, mode: "foliar" }),
    ]);
    const c = calculateCarrier({
      geometry: bare,
      mode: "foliar",
      carrier: { basis: "litres_per_hectare", litresPerHectare: 400 },
    });
    expect(c.totalCarrierLitres).toBeNull();
    expect(c.diagnostics.map((d) => d.code)).toContain("incomplete_geometry_for_carrier");
  });
});

/* -------------------------------------------------------------- products */

describe("product quantities", () => {
  const geometry = buildApplicationGeometry([
    resolveBlockGeometry({ paddock: mappedBlock, mode: "banded", totalTreatedBandWidthMetres: 1 }),
  ]);
  const carrier = calculateCarrier({
    geometry,
    mode: "banded",
    carrier: { basis: "litres_per_hectare", litresPerHectare: 400 },
  });

  it("keeps gross and treated hectares distinct", () => {
    const [gross, treated] = calculateProducts({
      products: [line({ rate: 2 }), line({ rate: 2, rateBasis: "per_treated_hectare" })],
      geometry,
      carrier,
    });
    expect(gross.totalQuantity).toBeCloseTo(3, 6); // 2 × 1.5 gross ha
    expect(treated.totalQuantity).toBeCloseTo(1, 6); // 2 × 0.5 treated ha
  });

  it("computes per-100 L rates from the carrier volume", () => {
    const [p] = calculateProducts({
      products: [line({ rate: 250, unit: "mL", rateBasis: "per_100_litres" })],
      geometry,
      carrier,
    });
    expect(p.totalQuantity).toBeCloseTo(500, 6); // 200 L / 100 × 250
  });

  it("errors when a per-100 L rate has no carrier volume", () => {
    const noCarrier = calculateCarrier({ geometry, mode: "spreader", carrier: { basis: null } });
    const [p] = calculateProducts({
      products: [line({ rateBasis: "per_100_litres" })],
      geometry,
      carrier: noCarrier,
    });
    expect(p.totalQuantity).toBeNull();
    expect(p.diagnostics.map((d) => d.code)).toContain("per_100l_needs_carrier");
  });

  it("validates the entered rate against the label range without changing it", () => {
    expect(validateRate(line({ rate: 1.5, labelMinRate: 1, labelMaxRate: 2 }))).toBe("in_range");
    expect(validateRate(line({ rate: 3, labelMinRate: 1, labelMaxRate: 2 }))).toBe("above_range");
    expect(validateRate(line({ rate: 0.5, labelMinRate: 1, labelMaxRate: 2 }))).toBe("below_range");
    expect(validateRate(line({ rate: 3 }))).toBe("unable_to_validate");
  });
});

/* ----------------------------------------------------------------- tanks */

describe("tank splitting", () => {
  it("splits full tanks plus a partial and conserves product totals", () => {
    const products = [
      { index: 0, savedChemicalId: null, productName: "A", rate: 1, unit: "L", rateBasis: "per_hectare" as const, totalQuantity: 10, multiplier: 10, multiplierKind: "gross_hectares" as const, rateValidation: "unable_to_validate" as const, diagnostics: [] },
    ];
    const t = calculateTanks({ totalCarrierLitres: 2500, tankCapacityLitres: 1000, products });
    expect(t.fullTanks).toBe(2);
    expect(t.tanks).toHaveLength(3);
    expect(t.partialTankLitres).toBeCloseTo(500, 6);
    const sum = t.tanks.reduce((acc, tank) => acc + (tank.products[0].quantity ?? 0), 0);
    expect(sum).toBeCloseTo(10, 9);
    expect(t.tanks[2].isPartial).toBe(true);
  });

  it("warns instead of guessing when no tank capacity is known", () => {
    const t = calculateTanks({ totalCarrierLitres: 1000, tankCapacityLitres: null, products: [] });
    expect(t.tanks).toHaveLength(0);
    expect(t.diagnostics.map((d) => d.code)).toContain("missing_tank_capacity");
  });
});

/* ------------------------------------------------------- legacy adapter */

describe("legacy spray job adapter", () => {
  it("loads a legacy L/ha foliar job without inventing values", () => {
    const app = fromLegacySprayJob(
      {
        id: "j1",
        vineyard_id: "v1",
        operation_type: "Foliar Spray",
        target: "Powdery Mildew",
        spray_rate_per_ha: 400,
        water_volume: 2000,
        chemical_lines: [
          { savedChemicalId: "chem-1", name: "Product A", rate: 1.2, unit: "L/ha", ratePerHa: 1.2 },
          { name: "Product B", rate: 250, unit: "mL/100L", ratePer100L: 250 },
        ],
      } as any,
      { paddockIds: ["b-mapped"] },
    );
    expect(app.mode).toBe("foliar");
    expect(app.targets).toEqual(["powdery_mildew"]);
    expect(app.carrier.basis).toBe("litres_per_hectare");
    expect(app.products[0].rateBasis).toBe("per_hectare");
    expect(app.products[0].unit).toBe("L");
    expect(app.products[1].rateBasis).toBe("per_100_litres");
    expect(app.compatibilityNotes.some((n) => n.includes("not linked"))).toBe(true);
    expect(app.blockIds).toEqual(["b-mapped"]);
  });

  it("prefers persisted structured columns over legacy ones", () => {
    const app = fromLegacySprayJob(
      {
        id: "j2",
        vineyard_id: "v1",
        operation_type: "Foliar Spray",
        application_mode: "banded",
        targets: ["botrytis", "not_a_target"],
        carrier_volume_basis: "litres_per_100m",
        applied_litres_per_100m: 12,
        band_width_total_metres: 1,
        spray_head_target: "bunch_line",
      } as any,
      {},
    );
    expect(app.mode).toBe("banded");
    expect(app.targets).toEqual(["botrytis"]);
    expect(app.carrier.basis).toBe("litres_per_100m");
    expect(app.headTarget).toBe("bunch_line");
    expect(app.totalTreatedBandWidthMetres).toBe(1);
  });

  it("builds a resistance candidate without evaluating anything", () => {
    const app = emptySprayApplication();
    app.targets = ["botrytis"];
    app.products = [line({ activityGroups: [{ scheme: "frac", code: "11" }] })];
    const candidate = buildCandidateApplication(app, "complete");
    expect(candidate.products[0].activityGroups[0].code).toBe("11");
    expect(candidate.geometryQuality).toBe("complete");
  });
});

/* -------------------------------------------------------- orchestration */

describe("full calculation", () => {
  it("blocks recording while errors remain and clears once complete", () => {
    const app = emptySprayApplication();
    app.mode = "foliar";
    app.carrier = { basis: "litres_per_hectare", litresPerHectare: 400 };
    app.products = [line({ rate: 1.2 })];
    app.tankCapacityLitres = 400;

    const incomplete = calculateSprayApplication({
      application: app,
      geometry: buildApplicationGeometry([]),
    });
    expect(incomplete.canRecord).toBe(false);

    const ok = calculateSprayApplication({
      application: app,
      geometry: buildApplicationGeometry([
        resolveBlockGeometry({ paddock: mappedBlock, mode: "foliar" }),
      ]),
    });
    expect(ok.canRecord).toBe(true);
    expect(ok.carrier.totalCarrierLitres).toBeCloseTo(600, 6);
    expect(ok.products[0].totalQuantity).toBeCloseTo(1.8, 6);
    expect(ok.tanks.tanks).toHaveLength(2);
  });
});

/* ------------------------------------------------------------ snapshots */

describe("chemical snapshots", () => {
  const structuredRow = {
    id: "5b8e0f7e-2f6a-4b6e-9dc4-1a2b3c4d5e6f",
    name: "Example Duo Fungicide",
    active_ingredients: [
      { name: "Azoxystrobin", concentration: 250, concentration_unit: "g/L", activity_group: { scheme: "frac", code: "11" } },
    ],
    activity_groups: ["11"],
    activity_group_scheme: "frac",
    verification_status: "verified",
    registration_country: "AU",
    registration_scheme: "apvma",
    registration_number: "70001",
    intelligence_schema_version: 1,
  };

  it("captures only at record time", () => {
    expect(shouldCaptureSnapshot("planning")).toBe(false);
    expect(shouldCaptureSnapshot("recording")).toBe(true);
  });

  it("writes the canonical snake_case shape", () => {
    const snap = buildChemicalSnapshot(toChemicalIntelligence(structuredRow), {
      capturedAt: "2026-08-15T00:00:00.000Z",
    });
    expect(snap).toMatchObject({
      saved_chemical_id: structuredRow.id,
      product_name: "Example Duo Fungicide",
      activity_groups: ["11"],
      verification_status: "verified",
      registration_identity_key: "AU:apvma:70001",
      country_code: "AU",
      schema_version: 1,
      activity_group_table_version: 1,
      captured_at: "2026-08-15T00:00:00.000Z",
    });
    expect(snap.active_ingredients[0]).toMatchObject({
      name: "Azoxystrobin",
      concentration: 250,
      concentration_unit: "g/L",
      activity_group: { scheme: "frac", code: "11" },
    });
  });

  it("stays honest for legacy-only chemicals", () => {
    const snap = buildChemicalSnapshot(
      toChemicalIntelligence({ id: "c2", name: "Old Product", chemical_group: "3 + 11" }),
    );
    expect(snap.schema_version).toBe(0);
    expect(snap.verification_status).toBe("unverified");
    expect(snap.activity_groups).toEqual([]);
    expect(snap.legacy_chemical_group).toBe("3 + 11");
  });

  it("round-trips and never overwrites recorded history", () => {
    const snap = buildChemicalSnapshot(toChemicalIntelligence(structuredRow), {
      capturedAt: "2026-08-15T00:00:00.000Z",
    });
    expect(readChemicalSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    const newer = buildChemicalSnapshot(toChemicalIntelligence({ ...structuredRow, name: "Renamed" }));
    expect(preserveExistingSnapshot(snap, newer)?.product_name).toBe("Example Duo Fungicide");
    expect(readChemicalSnapshot("nonsense")).toBeNull();
  });
});

/* --------------------------------------------------- record attribution */

describe("recorded block attribution", () => {
  it("reads structured application_blocks", () => {
    const attr = readApplicationBlocks({
      application_blocks: [
        { blockId: "B-MAPPED", blockName: "Mapped", grossAreaHa: 1.5, treatedAreaHa: 0.5, geometrySource: "mapped_rows" },
      ],
    });
    expect(attr.status).toBe("recorded");
    const display = resolveRecordedBlockNames(attr, [{ id: "b-mapped", name: "Mapped North" }]);
    expect(display[0].displayName).toBe("Mapped North");
    expect(display[0].missingFromVineyard).toBe(false);
  });

  it("falls back to legacy block_ids and flags deleted blocks", () => {
    const attr = readApplicationBlocks({ block_ids: ["gone"] });
    const display = resolveRecordedBlockNames(attr, []);
    expect(display[0].missingFromVineyard).toBe(true);
    expect(display[0].displayName).toBe("Unknown block");
  });

  it("says nothing was recorded rather than re-deriving today's blocks", () => {
    expect(readApplicationBlocks({}).status).toBe("not_recorded");
  });
});
