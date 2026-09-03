// SQL 222 — user-confirmed manual range is a hard gate in the Spray Program,
// and the applied-rate provenance is frozen onto the saved chemical line.
import { describe, it, expect } from "vitest";
import { hydrateDraft, productLineFromChemical } from "@/lib/sprayApplicationDraft";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { toChemicalLine } from "@/lib/sprayApplicationSave";
import { decodePersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

const manualRange = decodePersistedDefaultRates({
  version: 1,
  per_100_litres: {
    option_key: "",
    rate_ids: [],
    basis: "per_100_litres",
    unit: "L",
    value: null,
    min_value: 2,
    max_value: 3,
    source: "operator",
    entry_method: "manual",
  },
});

const line = () =>
  productLineFromChemical({
    savedChemicalId: "chem-1",
    productName: "SACOA STIFLE DORMANT SPRAY OIL",
    unit: "L",
    intelligence: {
      defaultRates: manualRange,
      activityGroups: [],
      verification: { status: "unverified" },
      legacy: { chemicalGroup: null },
    } as any,
  });

function record(rate: number | null) {
  const app = hydrateDraft({ vineyardId: "v1", job: null, isTemplate: false } as any) as any;
  app.operationType = "foliar";
  app.carrier = { basis: "manual", manualTotalLitres: 1000 };
  app.products = [{ ...line(), rate }];
  const geometry = resolveApplicationGeometry({
    paddocks: [],
    blockIds: [],
    mode: app.mode,
    override: app.geometryOverride,
    totalTreatedBandWidthMetres: null,
  } as any);
  return { app, geometry, calc: calculateSprayApplication({ application: app, geometry } as any) };
}

describe("manual confirmed range is a hard gate", () => {
  it("never auto-selects a dose", () => {
    expect(line().rate).toBeNull();
    expect(line()).toMatchObject({ labelMinRate: 2, labelMaxRate: 3, rateEntryMethod: "manual" });
  });

  it.each([null, 1.5, 3.5])("blocks recording for %s", (rate) => {
    expect(record(rate as number | null).calc.canRecord).toBe(false);
  });

  it.each([2, 2.5, 3])("allows recording %s", (rate) => {
    const { calc } = record(rate);
    expect(
      calc.diagnostics.some(
        (d: any) => d.severity === "error" && String(d.code).includes("confirmed_range"),
      ),
    ).toBe(false);
  });
});

describe("applied-rate provenance on the spray record", () => {
  it("freezes applied rate and source range", () => {
    const saved = toChemicalLine({ ...line(), rate: 2.5 } as any);
    expect(saved).toMatchObject({
      applied_rate: 2.5,
      applied_rate_unit: "L",
      applied_rate_basis: "per_100_litres",
      rate_entry_method: "manual",
      rate_range_min: 2,
      rate_range_max: 3,
      chemical_id: "chem-1",
      savedChemicalId: "chem-1",
    });
  });

  it("reloads with manual provenance and the source range intact", () => {
    const saved = toChemicalLine({ ...line(), rate: 2.5 } as any);
    const app = hydrateDraft({
      vineyardId: "v1",
      job: { vineyard_id: "v1", chemical_lines: [saved] },
      isTemplate: false,
    } as any) as any;
    expect(app.products[0]).toMatchObject({
      rate: 2.5,
      unit: "L",
      rateEntryMethod: "manual",
      labelMinRate: 2,
      labelMaxRate: 3,
    });
  });

  it("adds no manual provenance to a canonical line", () => {
    const saved = toChemicalLine({ ...line(), rateEntryMethod: null, rate: 2.5 } as any);
    expect(saved.rate_entry_method ?? null).toBeNull();
    expect(saved.applied_rate ?? null).toBeNull();
  });
});

describe("manual scalar provenance (production path)", () => {
  const scalar = decodePersistedDefaultRates({
    version: 1,
    per_100_litres: {
      option_key: "",
      rate_ids: [],
      basis: "per_100_litres",
      unit: "L",
      value: 1.5,
      min_value: null,
      max_value: null,
      source: "operator",
      entry_method: "manual",
    },
  });
  const scalarLine = () =>
    productLineFromChemical({
      savedChemicalId: "chem-1",
      productName: "SACOA STIFLE DORMANT SPRAY OIL",
      unit: "L",
      intelligence: {
        defaultRates: scalar,
        activityGroups: [],
        verification: { status: "unverified" },
        legacy: { chemicalGroup: null },
      } as any,
    });

  it("prefills 1.5 and keeps manual provenance through save and reload", () => {
    expect(scalarLine()).toMatchObject({ rate: 1.5, rateEntryMethod: "manual" });
    const saved = toChemicalLine(scalarLine() as any);
    expect(saved).toMatchObject({
      applied_rate: 1.5,
      applied_rate_unit: "L",
      applied_rate_basis: "per_100_litres",
      rate_entry_method: "manual",
    });
    expect(saved.rate_range_min ?? null).toBeNull();
    expect(saved.rate_range_max ?? null).toBeNull();

    const app = hydrateDraft({
      vineyardId: "v1",
      job: { vineyard_id: "v1", chemical_lines: [saved] },
      isTemplate: false,
    } as any) as any;
    expect(app.products[0]).toMatchObject({
      rate: 1.5,
      unit: "L",
      rateBasis: "per_100_litres",
      rateEntryMethod: "manual",
    });
    expect(app.products[0].labelMinRate ?? null).toBeNull();
    expect(app.products[0].labelMaxRate ?? null).toBeNull();
  });

  it("leaves a canonical scalar without manual provenance", () => {
    const canonical = decodePersistedDefaultRates({
      version: 1,
      per_100_litres: {
        option_key: "default_option_v1_94df25e59456a8a736cdb446e1a7af3e",
        rate_ids: ["rate_v1_347ebfa9ad731449f589ae79458eaa88"],
        basis: "per_100_litres",
        unit: "L",
        value: 1.5,
        min_value: null,
        max_value: null,
        source: "operator",
      },
    });
    const l = productLineFromChemical({
      savedChemicalId: "chem-1",
      productName: "P",
      unit: "L",
      intelligence: {
        defaultRates: canonical,
        activityGroups: [],
        verification: { status: "unverified" },
        legacy: { chemicalGroup: null },
      } as any,
    });
    expect(l.rate).toBe(1.5);
    expect(l.rateEntryMethod ?? null).toBeNull();
    expect(toChemicalLine(l as any).rate_entry_method ?? null).toBeNull();
  });
});
