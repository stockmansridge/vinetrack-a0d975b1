import { describe, it, expect } from "vitest";
import {
  chemicalTotals,
  costFieldLabel,
  costValueKind,
  formatActual,
  formatPlanned,
  formatTotalActual,
  formatTotalPlanned,
  formatWaterLitres,
  matchSourceLabel,
  rowSourceLabel,
  toDisplayAmount,
  unitLabel,
  NOT_ADDED,
  NOT_RECORDED,
} from "@/lib/sprayReportQuantities";
import {
  routeChronologySegments,
  SPRAY_ROUTE_CHRONOLOGY_STOPS,
  SPRAY_ROUTE_START_COLOUR,
  SPRAY_ROUTE_FINISH_COLOUR,
} from "@/lib/satelliteRouteMap";

const chem = (over: any = {}) => ({
  plannedChemicalId: null,
  savedChemicalId: null,
  name: "Sacoa oil",
  unit: "Litres" as const,
  plannedAmountBase: 35714.28,
  actualAmountBase: null,
  matchSource: "plannedChemicalId",
  ...over,
});

describe("base-unit conversion", () => {
  it("converts millilitres to litres and grams to kilograms exactly once", () => {
    expect(toDisplayAmount(35714.28, "Litres")).toBeCloseTo(35.71428, 5);
    expect(toDisplayAmount(8928.571, "Kg")).toBeCloseTo(8.928571, 5);
    expect(toDisplayAmount(250, "mL")).toBe(250);
    expect(toDisplayAmount(null, "Litres")).toBeNull();
    expect(unitLabel("Litres")).toBe("L");
    expect(unitLabel("Kg")).toBe("kg");
  });

  it("renders the acceptance quantities readably", () => {
    expect(formatPlanned(chem())).toBe("35.714 L");
    expect(formatPlanned(chem({ plannedAmountBase: 8189.0, unit: "Litres" }))).toBe("8.189 L");
    expect(formatPlanned(chem({ name: "Thiovit", unit: "Kg", plannedAmountBase: 8928.571 }))).toBe(
      "8.929 kg",
    );
    expect(formatWaterLitres(1500)).toBe("1,500 L");
    expect(formatWaterLitres(343.9)).toBe("343.9 L");
  });

  it("keeps unrecorded and confirmed-zero actuals distinct", () => {
    expect(formatActual(chem({ actualAmountBase: null }))).toBe(NOT_RECORDED);
    expect(formatActual(chem({ actualAmountBase: 0 }))).toBe(NOT_ADDED);
    expect(formatActual(chem({ actualAmountBase: 2800 }))).toBe("2.8 L");
  });
});

describe("canonical totals", () => {
  const tanks = [
    {
      tankNumber: 1,
      plannedWaterLitres: 1500,
      actualWaterLitres: null,
      chemicals: [
        chem({ savedChemicalId: "oil", plannedAmountBase: 35714.28 }),
        chem({ savedChemicalId: "thio", name: "Thiovit", unit: "Kg", plannedAmountBase: 8928.571 }),
      ],
    },
    {
      tankNumber: 2,
      plannedWaterLitres: 343.9,
      actualWaterLitres: null,
      chemicals: [
        chem({ savedChemicalId: "oil", plannedAmountBase: 8189.0 }),
        chem({ savedChemicalId: "thio", name: "Thiovit", unit: "Kg", plannedAmountBase: 2047.0 }),
      ],
    },
  ] as any;

  it("sums each chemical across tanks in its display unit", () => {
    const totals = chemicalTotals(tanks);
    expect(formatTotalPlanned(totals[0])).toBe("43.903 L");
    expect(formatTotalPlanned(totals[1])).toBe("10.976 kg");
  });

  it("marks actual totals partial when a tank had no recorded actual", () => {
    const mixed = chemicalTotals([
      {
        tankNumber: 1,
        plannedWaterLitres: 1,
        actualWaterLitres: 1,
        chemicals: [chem({ savedChemicalId: "oil", actualAmountBase: 2000 })],
      },
      {
        tankNumber: 2,
        plannedWaterLitres: 1,
        actualWaterLitres: 1,
        chemicals: [chem({ savedChemicalId: "oil", actualAmountBase: null })],
      },
    ] as any);
    expect(formatTotalActual(mixed[0])).toBe("2 L (partial)");
  });

  it("does not combine a volume and a mass with the same name", () => {
    const totals = chemicalTotals([
      {
        tankNumber: 1,
        plannedWaterLitres: 1,
        actualWaterLitres: 1,
        chemicals: [
          chem({ name: "Dual", unit: "Litres", plannedAmountBase: 1000 }),
          chem({ name: "Dual", unit: "Kg", plannedAmountBase: 1000 }),
        ],
      },
    ] as any);
    expect(totals).toHaveLength(2);
  });
});

describe("plain-English labels", () => {
  it("explains match provenance", () => {
    expect(matchSourceLabel("plannedChemicalId")).toBe("Matched to the planned spray line");
    expect(matchSourceLabel("ambiguous")).toBe("Ambiguous — left unrecorded");
    expect(matchSourceLabel(null)).toBe(NOT_RECORDED);
  });

  it("explains row attribution", () => {
    expect(rowSourceLabel("completedPaths")).toBe("Recorded as completed");
    expect(rowSourceLabel("incompletePlannedPath")).toBe("Planned, not completed");
  });

  it("chooses cost units by field rather than always currency", () => {
    expect(costValueKind("fuelLitres")).toBe("litres");
    expect(costValueKind("engineHours")).toBe("hours");
    expect(costValueKind("treatedAreaHa")).toBe("area");
    expect(costValueKind("totalCost")).toBe("currency");
    expect(costFieldLabel("costPerHa")).toMatch(/hectare/i);
  });
});

describe("route chronology", () => {
  it("covers the whole route red → green with no gaps", () => {
    const segs = routeChronologySegments(50);
    expect(segs[0].startIndex).toBe(0);
    expect(segs[segs.length - 1].endIndex).toBe(49);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startIndex).toBe(segs[i - 1].endIndex);
    }
    expect(segs[0].colour).toBe(SPRAY_ROUTE_CHRONOLOGY_STOPS[0]);
    expect(segs[segs.length - 1].colour).toBe(
      SPRAY_ROUTE_CHRONOLOGY_STOPS[SPRAY_ROUTE_CHRONOLOGY_STOPS.length - 1],
    );
  });

  it("uses red for Start and green for Finish", () => {
    expect(SPRAY_ROUTE_START_COLOUR).toBe("#D7263D");
    expect(SPRAY_ROUTE_FINISH_COLOUR).toBe("#2E9B4F");
  });

  it("returns nothing for a route with fewer than two points", () => {
    expect(routeChronologySegments(1)).toEqual([]);
  });
});
