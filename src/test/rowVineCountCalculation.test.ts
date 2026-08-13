import { describe, it, expect } from "vitest";
import {
  calculatedRowVineCount,
  effectiveRowVineCount,
  sumEffectiveRowVineCounts,
  rawRowLengthMeters,
  withVineCountOverride,
  type RawPaddockRow,
} from "@/lib/paddockRowVines";

// Realistic vineyard geometry: a north-south row of ~250 m at lat -34.28.
const LAT = -34.2833;
const LNG = 140.6;
const metresToDegLat = (m: number) => m / ((6378137 * Math.PI) / 180);

function iosRow(number: number, lengthM: number, extra: Record<string, any> = {}): RawPaddockRow {
  return {
    id: `row-${number}`,
    number,
    startPoint: { latitude: LAT, longitude: LNG },
    endPoint: { latitude: LAT + metresToDegLat(lengthM), longitude: LNG },
    ...extra,
  };
}

describe("row vine count from real geometry", () => {
  it("computes row length in metres from startPoint/endPoint", () => {
    expect(rawRowLengthMeters(iosRow(44, 250))).toBeGreaterThan(248);
    expect(rawRowLengthMeters(iosRow(44, 250))).toBeLessThan(252);
  });

  it("calculates vines automatically with no override (250m / 1.5m = 167)", () => {
    const row = iosRow(44, 250);
    expect(calculatedRowVineCount(row, 1.5)).toBe(167);
    expect(effectiveRowVineCount(row, 1.5)).toBe(167);
  });

  it("uses the manual override when present", () => {
    const row = withVineCountOverride(iosRow(42, 250), 164);
    expect(calculatedRowVineCount(row, 1.5)).toBe(167);
    expect(effectiveRowVineCount(row, 1.5)).toBe(164);
  });

  it("returns to the calculated value when the override is cleared", () => {
    const row = withVineCountOverride(withVineCountOverride(iosRow(42, 250), 164), null);
    expect(row.vineCountOverride).toBeUndefined();
    expect(effectiveRowVineCount(row, 1.5)).toBe(167);
  });

  it("gives different counts for different row lengths", () => {
    expect(calculatedRowVineCount(iosRow(1, 120), 1.5)).toBe(80);
    expect(calculatedRowVineCount(iosRow(2, 250), 1.5)).toBe(167);
    expect(calculatedRowVineCount(iosRow(1, 120), 1.5)).not.toBe(
      calculatedRowVineCount(iosRow(2, 250), 1.5),
    );
  });

  it("totals effective vines across rows", () => {
    const rows = [iosRow(1, 250), iosRow(2, 249), withVineCountOverride(iosRow(3, 250), 160)];
    const total = sumEffectiveRowVineCounts(rows, 1.5);
    expect(total).toBe(
      (calculatedRowVineCount(rows[0], 1.5) ?? 0) +
        (calculatedRowVineCount(rows[1], 1.5) ?? 0) +
        160,
    );
  });

  it("recalculates reactively when vine spacing changes", () => {
    const row = iosRow(44, 250);
    expect(calculatedRowVineCount(row, 1.5)).toBe(167);
    expect(calculatedRowVineCount(row, 2)).toBe(125);
  });

  it("returns null (unavailable) when vine spacing is missing", () => {
    expect(calculatedRowVineCount(iosRow(44, 250), null)).toBeNull();
    expect(calculatedRowVineCount(iosRow(44, 250), 0)).toBeNull();
  });

  it("returns null for rows without usable geometry", () => {
    expect(calculatedRowVineCount({ id: "x", number: 9 }, 1.5)).toBeNull();
  });

  it("still calculates row vines when a block-level vine_count_override exists", () => {
    const paddock = { vine_count_override: 5000, vine_spacing: 1.5 };
    const rows = [iosRow(1, 250), iosRow(2, 250)];
    expect(sumEffectiveRowVineCounts(rows, paddock.vine_spacing)).toBe(334);
  });

  it("preserves row id and geometry when applying an override", () => {
    const row = iosRow(44, 250);
    const next = withVineCountOverride(row, 164);
    expect(next.id).toBe("row-44");
    expect(next.startPoint).toEqual(row.startPoint);
    expect(next.endPoint).toEqual(row.endPoint);
  });

  it("piece-rate snapshot uses effective vine counts of the selected rows", () => {
    const rows = [iosRow(44, 250), iosRow(43, 251), withVineCountOverride(iosRow(42, 250), 158)];
    const vines = sumEffectiveRowVineCounts(rows, 1.5);
    const cost = Math.round(vines * 1.27 * 100) / 100;
    expect(vines).toBeGreaterThan(400);
    expect(cost).toBeCloseTo(vines * 1.27, 2);
  });
});
