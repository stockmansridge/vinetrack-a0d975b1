// Stage 3B — wizard workflow / persistence integration tests.
//
// These tests drive the same layers the wizard uses (draft → geometry →
// calculation → save mapper) rather than re-testing the Stage 3A engine.
import { describe, it, expect } from "vitest";
import {
  applyOperationType,
  evaluateSaveGate,
  hydrateDraft,
  productLineFromChemical,
  applyTemplate,
} from "@/lib/sprayApplicationDraft";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import {
  buildCandidateApplication,
  emptySprayApplication,
  type SprayApplication,
  type SprayProductLine,
} from "@/lib/sprayApplicationDomain";

/* ------------------------------------------------------------- fixtures */

const block = (id: string, areaHa: number, rowWidth: number | null, name = id) => ({
  id,
  name,
  area_ha: areaHa,
  row_width: rowWidth,
});

const PADDOCKS = [
  block("A", 10, 2.5, "Block A"),
  block("B", 6, 2.5, "Block B"),
  block("C", 4, 3.0, "Block C"),
];

function product(over: Partial<SprayProductLine> = {}): SprayProductLine {
  return {
    savedChemicalId: "chem-1",
    productName: "Kelp",
    rate: 2.5,
    unit: "L",
    rateBasis: "whole_block_area",
    activityGroups: [],
    verificationStatus: "unverified",
    ...over,
  };
}

/** The exact pipeline the wizard runs on every draft change. */
function run(app: SprayApplication) {
  const geometry = resolveApplicationGeometry({
    paddocks: PADDOCKS,
    blockIds: app.isTemplate ? [] : app.blockIds,
    mode: app.mode,
    override: app.geometryOverride,
    totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
  });
  const calculation = calculateSprayApplication({ application: app, geometry });
  const gate = evaluateSaveGate({ application: app, calculation });
  const saved = toSprayJobInput({ application: app, geometry, calculation });
  return { geometry, calculation, gate, ...saved };
}

function draft(over: Partial<SprayApplication> = {}): SprayApplication {
  return { ...emptySprayApplication(), vineyardId: "v1", name: "Job", ...over };
}

const foliar = (over: Partial<SprayApplication> = {}) =>
  applyOperationType(
    draft({
      blockIds: ["A"],
      targets: ["powdery_mildew"],
      growthStageCode: "EL-19",
      tractorId: "t1",
      equipmentId: "e1",
      operatorUserId: "u1",
      tankCapacityLitres: 2000,
      carrier: { basis: "l_per_ha", litresPerHectare: 400 },
      products: [product({ rate: 1.5 })],
      ...over,
    }),
    "foliar",
  );

/* ------------------------------------------------------- 3. foliar spray */

describe("Stage 3B — foliar spray workflow", () => {
  it("calculates and persists a complete foliar application", () => {
    const app = { ...foliar(), headTarget: "full_canopy" as const };
    const { calculation, gate, input, paddockIds } = run(app);

    expect(gate.canSave).toBe(true);
    expect(calculation.geometry.grossAreaHa).toBe(10);
    expect(calculation.geometry.treatedAreaHa).toBe(10);
    expect(calculation.carrier.totalCarrierLitres).toBe(4000);
    expect(calculation.products[0].totalQuantity).toBe(15);
    expect(calculation.tanks.fullTanks).toBe(2);

    expect(input.application_mode).toBe("whole_block");
    expect(input.operation_type).toBe("Foliar Spray");
    expect(input.spray_head_target).toBe("full_canopy");
    expect(input.targets).toEqual(["powdery_mildew"]);
    expect(input.growth_stage_code).toBe("EL-19");
    expect(input.tractor_id).toBe("t1");
    expect(input.equipment_id).toBe("e1");
    expect(input.operator_user_id).toBe("u1");
    expect(input.spray_rate_per_ha).toBe(400);
    expect(input.water_volume).toBe(4000);
    expect(paddockIds).toEqual(["A"]);
  });
});

/* ------------------------------------------------------- 4. banded spray */

describe("Stage 3B — banded spray fixture", () => {
  const app = applyOperationType(
    draft({
      blockIds: ["A"], // 10 ha @ 2.5 m
      carrier: { basis: "l_per_ha", litresPerHectare: 400 },
      products: [product({ rate: 2.5, rateBasis: "treated_area" })],
    }),
    "banded",
  );
  const banded = { ...app, totalTreatedBandWidthMetres: 1.0 };

  it("derives treated area, gross carrier and treated-area product totals", () => {
    const { geometry, calculation, input } = run(banded);
    expect(geometry.grossAreaHa).toBe(10);
    expect(geometry.rowSpacingMetres).toBe(2.5);
    expect(geometry.treatedAreaHa).toBeCloseTo(4, 6);
    expect(calculation.carrier.totalCarrierLitres).toBe(4000);
    expect(calculation.products[0].totalQuantity).toBeCloseTo(10, 6);

    expect(input.application_mode).toBe("banded");
    expect(input.operation_type).toBe("Banded Spray");
    expect(input.band_width_total_metres).toBe(1);
    expect(input.gross_area_ha).toBe(10);
    expect(input.treated_area_ha).toBeCloseTo(4, 4);
    expect(input.water_volume).toBe(4000);
    expect(input.chemical_lines[0].product_rate_basis).toBe("treated_area");
  });
});

/* ----------------------------------------------------------- 5. spreader */

describe("Stage 3B — spreader job", () => {
  it("saves without a carrier and clears the head target", () => {
    const base = { ...foliar(), headTarget: "full_canopy" as const };
    const spreader = applyOperationType(base, "spreader");
    const { calculation, gate, input } = run(spreader);

    expect(spreader.carrier.basis).toBeNull();
    expect(gate.canSave).toBe(true);
    expect(input.operation_type).toBe("Spreader");
    expect(input.application_mode).toBe("whole_block");
    expect(input.spray_head_target).toBeNull();
    expect(input.carrier_volume_basis).toBeNull();
    // Hectare-based product maths still completes.
    expect(calculation.products[0].totalQuantity).toBe(15);
    expect(
      calculation.diagnostics.some((d) => d.code === "spreader_no_carrier" && d.severity === "info"),
    ).toBe(true);
    expect(calculation.diagnostics.some((d) => d.code === "missing_carrier_basis")).toBe(false);
  });
});

/* --------------------------------------------------------- 6. L/100 m */

describe("Stage 3B — L/100 m carrier workflow", () => {
  it("derives carrier total, concentration factor and equivalent L/ha", () => {
    const app = applyOperationType(
      draft({
        blockIds: ["A"],
        geometryOverride: { canonicalRowLengthMetres: 40000 },
        carrier: {
          basis: "l_per_100m",
          appliedLitresPer100m: 10,
          diluteLitresPer100m: 25,
        },
        products: [product({ rate: 1, rateBasis: "per_100_metres" })],
      }),
      "foliar",
    );
    const { calculation, input } = run(app);
    expect(calculation.carrier.totalCarrierLitres).toBe(4000);
    expect(calculation.carrier.litresPerHectare).toBe(400);
    expect(calculation.carrier.concentrationFactor).toBe(2.5);
    expect(calculation.carrier.concentrationFactorSource).toBe("derived");
    expect(calculation.products[0].totalQuantity).toBe(400);

    expect(input.carrier_volume_basis).toBe("l_per_100m");
    expect(input.applied_litres_per_100m).toBe(10);
    expect(input.dilute_litres_per_100m).toBe(25);
    expect(input.concentration_factor).toBe(2.5);
    expect(input.spray_rate_per_ha).toBe(400);
    expect(input.canonical_row_length_metres).toBe(40000);
  });

  it("keeps the row-length carrier valid but returns no L/ha for mixed spacing", () => {
    const app = applyOperationType(
      draft({
        blockIds: ["A", "C"], // 2.5 m vs 3.0 m
        carrier: { basis: "l_per_100m", appliedLitresPer100m: 10 },
        products: [product({ rate: 1, rateBasis: "per_100_metres" })],
      }),
      "foliar",
    );
    const { geometry, calculation, gate } = run(app);
    expect(geometry.uniformRowSpacing).toBe(false);
    expect(calculation.carrier.totalCarrierLitres).toBeGreaterThan(0);
    expect(calculation.carrier.litresPerHectare).toBeNull();
    expect(
      calculation.diagnostics.some((d) => d.code === "cannot_derive_litres_per_hectare"),
    ).toBe(true);
    // Mixed spacing is guidance, not fatal.
    expect(gate.canSave).toBe(true);
  });
});

/* ------------------------------------------------- 7. four product bases */

describe("Stage 3B — the four product rate bases", () => {
  it("calculates and persists each basis in one application", () => {
    const app = {
      ...applyOperationType(
        draft({
          blockIds: ["A"],
          carrier: { basis: "l_per_ha", litresPerHectare: 400 },
          geometryOverride: { canonicalRowLengthMetres: 40000 },
          products: [
            product({ savedChemicalId: "c1", productName: "Whole", rate: 1, rateBasis: "whole_block_area" }),
            product({ savedChemicalId: "c2", productName: "Treated", rate: 2, rateBasis: "treated_area" }),
            product({ savedChemicalId: "c3", productName: "Per100L", rate: 3, rateBasis: "per_100_litres" }),
            product({ savedChemicalId: "c4", productName: "Per100m", rate: 4, rateBasis: "per_100_metres" }),
          ],
        }),
        "banded",
      ),
      totalTreatedBandWidthMetres: 1.0,
    };
    const { calculation, input } = run(app);
    // gross 10 ha, treated = 40000 m × 1 m = 4 ha, carrier = 4000 L, 400 × 100 m
    expect(calculation.products[0].totalQuantity).toBe(10);
    expect(calculation.products[1].totalQuantity).toBeCloseTo(8, 6);
    expect(calculation.products[2].totalQuantity).toBe(120);
    expect(calculation.products[3].totalQuantity).toBe(1600);

    expect(input.chemical_lines.map((l) => l.product_rate_basis)).toEqual([
      "whole_block_area",
      "treated_area",
      "per_100_litres",
      "per_100_metres",
    ]);
    // iOS-compatible two-value column.
    expect(input.chemical_lines.map((l) => l.rate_basis)).toEqual([
      "per_hectare",
      "per_hectare",
      "per_100_litres",
      "per_hectare",
    ]);
    expect(input.chemical_lines[0].chemical_id).toBe("c1");
    expect(input.chemical_lines[0].name).toBe("Whole");
    expect(input.chemical_lines[0].rate).toBe(1);
    expect(input.chemical_lines[0].unit).toBe("L");
  });
});

/* --------------------------------------------- 9. head-target clearing */

describe("Stage 3B — head target clearing", () => {
  it.each([
    ["banded", "Banded Spray"],
    ["spreader", "Spreader"],
  ] as const)("clears the head target when switching foliar → %s", (op, label) => {
    const start = { ...foliar(), headTarget: "full_canopy" as const };
    const switched = applyOperationType(start, op);
    expect(switched.headTarget).toBeNull();
    const { input } = run({ ...switched, totalTreatedBandWidthMetres: 1 });
    expect(input.operation_type).toBe(label);
    expect(input.spray_head_target).toBeNull();
  });

  it("never persists a stale hidden head target", () => {
    // Even if a head target survived on the draft, the mapper drops it.
    const banded = { ...applyOperationType(foliar(), "banded"), headTarget: "bunch_line" as const };
    expect(run(banded).input.spray_head_target).toBeNull();
  });
});

/* ------------------------------------------------------ 10. targets */

describe("Stage 3B — target semantics", () => {
  it("persists multiple structured targets and their free-text mirror", () => {
    const app = foliar({ targets: ["powdery_mildew", "botrytis"], otherTargetNote: "trial" });
    const { input } = run(app);
    expect(input.targets).toEqual(["powdery_mildew", "botrytis"]);
    expect(input.target).toBe("Powdery mildew, Botrytis — trial");
  });

  it("does not collapse null and [] during hydration", () => {
    const unknown = hydrateDraft({
      vineyardId: "v1",
      isTemplate: false,
      job: { id: "j", vineyard_id: "v1", chemical_lines: [] } as any,
    });
    expect(unknown.targets).toBeNull();

    const explicitlyEmpty = hydrateDraft({
      vineyardId: "v1",
      isTemplate: false,
      job: { id: "j", vineyard_id: "v1", targets: [], chemical_lines: [] } as any,
    });
    expect(explicitlyEmpty.targets).toEqual([]);
  });

  it("keeps an unmappable legacy target as free-text context only", () => {
    const legacy = hydrateDraft({
      vineyardId: "v1",
      isTemplate: false,
      job: { id: "j", vineyard_id: "v1", target: "spring clean-up", chemical_lines: [] } as any,
    });
    expect(legacy.targets).toBeNull();
    expect(legacy.legacyTargetText).toBe("spring clean-up");
    const { input } = run({ ...legacy, name: "Legacy", operationType: "foliar", mode: "whole_block", blockIds: ["A"] });
    expect(input.targets).toBeNull();
    expect(input.target).toBe("spring clean-up");
  });
});

/* -------------------------------------------------- 11. block persistence */

describe("Stage 3B — block persistence", () => {
  it("saves single, multiple and edited block selections", () => {
    expect(run(foliar({ blockIds: ["A"] })).paddockIds).toEqual(["A"]);

    const multi = run(foliar({ blockIds: ["A", "B"] }));
    expect(multi.paddockIds).toEqual(["A", "B"]);
    expect(multi.geometry.grossAreaHa).toBe(16);

    const removed = run(foliar({ blockIds: ["A"] }));
    expect(removed.paddockIds).toEqual(["A"]);
    expect(removed.geometry.grossAreaHa).toBe(10);
  });

  it("re-hydrates the same selection from spray_job_paddocks", () => {
    const app = hydrateDraft({
      vineyardId: "v1",
      isTemplate: false,
      job: { id: "j", vineyard_id: "v1", operation_type: "Foliar Spray", chemical_lines: [] } as any,
      paddockIds: ["A", "B"],
    });
    expect(app.blockIds).toEqual(["A", "B"]);
    expect(run({ ...app, name: "x" }).paddockIds).toEqual(["A", "B"]);
  });
});

/* ------------------------------------------- 12/13. hydrate compatibility */

const MODERN_JOB = {
  id: "job-modern",
  vineyard_id: "v1",
  name: "Modern",
  is_template: false,
  planned_date: "2026-01-05",
  status: "planned",
  operation_type: "Banded Spray",
  application_mode: "banded",
  targets: ["weeds"],
  target: "Weeds",
  spray_head_target: null,
  growth_stage_code: "EL-31",
  tractor_id: "t1",
  equipment_id: "e1",
  carrier_volume_basis: "l_per_ha",
  spray_rate_per_ha: 400,
  concentration_factor: 2,
  band_width_total_metres: 1,
  row_spacing_metres: 2.5,
  gross_area_ha: 10,
  chemical_lines: [
    {
      chemical_id: "c1",
      name: "Glyph",
      rate: 3,
      unit: "L",
      product_rate_basis: "treated_area",
    },
  ],
};

describe("Stage 3B — modern job hydrate / resave", () => {
  it("round-trips without losing contract fields", () => {
    const app = hydrateDraft({ vineyardId: "v1", isTemplate: false, job: MODERN_JOB as any, paddockIds: ["A"] });
    const { input, paddockIds } = run(app);
    expect(input.operation_type).toBe("Banded Spray");
    expect(input.application_mode).toBe("banded");
    expect(input.targets).toEqual(["weeds"]);
    expect(input.spray_head_target).toBeNull();
    expect(input.growth_stage_code).toBe("EL-31");
    expect(input.carrier_volume_basis).toBe("l_per_ha");
    expect(input.spray_rate_per_ha).toBe(400);
    expect(input.concentration_factor).toBe(2);
    expect(input.band_width_total_metres).toBe(1);
    expect(input.row_spacing_metres).toBe(2.5);
    expect(input.gross_area_ha).toBe(10);
    expect(input.treated_area_ha).toBeCloseTo(4, 4);
    expect(input.geometry_source).toBeTruthy();
    expect(input.geometry_quality).toBeTruthy();
    expect(input.chemical_lines[0]).toMatchObject({
      chemical_id: "c1",
      name: "Glyph",
      rate: 3,
      unit: "L",
      product_rate_basis: "treated_area",
    });
    expect(paddockIds).toEqual(["A"]);
  });
});

describe("Stage 3B — legacy job hydrate", () => {
  const LEGACY = {
    id: "job-legacy",
    vineyard_id: "v1",
    name: "Legacy",
    operation_type: "Foliar Spray",
    target: "spring clean-up",
    spray_rate_per_ha: 500,
    chemical_lines: [{ name: "Old product", rate: 2, unit: "L/ha" }],
  };

  it("opens, defaults the rate basis and fabricates nothing", () => {
    const app = hydrateDraft({ vineyardId: "v1", isTemplate: false, job: LEGACY as any, paddockIds: ["A"] });
    expect(app.operationType).toBe("foliar");
    expect(app.mode).toBe("whole_block");
    expect(app.carrier.basis).toBe("l_per_ha");
    expect(app.products[0].rateBasis).toBe("whole_block_area");
    expect(app.products[0].savedChemicalId).toBeNull();
    expect(app.products[0].activityGroups).toEqual([]);
    expect(app.products[0].verificationStatus).toBe("unverified");
    expect(app.targets).toBeNull();
    expect(app.legacyTargetText).toBe("spring clean-up");
    expect(app.compatibilityNotes.length).toBeGreaterThan(0);

    const { input } = run(app);
    expect(input.targets).toBeNull();
    expect(input.spray_head_target).toBeNull();
    expect(input.chemical_lines[0].product_rate_basis).toBe("whole_block_area");
    expect(input.chemical_lines[0].unit).toBe("L");
  });
});

/* ------------------------------------------------------- 14. templates */

describe("Stage 3B — templates", () => {
  it("keeps templates block-free and geometry-free on save", () => {
    const tpl: SprayApplication = {
      ...foliar({ blockIds: ["A", "B"] }),
      isTemplate: true,
      name: "PM template",
    };
    const { gate, input, paddockIds } = run(tpl);
    expect(gate.canSave).toBe(true);
    expect(paddockIds).toEqual([]);
    expect(input.is_template).toBe(true);
    expect(input.gross_area_ha).toBeNull();
    expect(input.treated_area_ha).toBeNull();
    expect(input.canonical_row_length_metres).toBeNull();
    expect(input.geometry_source).toBeNull();
    expect(input.water_volume).toBeNull();
    expect(input.planned_date).toBeNull();
    // Reusable settings survive.
    expect(input.operation_type).toBe("Foliar Spray");
    expect(input.chemical_lines).toHaveLength(1);
  });

  it("recalculates fresh geometry when a template is instantiated", () => {
    const template: SprayApplication = { ...foliar({ blockIds: [] }), isTemplate: true };
    const job = applyTemplate(draft({ blockIds: ["B"], tankCapacityLitres: 2000 }), template);
    expect(job.blockIds).toEqual(["B"]);
    const { geometry, calculation } = run(job);
    // Block B is 6 ha, not the 10 ha of the original job.
    expect(geometry.grossAreaHa).toBe(6);
    expect(calculation.carrier.totalCarrierLitres).toBe(2400);
    expect(calculation.products[0].totalQuantity).toBe(9);
  });
});

/* ----------------------------------------- 15/16. chemical intelligence */

describe("Stage 3B — chemical intelligence integration", () => {
  const intel = (status: string) =>
    ({
      id: "chem-x",
      activityGroups: [{ scheme: "FRAC", code: "3" }],
      verification: { status },
      legacy: { chemicalGroup: "DMI" },
    }) as any;

  it.each(["verified", "partially_verified", "unverified", "conflict"])(
    "keeps identity, groups and %s verification without blocking calculation",
    (status) => {
      const line = productLineFromChemical({
        savedChemicalId: "chem-x",
        productName: "Topas",
        unit: "mL",
        intelligence: intel(status),
      });
      expect(line.savedChemicalId).toBe("chem-x");
      expect(line.rate).toBeNull(); // never pre-filled
      expect(line.activityGroups).toEqual([{ scheme: "frac", code: "3" }]);
      expect(line.verificationStatus).toBe(status);

      const app = foliar({ products: [{ ...line, rate: 2, rateBasis: "whole_block_area" }] });
      const { calculation, gate, input } = run(app);
      expect(calculation.products[0].totalQuantity).toBe(20);
      expect(gate.canSave).toBe(true);
      expect(input.chemical_lines[0].chemical_id).toBe("chem-x");
    },
  );

  it("warns but does not block when a product is unlinked", () => {
    const app = foliar({ products: [product({ savedChemicalId: null })] });
    const { calculation, gate } = run(app);
    expect(calculation.diagnostics.some((d) => d.code === "unlinked_product" && d.severity === "warning")).toBe(true);
    expect(gate.canSave).toBe(true);
  });

  it("does not freeze a chemical snapshot when planning a job or a template", () => {
    const job = run(foliar()).input as Record<string, unknown>;
    const tpl = run({ ...foliar(), isTemplate: true }).input as Record<string, unknown>;
    for (const payload of [job, tpl]) {
      expect(Object.keys(payload).some((k) => /snapshot/i.test(k))).toBe(false);
      expect((payload.chemical_lines as any[])[0]).not.toHaveProperty("chemicalSnapshot");
    }
  });
});

/* ------------------------------------------------------ 17. resistance seam */

describe("Stage 3B — resistance seam only", () => {
  it("assembles candidate inputs with no verdict", () => {
    const app = foliar({
      blockIds: ["A", "B"],
      targets: ["powdery_mildew", "botrytis"],
      products: [product({ activityGroups: [{ scheme: "frac", code: "3" }], verificationStatus: "verified" })],
    });
    const { geometry } = run(app);
    const candidate = buildCandidateApplication(app, geometry.geometryQuality) as Record<string, unknown>;

    expect(candidate.blockIds).toEqual(["A", "B"]);
    expect(candidate.targets).toEqual(["powdery_mildew", "botrytis"]);
    expect((candidate.products as any[])[0].activityGroups).toEqual([{ scheme: "frac", code: "3" }]);
    expect((candidate.products as any[])[0].verificationStatus).toBe("verified");
    expect(candidate.geometryQuality).toBeTruthy();
    // Seam only: no verdict fields exist yet.
    for (const key of ["verdict", "strategy", "fit", "limitReached", "resistance"]) {
      expect(candidate).not.toHaveProperty(key);
    }
  });
});

/* ------------------------------------------- 19. reactive recalculation */

describe("Stage 3B — reactive recalculation", () => {
  it("recalculates everything when a block is removed", () => {
    const two = run(foliar({ blockIds: ["A", "B"] }));
    expect(two.geometry.grossAreaHa).toBe(16);
    expect(two.calculation.carrier.totalCarrierLitres).toBe(6400);
    expect(two.calculation.products[0].totalQuantity).toBe(24);
    expect(two.calculation.tanks.tanks.length).toBe(4);

    const one = run(foliar({ blockIds: ["A"] }));
    expect(one.geometry.grossAreaHa).toBe(10);
    expect(one.geometry.canonicalRowLengthMetres).toBe(40000);
    expect(one.geometry.treatedAreaHa).toBe(10);
    expect(one.calculation.carrier.totalCarrierLitres).toBe(4000);
    expect(one.calculation.products[0].totalQuantity).toBe(15);
    expect(one.calculation.tanks.tanks.length).toBe(2);
  });

  it("recalculates when the carrier basis or band width changes", () => {
    const base = foliar({ blockIds: ["A"], geometryOverride: { canonicalRowLengthMetres: 40000 } });
    const perHa = run(base);
    const per100m = run({ ...base, carrier: { basis: "l_per_100m", appliedLitresPer100m: 5 } });
    expect(perHa.calculation.carrier.totalCarrierLitres).toBe(4000);
    expect(per100m.calculation.carrier.totalCarrierLitres).toBe(2000);
    expect(per100m.input.spray_rate_per_ha).toBe(200);

    const banded1 = applyOperationType(base, "banded");
    const narrow = run({ ...banded1, totalTreatedBandWidthMetres: 0.5 });
    const wide = run({ ...banded1, totalTreatedBandWidthMetres: 1.0 });
    expect(narrow.geometry.treatedAreaHa).toBeCloseTo(2, 6);
    expect(wide.geometry.treatedAreaHa).toBeCloseTo(4, 6);
  });
});

/* ----------------------------------------------------- 21. save gating */

describe("Stage 3B — save gating", () => {
  it("blocks only on missing required application data", () => {
    const bare = draft({ name: "" });
    const gate = run(bare).gate;
    expect(gate.canSave).toBe(false);
    expect(gate.blockingReasons).toContain("Give this application a name.");
    expect(gate.blockingReasons).toContain("Choose an application type.");
    expect(gate.blockingReasons).toContain("Select at least one block.");
  });

  it("treats unverified chemistry and mixed spacing as warnings, not errors", () => {
    const unverified = run(
      foliar({ products: [product({ verificationStatus: "unverified" })] }),
    ).gate;
    expect(unverified.canSave).toBe(true);

    const mixed = run(
      foliar({ blockIds: ["A", "C"], carrier: { basis: "l_per_100m", appliedLitresPer100m: 10 } }),
    ).gate;
    expect(mixed.canSave).toBe(true);
    expect(mixed.fatal).toHaveLength(0);
  });
});
