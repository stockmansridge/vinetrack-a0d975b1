import { describe, it, expect } from "vitest";
import {
  fromLegacySprayJob,
  normaliseApplicationMode,
  normaliseOperationType,
  normaliseCarrierBasis,
  normaliseCarrierBasisPreference,
  normaliseProductRateBasis,
  legacyTargetCompat,
  buildCandidateApplication,
  emptySprayApplication,
  persistedHeadTarget,
  APPLICATION_MODES,
  CARRIER_BASES,
  PRODUCT_RATE_BASES,
  OPERATION_TYPE_TO_MODE,
  type SprayProductLine,
} from "@/lib/sprayApplicationDomain";
import {
  resolveBlockGeometry,
  buildApplicationGeometry,
  resolveApplicationGeometry,
  normaliseGeometrySource,
} from "@/lib/sprayApplicationGeometry";
import {
  calculateCarrier,
  calculateProducts,
  calculateTanks,
  calculateSprayApplication,
  concentrationFactorFrom,
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

/** Rork mandatory fixture: 10 ha gross, 2.5 m spacing. */
const bandedBlock = { id: "b-banded", name: "Banded", area_ha: 10, row_width: 2.5 };

const line = (over: Partial<SprayProductLine> = {}): SprayProductLine => ({
  savedChemicalId: "chem-1",
  productName: "Product A",
  rate: 1,
  unit: "L",
  rateBasis: "whole_block_area",
  activityGroups: [],
  verificationStatus: "verified",
  ...over,
});

/* ------------------------------------------------------------ vocabulary */

describe("spray vocabulary (Rork-confirmed raw values)", () => {
  it("has exactly two application modes", () => {
    expect(APPLICATION_MODES).toEqual(["whole_block", "banded"]);
  });

  it("maps legacy operation types to the canonical mode", () => {
    expect(normaliseApplicationMode("Foliar Spray")).toBe("whole_block");
    expect(normaliseApplicationMode("Spreader")).toBe("whole_block");
    expect(normaliseApplicationMode("Banded Spray")).toBe("banded");
    expect(OPERATION_TYPE_TO_MODE.foliar).toBe("whole_block");
    expect(OPERATION_TYPE_TO_MODE.spreader).toBe("whole_block");
    expect(OPERATION_TYPE_TO_MODE.banded).toBe("banded");
    expect(normaliseApplicationMode("Something odd")).toBeNull();
    expect(normaliseOperationType("Foliar Spray")).toBe("foliar");
  });

  it("uses l_per_ha / l_per_100m carrier raws and tolerates legacy spellings", () => {
    expect(CARRIER_BASES).toEqual(["l_per_ha", "l_per_100m"]);
    expect(normaliseCarrierBasis("L/100m")).toBe("l_per_100m");
    expect(normaliseCarrierBasis("litres_per_hectare")).toBe("l_per_ha");
    expect(normaliseCarrierBasis("litres_per_100m")).toBe("l_per_100m");
    // "either" is a vineyard preference only, never an application basis.
    expect(normaliseCarrierBasis("either")).toBeNull();
    expect(normaliseCarrierBasisPreference("either")).toBe("either");
  });

  it("has the four canonical product rate bases", () => {
    expect(PRODUCT_RATE_BASES).toEqual([
      "whole_block_area",
      "treated_area",
      "per_100_litres",
      "per_100_metres",
    ]);
    expect(normaliseProductRateBasis("per_100L")).toBe("per_100_litres");
    expect(normaliseProductRateBasis("per_100m")).toBe("per_100_metres");
    expect(normaliseProductRateBasis("per_hectare")).toBe("whole_block_area");
    expect(normaliseProductRateBasis("per_treated_hectare")).toBe("treated_area");
  });

  it("keeps head target foliar-only", () => {
    expect(persistedHeadTarget("foliar", "bunch_line")).toBe("bunch_line");
    expect(persistedHeadTarget("banded", "bunch_line")).toBeNull();
    expect(persistedHeadTarget("spreader", "full_canopy")).toBeNull();
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
      mode: "whole_block",
    });
    expect(g.canonicalRowLengthMetres).toBe(4000);
    expect(g.rowSpacingMetres).toBe(2.5);
    expect(g.geometrySource).toBe("operator_override");
    expect(g.geometryQuality).toBe("authoritative");
  });

  it("uses mapped rows when no override exists", () => {
    const g = resolveBlockGeometry({ paddock: mappedBlock, mode: "whole_block" });
    expect(g.canonicalRowLengthMetres).toBe(5000);
    expect(g.rowCount).toBe(20);
    expect(g.geometrySource).toBe("mapped_rows");
    expect(g.treatedAreaMethod).toBe("whole_block");
  });

  it("uses the canonical derived_from_area_and_spacing raw value", () => {
    const g = resolveBlockGeometry({ paddock: derivedBlock, mode: "whole_block" });
    expect(g.geometrySource).toBe("derived_from_area_and_spacing");
    expect(g.canonicalRowLengthMetres).toBeCloseTo((10 * 10000) / 3, 6);
    expect(g.geometryQuality).toBe("derived");
  });

  it("reports an unavailable geometry source, not 'incomplete'", () => {
    const g = resolveBlockGeometry({ paddock: { id: "x", name: "Bare" }, mode: "whole_block" });
    expect(g.geometrySource).toBe("unavailable");
    expect(g.geometryQuality).toBe("incomplete");
    expect(g.treatedAreaMethod).toBe("unavailable");
    expect(g.issues).toContain("missing_gross_area");
  });

  it("read-tolerates the deprecated stored_row_length source and legacy spellings", () => {
    expect(normaliseGeometrySource("stored_row_length")).toBe("operator_override");
    expect(normaliseGeometrySource("derived_area_spacing")).toBe("derived_from_area_and_spacing");
    expect(normaliseGeometrySource("incomplete")).toBe("unavailable");
    expect(normaliseGeometrySource("mapped_rows")).toBe("mapped_rows");
  });

  it("treats the whole block for whole_block mode and the band only for banded", () => {
    const whole = resolveBlockGeometry({ paddock: mappedBlock, mode: "whole_block" });
    expect(whole.treatedAreaHa).toBeCloseTo(1.5, 6);
    const banded = resolveBlockGeometry({
      paddock: mappedBlock,
      mode: "banded",
      totalTreatedBandWidthMetres: 1,
    });
    // 5000 m of row × 1 m band = 5000 m² = 0.5 ha
    expect(banded.treatedAreaHa).toBeCloseTo(0.5, 6);
    expect(banded.treatedAreaMethod).toBe("canonical_row_length");
  });

  it("falls back to area × band ÷ spacing when the row length is itself derived", () => {
    const g = resolveBlockGeometry({
      paddock: bandedBlock,
      mode: "banded",
      totalTreatedBandWidthMetres: 1,
    });
    expect(g.treatedAreaHa).toBeCloseTo(4, 6); // 10 ha × 1 / 2.5
    expect(g.treatedAreaMethod).toBe("area_and_spacing_fallback");
  });

  it("flags banded applications with no band width", () => {
    const g = resolveBlockGeometry({ paddock: mappedBlock, mode: "banded" });
    expect(g.issues).toContain("missing_band_width");
    expect(g.treatedAreaHa).toBeNull();
  });

  it("does not average mixed row spacing", () => {
    const a = resolveBlockGeometry({ paddock: mappedBlock, mode: "whole_block" });
    const b = resolveBlockGeometry({
      paddock: { ...derivedBlock, row_width: 2 },
      mode: "whole_block",
    });
    const agg = buildApplicationGeometry([a, b]);
    expect(agg.uniformRowSpacing).toBe(false);
    expect(agg.rowSpacingMetres).toBeNull();
    expect(agg.issues).toContain("mixed_row_spacing");
    expect(agg.grossAreaHa).toBeCloseTo(11.5, 6);
    expect(agg.geometrySource).toBe("derived_from_area_and_spacing");
  });

  it("treats spacings within the 1 mm tolerance as uniform", () => {
    const a = resolveBlockGeometry({ paddock: { ...derivedBlock, id: "a", row_width: 2.5 }, mode: "whole_block" });
    const b = resolveBlockGeometry({ paddock: { ...derivedBlock, id: "b", row_width: 2.5005 }, mode: "whole_block" });
    const agg = buildApplicationGeometry([a, b]);
    expect(agg.uniformRowSpacing).toBe(true);
    expect(agg.rowSpacingMetres).toBeCloseTo(2.5, 6);
  });

  it("never returns a partial treated-area sum when one block is unresolved", () => {
    const a = resolveBlockGeometry({
      paddock: bandedBlock,
      mode: "banded",
      totalTreatedBandWidthMetres: 1,
    });
    const b = resolveBlockGeometry({ paddock: { id: "bare" }, mode: "banded", totalTreatedBandWidthMetres: 1 });
    const agg = buildApplicationGeometry([a, b]);
    expect(a.treatedAreaHa).toBeCloseTo(4, 6);
    expect(agg.treatedAreaHa).toBeNull();
    expect(agg.treatedAreaMethod).toBe("unavailable");
    expect(agg.issues).toContain("incomplete_block_geometry");
    expect(agg.geometryQuality).toBe("incomplete");
  });

  it("uses area_and_spacing_fallback as the aggregate method for mixed banded blocks", () => {
    const canonical = resolveBlockGeometry({
      paddock: mappedBlock,
      mode: "banded",
      totalTreatedBandWidthMetres: 1,
    });
    const fallback = resolveBlockGeometry({
      paddock: bandedBlock,
      mode: "banded",
      totalTreatedBandWidthMetres: 1,
    });
    const agg = buildApplicationGeometry([canonical, fallback]);
    expect(agg.treatedAreaMethod).toBe("area_and_spacing_fallback");
    expect(agg.treatedAreaHa).toBeCloseTo(4.5, 6);
  });

  it("resolves a whole application from paddock rows", () => {
    const agg = resolveApplicationGeometry({
      paddocks: [mappedBlock, derivedBlock],
      blockIds: ["b-mapped"],
      mode: "whole_block",
    });
    expect(agg.blocks).toHaveLength(1);
    expect(agg.treatedAreaHa).toBeCloseTo(1.5, 6);
  });
});

/* --------------------------------------------------------------- carrier */

describe("carrier volume", () => {
  const geometry = buildApplicationGeometry([
    resolveBlockGeometry({ paddock: mappedBlock, mode: "whole_block" }),
  ]);

  it("computes total litres from L/ha", () => {
    const c = calculateCarrier({
      geometry,
      mode: "whole_block",
      carrier: { basis: "l_per_ha", litresPerHectare: 400 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(600, 6); // 400 × 1.5 ha
    expect(c.litresPer100m).toBeCloseTo(12, 6); // 400 × 3 / 100
  });

  it("computes total litres from L/100 m and derives L/ha", () => {
    const c = calculateCarrier({
      geometry,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 12 },
    });
    expect(c.totalCarrierLitres).toBeCloseTo(600, 6); // 5000 m / 100 × 12
    expect(c.litresPerHectare).toBeCloseTo(400, 6); // 12 × 100 / 3
  });

  it("derives no equivalent L/ha when row spacings differ", () => {
    const mixed = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: { ...derivedBlock, id: "a", row_width: 2.5 }, mode: "whole_block" }),
      resolveBlockGeometry({ paddock: { ...derivedBlock, id: "b", row_width: 3 }, mode: "whole_block" }),
    ]);
    const c = calculateCarrier({
      geometry: mixed,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 10 },
    });
    expect(c.totalCarrierLitres).not.toBeNull();
    expect(c.litresPerHectare).toBeNull();
    expect(c.diagnostics.map((d) => d.code)).toContain("cannot_derive_litres_per_hectare");
  });

  it("uses the confirmed L/100 m → L/ha equivalence", () => {
    const uniform = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: bandedBlock, mode: "whole_block" }),
    ]);
    const c = calculateCarrier({
      geometry: uniform,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 10 },
    });
    expect(c.litresPerHectare).toBeCloseTo(400, 6); // 10 × 100 / 2.5
  });

  it("leaves the carrier incomplete when L/100 m has no row length (no L/ha fallback)", () => {
    const noRows = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: { id: "x", area_ha: 5 }, mode: "whole_block" }),
    ]);
    const c = calculateCarrier({
      geometry: noRows,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 10, litresPerHectare: 400 },
    });
    expect(c.totalCarrierLitres).toBeNull();
    expect(c.diagnostics.map((d) => d.code)).toContain("incomplete_geometry_for_carrier");
  });

  it("floors the concentration factor at 1", () => {
    expect(concentrationFactorFrom(40, 20)).toBeCloseTo(2, 6);
    expect(concentrationFactorFrom(10, 20)).toBeCloseTo(1, 6);
    const c = calculateCarrier({
      geometry,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 20, diluteLitresPer100m: 40 },
    });
    expect(c.concentrationFactor).toBeCloseTo(2, 6);
    expect(c.concentrationFactorSource).toBe("derived");
    const inverse = calculateCarrier({
      geometry,
      mode: "whole_block",
      carrier: { basis: "l_per_100m", appliedLitresPer100m: 20, diluteLitresPer100m: 10 },
    });
    expect(inverse.concentrationFactor).toBe(1);
  });

  it("supports a concentration factor in L/ha mode", () => {
    const c = calculateCarrier({
      geometry,
      mode: "whole_block",
      carrier: { basis: "l_per_ha", litresPerHectare: 400, diluteLitresPerHectare: 1000 },
    });
    expect(c.concentrationFactor).toBeCloseTo(2.5, 6);
  });

  it("treats a persisted concentration factor as authoritative history", () => {
    const c = calculateCarrier({
      geometry,
      mode: "whole_block",
      carrier: {
        basis: "l_per_100m",
        appliedLitresPer100m: 20,
        diluteLitresPer100m: 100, // would derive 5
        concentrationFactor: 2,
      },
    });
    expect(c.concentrationFactor).toBe(2);
    expect(c.concentrationFactorSource).toBe("persisted");
  });

  it("does not require a carrier for spreader operations", () => {
    const c = calculateCarrier({
      geometry,
      mode: "whole_block",
      operationType: "spreader",
      carrier: { basis: null },
    });
    expect(c.totalCarrierLitres).toBeNull();
    expect(c.diagnostics.every((d) => d.severity !== "error")).toBe(true);
  });

  it("refuses to compute when geometry is incomplete", () => {
    const bare = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: { id: "x" }, mode: "whole_block" }),
    ]);
    const c = calculateCarrier({
      geometry: bare,
      mode: "whole_block",
      carrier: { basis: "l_per_ha", litresPerHectare: 400 },
    });
    expect(c.totalCarrierLitres).toBeNull();
    expect(c.diagnostics.map((d) => d.code)).toContain("incomplete_geometry_for_carrier");
  });
});

/* ------------------------------- banded gross-carrier mandatory fixture */

describe("banded L/ha carrier uses gross hectares (Rork mandatory fixture)", () => {
  const geometry = buildApplicationGeometry([
    resolveBlockGeometry({ paddock: bandedBlock, mode: "banded", totalTreatedBandWidthMetres: 1 }),
  ]);
  const carrier = calculateCarrier({
    geometry,
    mode: "banded",
    carrier: { basis: "l_per_ha", litresPerHectare: 400 },
  });

  it("resolves 10 ha gross and 4 ha treated", () => {
    expect(geometry.grossAreaHa).toBeCloseTo(10, 6);
    expect(geometry.treatedAreaHa).toBeCloseTo(4, 6);
  });

  it("bills the carrier on gross hectares — 4,000 L, not 1,600 L", () => {
    expect(carrier.carrierAreaHa).toBeCloseTo(10, 6);
    expect(carrier.totalCarrierLitres).toBeCloseTo(4000, 6);
  });

  it("keeps treated-area products on treated hectares — 10 L Kelp", () => {
    const [kelp] = calculateProducts({
      products: [line({ productName: "Kelp", rate: 2.5, unit: "L", rateBasis: "treated_area" })],
      geometry,
      carrier,
    });
    expect(kelp.totalQuantity).toBeCloseTo(10, 6);
    expect(kelp.multiplierKind).toBe("treated_hectares");
  });

  it("coexists with mixed product bases in the same application", () => {
    const [a, b, c] = calculateProducts({
      products: [
        line({ productName: "A", rate: 2.5, unit: "L", rateBasis: "treated_area" }),
        line({ productName: "B", rate: 50, unit: "mL", rateBasis: "per_100_litres" }),
        line({ productName: "C", rate: 100, unit: "mL", rateBasis: "per_100_metres" }),
      ],
      geometry,
      carrier,
    });
    expect(a.totalQuantity).toBeCloseTo(10, 6); // 2.5 × 4 treated ha
    expect(b.totalQuantity).toBeCloseTo(2000, 6); // 50 × 4000 / 100
    // 10 ha ÷ 2.5 m spacing = 40,000 m of row → 400 × 100 mL
    expect(c.multiplier).toBeCloseTo(400, 6);
    expect(c.totalQuantity).toBeCloseTo(40000, 6);
    expect(c.multiplierKind).toBe("hundred_metres");
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
    carrier: { basis: "l_per_ha", litresPerHectare: 400 },
  });

  it("keeps whole-block and treated hectares distinct", () => {
    const [gross, treated] = calculateProducts({
      products: [line({ rate: 2 }), line({ rate: 2, rateBasis: "treated_area" })],
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
    // Carrier is 400 L/ha × 1.5 gross ha = 600 L
    expect(p.totalQuantity).toBeCloseTo(1500, 6);
  });

  it("computes per-100 m rates from the canonical row length", () => {
    const [p] = calculateProducts({
      products: [line({ rate: 100, unit: "mL", rateBasis: "per_100_metres" })],
      geometry,
      carrier,
    });
    expect(p.totalQuantity).toBeCloseTo(5000, 6); // 5000 m / 100 × 100 mL
  });

  it("errors when a per-100 m rate has no canonical row length", () => {
    const noRows = buildApplicationGeometry([
      resolveBlockGeometry({ paddock: { id: "x", area_ha: 5 }, mode: "whole_block" }),
    ]);
    const [p] = calculateProducts({
      products: [line({ rateBasis: "per_100_metres" })],
      geometry: noRows,
      carrier,
    });
    expect(p.totalQuantity).toBeNull();
    expect(p.diagnostics.map((d) => d.code)).toContain("per_100m_needs_row_length");
  });

  it("errors when a per-100 L rate has no carrier volume", () => {
    const noCarrier = calculateCarrier({
      geometry,
      mode: "whole_block",
      operationType: "spreader",
      carrier: { basis: null },
    });
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
      {
        index: 0,
        savedChemicalId: null,
        productName: "A",
        rate: 1,
        unit: "L",
        rateBasis: "whole_block_area" as const,
        totalQuantity: 10,
        multiplier: 10,
        multiplierKind: "whole_block_hectares" as const,
        rateValidation: "unable_to_validate" as const,
        diagnostics: [],
      },
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
    expect(app.mode).toBe("whole_block");
    expect(app.operationType).toBe("foliar");
    expect(app.targets).toEqual(["powdery_mildew"]);
    expect(app.carrier.basis).toBe("l_per_ha");
    expect(app.products[0].rateBasis).toBe("whole_block_area");
    expect(app.products[0].unit).toBe("L");
    expect(app.products[1].rateBasis).toBe("per_100_litres");
    expect(app.compatibilityNotes.some((n) => n.includes("not linked"))).toBe(true);
    expect(app.blockIds).toEqual(["b-mapped"]);
  });

  it("maps a spreader job to whole_block and keeps the operation type", () => {
    const app = fromLegacySprayJob({ id: "j3", operation_type: "Spreader" } as any);
    expect(app.mode).toBe("whole_block");
    expect(app.operationType).toBe("spreader");
    expect(app.headTarget).toBeNull();
  });

  it("defaults an absent product rate basis to whole_block_area", () => {
    const app = fromLegacySprayJob({
      id: "j4",
      operation_type: "Banded Spray",
      chemical_lines: [{ name: "Legacy", rate: 2, unit: "L" }],
    } as any);
    expect(app.mode).toBe("banded");
    expect(app.products[0].rateBasis).toBe("whole_block_area");
  });

  it("drops a foliar head target when the operation is banded", () => {
    const app = fromLegacySprayJob({
      id: "j5",
      operation_type: "Banded Spray",
      spray_head_target: "bunch_line",
    } as any);
    expect(app.headTarget).toBeNull();
  });

  it("distinguishes unknown targets (null) from an explicitly empty array", () => {
    expect(fromLegacySprayJob({ id: "a" } as any).targets).toBeNull();
    expect(fromLegacySprayJob({ id: "b", targets: [] } as any).targets).toEqual([]);
  });

  it("keeps a stored concentration factor rather than re-deriving it", () => {
    const app = fromLegacySprayJob({
      id: "j6",
      operation_type: "Foliar Spray",
      carrier_volume_basis: "l_per_100m",
      applied_litres_per_100m: 20,
      dilute_litres_per_100m: 100,
      concentration_factor: 2,
    } as any);
    expect(app.carrier.concentrationFactor).toBe(2);
    const c = calculateCarrier({
      geometry: buildApplicationGeometry([
        resolveBlockGeometry({ paddock: mappedBlock, mode: "whole_block" }),
      ]),
      mode: "whole_block",
      carrier: app.carrier,
    });
    expect(c.concentrationFactor).toBe(2);
    expect(c.concentrationFactorSource).toBe("persisted");
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
    expect(app.operationType).toBe("foliar");
    expect(app.targets).toEqual(["botrytis"]);
    expect(app.carrier.basis).toBe("l_per_100m");
    expect(app.headTarget).toBe("bunch_line"); // operation type is still foliar
    expect(app.totalTreatedBandWidthMetres).toBe(1);
  });

  it("keeps Lovable templates block-free", () => {
    const app = fromLegacySprayJob({ id: "t1", is_template: true, operation_type: "Foliar Spray" } as any);
    expect(app.blockIds).toEqual([]);
    expect(app.compatibilityNotes.some((n) => n.includes("Templates do not carry blocks"))).toBe(true);
  });

  it("builds a resistance candidate that keeps mode and operation type distinct", () => {
    const app = emptySprayApplication();
    app.mode = "whole_block";
    app.operationType = "spreader";
    app.targets = ["botrytis"];
    app.products = [line({ activityGroups: [{ scheme: "frac", code: "11" }] })];
    const candidate = buildCandidateApplication(app, "authoritative");
    expect(candidate.mode).toBe("whole_block");
    expect(candidate.operationType).toBe("spreader");
    expect(candidate.products[0].activityGroups[0].code).toBe("11");
    expect(candidate.geometryQuality).toBe("authoritative");
  });
});

/* -------------------------------------------------------- orchestration */

describe("full calculation", () => {
  it("blocks recording while errors remain and clears once complete", () => {
    const app = emptySprayApplication();
    app.mode = "whole_block";
    app.operationType = "foliar";
    app.carrier = { basis: "l_per_ha", litresPerHectare: 400 };
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
        resolveBlockGeometry({ paddock: mappedBlock, mode: "whole_block" }),
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
    expect(shouldCaptureSnapshot("proposed")).toBe(false);
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

  it("does not attach a snapshot to planned chemical lines", () => {
    const app = fromLegacySprayJob({
      id: "j7",
      operation_type: "Foliar Spray",
      chemical_lines: [{ savedChemicalId: "chem-1", name: "Product A", rate: 1, unit: "L/ha" }],
    } as any);
    expect((app.products[0] as any).chemicalSnapshot).toBeUndefined();
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
