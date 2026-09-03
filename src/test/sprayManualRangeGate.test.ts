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
  const app = hydrateDraft({ vineyardId: "v1", job: null }) as any;
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
