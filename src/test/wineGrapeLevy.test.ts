import { describe, expect, it } from "vitest";
import {
  buildLevySources,
  computeWorksheet,
  defaultLevyEndYear,
  indicativeLevy,
  isWithinLevyPeriod,
  levyPeriod,
} from "@/lib/wineGrapeLevy";
import type { PickingRecord } from "@/lib/pickingRecordsQuery";
import { canAccessRoute } from "@/lib/rolePermissions";
import { reportDestinations, resolveLocation, type NavViewer } from "@/lib/navigationConfig";

const ws = (o: Partial<Parameters<typeof computeWorksheet>[0]> = {}) =>
  computeWorksheet({ fresh: "", dried: "", juice: "", concentrates: [], ...o });

describe("conversions 01-04", () => {
  it("01 fresh tonnes count as entered", () => expect(ws({ fresh: "12.5" }).totalTonnes).toBe(12.5));
  it("02 dried tonnes × 3", () => expect(ws({ dried: "2" }).driedFreshEquivalent).toBe(6));
  it("03 juice litres ÷ 800", () => expect(ws({ juice: "1600" }).juiceFreshEquivalent).toBe(2));
  it("04 concentrate litres × strength summed ÷ 800", () => {
    const r = ws({ concentrates: [{ id: "a", litres: "100", strength: "4" }, { id: "b", litres: "200", strength: "2" }] });
    expect(r.concentrateEquivalentLitres).toBe(800);
    expect(r.concentrateFreshEquivalent).toBe(1);
  });
  it("total adds all fresh grape equivalents", () => {
    const r = ws({ fresh: "10", dried: "1", juice: "800", concentrates: [{ id: "a", litres: "200", strength: "4" }] });
    expect(r.totalTonnes).toBe(15);
  });
  it("rejects negatives and missing strength for nonzero concentrate", () => {
    expect(ws({ fresh: "-1" }).hasErrors).toBe(true);
    expect(ws({ concentrates: [{ id: "a", litres: "10", strength: "" }] }).hasErrors).toBe(true);
    expect(ws({ concentrates: [{ id: "a", litres: "0", strength: "" }] }).hasErrors).toBe(false);
  });
  it("blank fields are reported, not silently treated as entered zero", () => {
    expect(ws({ fresh: "5" }).blanks).toEqual(["02", "03", "04"]);
  });
});

describe("levy year", () => {
  it("runs 1 July previous year to 30 June, due 30 September", () => {
    expect(levyPeriod(2026)).toMatchObject({ start: "2025-07-01", end: "2026-06-30", due: "2026-09-30", label: "2025-26" });
  });
  it("includes both boundary days only", () => {
    const p = levyPeriod(2026);
    expect(isWithinLevyPeriod("2025-07-01", p)).toBe(true);
    expect(isWithinLevyPeriod("2026-06-30", p)).toBe(true);
    expect(isWithinLevyPeriod("2025-06-30", p)).toBe(false);
    expect(isWithinLevyPeriod("2026-07-01", p)).toBe(false);
  });
  it("defaults to the last complete year (Oct 2026 → 2025-26; May 2026 → 2024-25)", () => {
    expect(defaultLevyEndYear(new Date("2026-10-13T02:00:00Z"))).toBe(2026);
    expect(defaultLevyEndYear(new Date("2026-05-10T02:00:00Z"))).toBe(2025);
  });
});

describe("indicative levy 2025-26", () => {
  it("nil use is $0", () => expect(indicativeLevy(0, 2026)).toBe(0));
  it("10 t boundary", () => {
    expect(indicativeLevy(10, 2026)).toBeCloseTo(250, 6);
    expect(indicativeLevy(10.001, 2026)).toBeCloseTo(180 + 9.2 * 10.001, 6);
  });
  it("3000 t boundary", () => {
    expect(indicativeLevy(3000, 2026)).toBeCloseTo(27780, 6);
    expect(indicativeLevy(3001, 2026)).toBeCloseTo(27788.8, 6);
  });
  it("unverified years return null (calculate in Levies Online)", () => {
    expect(indicativeLevy(50, 2025)).toBeNull();
  });
});

const pick = (o: Partial<PickingRecord>): PickingRecord =>
  ({ id: Math.random().toString(), vineyard_id: "v", paddock_id: "b1", paddock_name: "B1", variety_name: "Shiraz",
    vintage: 2026, picked_at: "2026-03-01", weight_kg: 1000, sold: false, ...o }) as PickingRecord;

describe("source selection", () => {
  const p = levyPeriod(2026);
  it("splits sold and unsold picks by picked_at, not vintage", () => {
    const s = buildLevySources(
      [pick({ weight_kg: 2000 }), pick({ sold: true, weight_kg: 500 }), pick({ picked_at: "2026-07-02" })],
      [], p);
    expect(s.unsoldTonnes).toBe(2);
    expect(s.soldTonnes).toBe(0.5);
    expect(s.vintagePicksOutsidePeriod).toBe(1);
  });
  it("detailed picks supersede basic actuals — no double count", () => {
    const hist = [{ id: "h", vineyard_id: "v", year: 2026, block_results: [
      { paddockId: "b1", blockName: "B1", variety: "Shiraz", actualYieldTonnes: 9 },
      { paddockId: "b2", blockName: "B2", variety: "Merlot", actualYieldTonnes: 4 },
    ] }];
    const s = buildLevySources([pick({})], hist as any, p);
    expect(s.undatedTonnes).toBe(4);
    expect(s.undatedSuperseded).toBe(1);
  });
  it("missing data reports no actuals", () => {
    expect(buildLevySources([], [], p).hasAnyActual).toBe(false);
  });
});

describe("permissions and navigation", () => {
  it("owner/manager only", () => {
    expect(canAccessRoute("/reports/wine-grape-levy", "owner")).toBe(true);
    expect(canAccessRoute("/reports/wine-grape-levy", "manager")).toBe(true);
    expect(canAccessRoute("/reports/wine-grape-levy", "supervisor")).toBe(false);
    expect(canAccessRoute("/reports/wine-grape-levy", "operator")).toBe(false);
  });
  it("sits under Yield & Harvest and appears in reports for owners only", () => {
    expect(resolveLocation("/reports/wine-grape-levy").view?.label).toBe("Wine Grape Levy");
    expect(resolveLocation("/reports/wine-grape-levy").activity?.label).toBe("Yield & Harvest");
    const v = (role: string): NavViewer => ({ role, isSystemAdmin: false, irrigation: { records: true, reports: true, setup: true }, hasAccountBilling: false, vineyardCountry: "Australia" });
    expect(reportDestinations(v("owner")).some((d) => d.path === "/reports/wine-grape-levy")).toBe(true);
    expect(reportDestinations(v("supervisor")).some((d) => d.path === "/reports/wine-grape-levy")).toBe(false);
  });
});
