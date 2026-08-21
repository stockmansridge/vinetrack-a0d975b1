// P10 — completed spray records must never change when the Saved Chemical,
// Master Chemical or label evidence changes later.
import { describe, expect, it } from "vitest";
import {
  normaliseTanks,
  readRecordChemistry,
  recordGroupCodes,
} from "@/lib/sprayRecordChemistry";
import { buildChemicalSnapshot } from "@/lib/sprayChemicalSnapshot";
import { productLinesFromRecord } from "@/lib/resistance/resistanceEventSource";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";

const intel = (over: Partial<ChemicalIntelligence> = {}): ChemicalIntelligence =>
  ({
    id: "sc-1",
    name: "Prosaro",
    structured: true,
    actives: [
      { name: "Prothioconazole", concentration: 210, unit: "g/L", group: { scheme: "frac", code: "3" } },
      { name: "Tebuconazole", concentration: 210, unit: "g/L", group: { scheme: "frac", code: "3" } },
    ],
    activityGroups: [{ scheme: "frac", code: "3" }],
    verification: { status: "verified" },
    product: { country: "AU", registrationScheme: "apvma", registrationNumber: "63243" },
    legacy: {},
    ...over,
  }) as any;

const recordWith = (lines: any[], extra: Record<string, any> = {}) => ({
  id: "rec-1",
  tanks: [{ tank_number: 1, water_volume: 1000, chemicals: lines }],
  ...extra,
});

describe("P10A — immutable snapshot", () => {
  it("freezes identity, actives, groups and evidence at completion", () => {
    const snap = buildChemicalSnapshot(intel());
    const chem = readRecordChemistry(recordWith([{ name: "Prosaro", rate: 1, unit: "L/ha", chemicalSnapshot: snap }]));
    const line = chem.lines[0];
    expect(line.snapshot).toBe("frozen");
    expect(line.productName).toBe("Prosaro");
    expect(line.registrationIdentityKey).toBe("AU:apvma:63243");
    expect(line.countryCode).toBe("AU");
    expect(line.activeIngredients.map((a) => a.name)).toEqual(["Prothioconazole", "Tebuconazole"]);
    expect(line.activityGroups).toEqual(["FRAC 3"]);
    expect(line.verificationStatus).toBe("verified");
    expect(line.rate).toBe(1);
    expect(line.rateBasis).toBe("per_hectare");
    expect(line.rateText).toBe("1 L/ha");
  });

  it("a later Saved Chemical edit / re-verify cannot change the record", () => {
    const snap = buildChemicalSnapshot(intel());
    const record = recordWith([{ name: "Prosaro", rate: 1, unit: "L/ha", chemicalSnapshot: snap }]);
    const before = JSON.stringify(readRecordChemistry(record));
    // Saved Chemical is reverified to different chemistry — record untouched.
    intel({ activityGroups: [{ scheme: "frac", code: "7" }], verification: { status: "conflict" } } as any);
    expect(JSON.stringify(readRecordChemistry(record))).toBe(before);
  });

  it("multi-active product retains every resistance group", () => {
    const snap = buildChemicalSnapshot(
      intel({
        actives: [
          { name: "A", group: { scheme: "frac", code: "3" } },
          { name: "B", group: { scheme: "frac", code: "7" } },
        ],
        activityGroups: [
          { scheme: "frac", code: "3" },
          { scheme: "frac", code: "7" },
        ],
      } as any),
    );
    const chem = readRecordChemistry(recordWith([{ name: "Mix", rate: 2, unit: "L/ha", chemicalSnapshot: snap }]));
    expect(recordGroupCodes(chem)).toEqual(["FRAC 3", "FRAC 7"]);
    expect(productLinesFromRecord(recordWith([{ name: "Mix", chemicalSnapshot: snap }]))[0].groups).toContain(
      "FRAC 3",
    );
  });

  it("HRAC / IRAC codes stay scheme-qualified and never become FRAC", () => {
    const snap = buildChemicalSnapshot(
      intel({
        actives: [{ name: "Glyphosate", group: { scheme: "hrac", code: "9" } }],
        activityGroups: [{ scheme: "hrac", code: "9" }],
      } as any),
    );
    const chem = readRecordChemistry(recordWith([{ name: "Glypho", chemicalSnapshot: snap }]));
    expect(chem.lines[0].activityGroups).toEqual(["HRAC 9"]);
    expect(chem.lines[0].activityGroups).not.toContain("FRAC 9");
  });
});

describe("P10B — snapshot coverage / legacy records", () => {
  it("a legacy line with no snapshot is historical data unavailable", () => {
    const chem = readRecordChemistry(recordWith([{ name: "Old product", rate: 1, unit: "L/ha" }]));
    expect(chem.lines[0].snapshot).toBe("unavailable");
    expect(chem.lines[0].activityGroups).toEqual([]);
    expect(chem.lines[0].verificationStatus).toBeNull();
    expect(chem.historicalChemistryUnavailable).toBe(true);
  });

  it("reads the tanks envelope shape as well as a bare array", () => {
    const inner = [{ tank_number: 1, chemicals: [{ name: "X" }] }];
    expect(normaliseTanks({ tanks: inner })).toEqual(inner);
    expect(normaliseTanks(inner)).toEqual(inner);
    expect(normaliseTanks(JSON.stringify({ tanks: inner }))).toEqual(inner);
    expect(normaliseTanks(null)).toEqual([]);
  });
});

describe("P10C — reports / exports", () => {
  it('basis "other" is never exported as an applied numeric rate', () => {
    const chem = readRecordChemistry(
      recordWith([{ name: "Ref", rate: 5, unit: "L", product_rate_basis: "other" }]),
    );
    expect(chem.lines[0].rateIsApplied).toBe(false);
    expect(chem.lines[0].rateText).toContain("not an applied rate");
  });

  it("an unrecorded rate basis is qualified rather than assumed per hectare", () => {
    const chem = readRecordChemistry(recordWith([{ name: "Ref", rate: 5, unit: "L" }]));
    expect(chem.lines[0].rateBasis).toBe("unknown");
    expect(chem.lines[0].rateIsApplied).toBe(false);
  });

  it("L/100 m completed spray retains applied L/100 m and derived L/ha", () => {
    const chem = readRecordChemistry(
      recordWith([{ name: "P", rate: 30, unit: "mL/100L", product_rate_basis: "per_100_litres" }], {
        applied_litres_per_100m: 12,
        dilute_litres_per_100m: 20,
        spray_rate_per_ha: 400,
        carrier_volume_basis: "l_per_100m",
      }),
    );
    expect(chem.figures.appliedLitresPer100m).toBe(12);
    expect(chem.figures.diluteLitresPer100m).toBe(20);
    expect(chem.figures.litresPerHectare).toBe(400);
    expect(chem.lines[0].rateText).toBe("30 mL/100 L");
  });

  it("banded spray retains gross and treated area", () => {
    const chem = readRecordChemistry(
      recordWith([{ name: "P", rate: 2, unit: "L/ha", product_rate_basis: "treated_area" }], {
        application_mode: "banded",
        gross_area_ha: 10,
        treated_area_ha: 4,
      }),
    );
    expect(chem.figures.grossAreaHa).toBe(10);
    expect(chem.figures.treatedAreaHa).toBe(4);
    expect(chem.figures.applicationMode).toBe("banded");
    expect(chem.figures.unavailable).toBe(false);
  });

  it("a record with no geometry reports figures unavailable", () => {
    expect(readRecordChemistry(recordWith([{ name: "P" }])).figures.unavailable).toBe(true);
  });
});
