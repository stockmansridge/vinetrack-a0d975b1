// P8 — Plan → Spray Job → completed Spray Record chemistry/provenance integrity.
import { describe, expect, it } from "vitest";
import { emptySprayApplication, fromLegacySprayJob } from "@/lib/sprayApplicationDomain";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import {
  jobGroupCodes,
  readChemistryStamp,
  stampGroupCodes,
} from "@/lib/resistance/sprayJobChemistryStamp";
import { buildChemicalSnapshot } from "@/lib/sprayChemicalSnapshot";
import { productLinesFromRecord } from "@/lib/resistance/resistanceEventSource";
import { provenanceFromPosition } from "@/lib/resistance/sprayJobPlanLink";
import { emptyPlan, parsePositions } from "@/lib/resistancePlanContract";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";

const intel = (over: Partial<ChemicalIntelligence> = {}): ChemicalIntelligence =>
  ({
    id: "chem-1",
    name: "Test Fungicide",
    structured: true,
    product: {
      country: "AU",
      registrationScheme: "apvma",
      registrationNumber: "12345",
      registeredProductName: "Test Fungicide",
      registrant: null,
      manufacturer: null,
      labelReference: null,
      labelVersion: null,
      labelUrl: null,
      productUrl: null,
    },
    actives: [
      { name: "tebuconazole", concentration: 200, unit: "g/L", group: { scheme: "FRAC", code: "3" } },
    ],
    activityGroups: [{ scheme: "FRAC", code: "3" }],
    verification: { status: "verified" },
    labelRateBases: [],
    registeredUses: [],
    commercial: {},
    legacy: { activeIngredient: "tebuconazole", chemicalGroup: "Group 3", modeOfAction: null },
    schemaVersion: 1,
    ...over,
  }) as unknown as ChemicalIntelligence;

const save = (app: ReturnType<typeof emptySprayApplication>) => {
  const geometry = resolveApplicationGeometry({
    paddocks: [],
    blockIds: app.blockIds,
    mode: app.mode,
    override: app.geometryOverride,
    totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
  });
  return toSprayJobInput({
    application: app,
    geometry,
    calculation: calculateSprayApplication({ application: app, geometry }),
  });
};

const draftWith = (chem: ChemicalIntelligence) => {
  const app = emptySprayApplication();
  app.vineyardId = "v1";
  app.blockIds = ["b1"];
  app.products = [
    {
      savedChemicalId: chem.id,
      productName: chem.name,
      rate: 1,
      unit: "L",
      rateBasis: "whole_block_area",
      activityGroups: chem.activityGroups.map((g) => ({
        scheme: g.scheme.toLowerCase() as any,
        code: g.code as string,
      })),
      verificationStatus: chem.verification.status as any,
      intelligence: chem,
      legacyChemicalGroup: chem.legacy.chemicalGroup,
    },
  ];
  return app;
};

describe("P8 — chemistry survives Plan → Job", () => {
  it("stamps identity, groups and evidence quality onto the persisted line", () => {
    const { input } = save(draftWith(intel()));
    const line: any = input.chemical_lines![0];
    expect(line.savedChemicalId).toBe("chem-1");
    expect(line.activity_groups).toEqual([{ scheme: "frac", code: "3" }]);
    expect(line.verification_status).toBe("verified");
    expect(line.registration_identity_key).toBe("AU:apvma:12345");
    expect(line.chemical_group).toBe("Group 3");
    expect(stampGroupCodes(readChemistryStamp(line))).toEqual(["3"]);
  });

  it("retains every group of a multi-active FRAC 3 + 7 product", () => {
    const multi = intel({
      actives: [
        { name: "tebuconazole", group: { scheme: "FRAC", code: "3" } },
        { name: "fluopyram", group: { scheme: "FRAC", code: "7" } },
      ],
      activityGroups: [
        { scheme: "FRAC", code: "3" },
        { scheme: "FRAC", code: "7" },
      ],
    } as any);
    const { input } = save(draftWith(multi));
    expect(jobGroupCodes({ chemical_lines: input.chemical_lines as any })).toEqual(["3", "7"]);
  });

  it("keeps HRAC chemistry distinct from the FRAC group with the same numeral", () => {
    const herb = intel({
      activityGroups: [{ scheme: "HRAC", code: "9" }],
      actives: [{ name: "glyphosate", group: { scheme: "HRAC", code: "9" } }],
    } as any);
    const { input } = save(draftWith(herb));
    expect(jobGroupCodes({ chemical_lines: input.chemical_lines as any })).toEqual(["HRAC 9"]);
  });

  it("carries plan provenance alongside the stamped chemistry", () => {
    const plan = {
      ...emptyPlan({ vineyardId: "v1", seasonId: "2026-27", disease: "powdery_mildew", jurisdiction: "AU" }),
      id: "plan-1",
      serverRevision: 3,
      positions: parsePositions([{ id: "pos-1", sequence: 1, groups: ["3"], target: "powdery_mildew" }]),
    };
    const app = draftWith(intel());
    app.planProvenance = provenanceFromPosition({ plan, position: plan.positions[0] });
    const { input } = save(app);
    expect(input.resistance_plan_id).toBe("plan-1");
    expect(input.resistance_position_id).toBe("pos-1");
    expect(input.resistance_plan_source_revision).toBe(3);
  });
});

describe("P8 — reload and edit do not rewrite job chemistry", () => {
  const jobRow = () => {
    const { input } = save(draftWith(intel()));
    return {
      ...input,
      id: "job-1",
      vineyard_id: "v1",
      resistance_plan_id: "plan-1",
      resistance_position_id: "pos-1",
      resistance_position_snapshot: { id: "pos-1", sequence: 1, groups: ["3"] },
      resistance_plan_source_revision: 3,
    } as any;
  };

  it("a later Saved Chemical re-verify does not rewrite the created job", () => {
    const reverified = intel({
      activityGroups: [{ scheme: "FRAC", code: "11" }],
      verification: { status: "unverified" },
    } as any);
    const app = fromLegacySprayJob(jobRow(), {
      paddockIds: ["b1"],
      intelligenceById: new Map([["chem-1", reverified]]),
    });
    expect(app.products[0].activityGroups).toEqual([{ scheme: "frac", code: "3" }]);
    expect(app.products[0].verificationStatus).toBe("verified");
    expect(app.compatibilityNotes.join(" ")).toContain("has changed in the Chemical Store");

    // Editing an unrelated field re-saves the ORIGINAL stamp verbatim.
    app.notes = "changed the notes only";
    const { input } = save(app);
    const line: any = input.chemical_lines![0];
    expect(line.activity_groups).toEqual([{ scheme: "frac", code: "3" }]);
    expect(line.verification_status).toBe("verified");
    expect(input.resistance_plan_id).toBe("plan-1");
    expect(input.resistance_position_id).toBe("pos-1");
    expect(input.resistance_plan_source_revision).toBe(3);
  });

  it("reloading rebuilds from provenance, not from the product name", () => {
    const app = fromLegacySprayJob(jobRow(), { paddockIds: ["b1"] });
    expect(app.planProvenance?.planId).toBe("plan-1");
    expect(app.products[0].savedChemicalId).toBe("chem-1");
    // No intelligence supplied at all — groups still survive.
    expect(app.products[0].activityGroups).toEqual([{ scheme: "frac", code: "3" }]);
  });

  it("unverified planned chemistry never becomes authoritative", () => {
    const unverified = intel({ structured: false, verification: { status: "unverified" }, activityGroups: [] } as any);
    const { input } = save(draftWith(unverified));
    const line: any = input.chemical_lines![0];
    expect(line.verification_status).toBe("unverified");
    expect(stampGroupCodes(readChemistryStamp(line))).toEqual([]);
  });

  it("templates carry no provenance", () => {
    const app = draftWith(intel());
    app.isTemplate = true;
    const { input } = save(app);
    expect(input.resistance_plan_id).toBeNull();
  });
});

describe("P8 — completion snapshot feeds resistance history", () => {
  it("freezes scheme-qualified groups that read back as the same chemistry", () => {
    const snapshot = buildChemicalSnapshot(
      intel({
        activityGroups: [{ scheme: "HRAC", code: "9" }],
        actives: [{ name: "glyphosate", group: { scheme: "HRAC", code: "9" } }],
      } as any),
    );
    expect(snapshot.activity_groups).toEqual(["HRAC 9"]);

    const lines = productLinesFromRecord({
      id: "rec-1",
      tanks: [{ chemicals: [{ id: "l1", name: "Test", chemicalSnapshot: snapshot }] }],
    });
    expect(lines[0].groups.codes).toEqual(["HRAC:9"]);
    expect(lines[0].availability).toBe("available_verified");
  });

  it("multi-active completions keep both groups in history", () => {
    const snapshot = buildChemicalSnapshot(
      intel({
        activityGroups: [
          { scheme: "FRAC", code: "3" },
          { scheme: "FRAC", code: "7" },
        ],
        actives: [
          { name: "a", group: { scheme: "FRAC", code: "3" } },
          { name: "b", group: { scheme: "FRAC", code: "7" } },
        ],
      } as any),
    );
    const lines = productLinesFromRecord({
      id: "rec-2",
      tanks: [{ chemicals: [{ id: "l1", chemicalSnapshot: snapshot }] }],
    });
    expect(lines[0].groups.codes).toEqual(["3", "7"]);
  });

  it("a legacy snapshot with bare codes still reads", () => {
    const lines = productLinesFromRecord({
      id: "rec-3",
      tanks: [
        {
          chemicals: [
            {
              id: "l1",
              chemicalSnapshot: {
                activity_groups: ["3"],
                active_ingredients: [],
                verification_status: "verified",
                schema_version: 1,
                activity_group_table_version: 1,
              },
            },
          ],
        },
      ],
    });
    expect(lines[0].groups.codes).toEqual(["3"]);
  });
});
