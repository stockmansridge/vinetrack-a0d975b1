import { describe, it, expect } from "vitest";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { summaryVineCount, calculatedRowVineCount } from "@/lib/paddockRowVines";

const row = (number: number, extra: Record<string, any> = {}) => ({
  id: `r${number}`,
  number,
  startPoint: { latitude: -33 + number * 0.00003, longitude: 149 },
  endPoint: { latitude: -33 + number * 0.00003, longitude: 149.001 },
  ...extra,
});
const paddock = (rows: any[], extra: Record<string, any> = {}) => ({ vine_spacing: 1.5, rows, ...extra });
const show = (p: any) => summaryVineCount(p, deriveMetrics(p).vineCount);
const calc = (r: any) => calculatedRowVineCount(r, 1.5)!;

describe("summaryVineCount (mobile parity)", () => {
  it("no override → calculated count", () => {
    const p = paddock([row(1), row(2), row(3)]);
    expect(show(p)).toBe(deriveMetrics(p).vineCount);
    expect(show(p)).toBeGreaterThan(0);
  });
  it("block override → block override", () => {
    expect(show(paddock([row(1), row(2)], { vine_count_override: 900 }))).toBe(900);
  });
  it("one row override → row-effective total", () => {
    const rs = [row(1, { vineCountOverride: 10 }), row(2), row(3)];
    expect(show(paddock(rs))).toBe(10 + calc(rs[1]) + calc(rs[2]));
  });
  it("multiple row overrides → row-effective total", () => {
    const rs = [row(1, { vineCountOverride: 10 }), row(2, { vineCountOverride: 20 }), row(3)];
    expect(show(paddock(rs))).toBe(30 + calc(rs[2]));
  });
  it("block + row overrides → block override wins", () => {
    const rs = [row(1, { vineCountOverride: 10 }), row(2)];
    expect(show(paddock(rs, { vine_count_override: 500 }))).toBe(500);
  });
  it("cleared row overrides → calculated count", () => {
    const p = paddock([row(1), row(2)]);
    expect(show(p)).toBe(deriveMetrics(p).vineCount);
  });
  it("does not mutate the stored block override", () => {
    const p: any = paddock([row(1, { vineCountOverride: 10 })]);
    show(p);
    expect(p.vine_count_override).toBeUndefined();
  });
});
