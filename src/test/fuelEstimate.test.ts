// Regression tests for computeFuelEstimate engine-hour parsing.
//
// Root cause being guarded: Number(null) === 0, so a naive coercion made an
// end-only reading look like a valid pair (end - 0 = end). The parser must
// never substitute zero for a missing reading.
import { describe, it, expect } from "vitest";
import { computeFuelEstimate } from "@/lib/fuelEstimate";
import type { Trip } from "@/lib/tripsQuery";
import type { TractorLite } from "@/lib/tripCosting";

const tractor: TractorLite = {
  id: "t1",
  name: "Tractor 1",
  fuel_usage_l_per_hour: 6.8,
} as any;

function makeTrip(over: Record<string, unknown>): Trip {
  return {
    id: "trip-1",
    start_time: "2026-09-04T01:21:12Z",
    end_time: "2026-09-04T04:55:55.539Z",
    ...over,
  } as unknown as Trip;
}

describe("computeFuelEstimate — engine-hour pair handling", () => {
  it("null start + end 996.2 → duration basis, delta null, warning", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: null, end_engine_hours: 996.2 }),
      tractor,
      [],
    );
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
    expect(r.warnings.some((w) => w.includes("Incomplete engine-hour pair"))).toBe(true);
  });

  it("undefined start + end → duration basis", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: undefined, end_engine_hours: 996.2 }),
      tractor,
      [],
    );
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
  });

  it("start only → duration basis with incomplete-pair warning", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: 990, end_engine_hours: null }),
      tractor,
      [],
    );
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
    expect(r.warnings.some((w) => w.includes("Incomplete engine-hour pair"))).toBe(true);
  });

  it("neither reading → duration basis, no incomplete-pair warning", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: null, end_engine_hours: null }),
      tractor,
      [],
    );
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
    expect(r.warnings.some((w) => w.includes("Incomplete engine-hour pair"))).toBe(false);
  });

  it("valid pair → engine_hours basis with correct delta", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: 990, end_engine_hours: 996.2 }),
      tractor,
      [],
    );
    expect(r.basis).toBe("engine_hours");
    expect(r.engineHourDelta).toBeCloseTo(6.2, 6);
    expect(r.litres).toBeCloseTo(6.2 * 6.8, 6);
  });

  it("equal readings → duration basis", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: 996.2, end_engine_hours: 996.2 }),
      tractor,
      [],
    );
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
  });

  it("end below start → duration basis", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: 1000, end_engine_hours: 996.2 }),
      tractor,
      [],
    );
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
  });

  it("genuine start 0 + positive end → engine_hours basis", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: 0, end_engine_hours: 2.5 }),
      tractor,
      [],
    );
    expect(r.basis).toBe("engine_hours");
    expect(r.engineHourDelta).toBeCloseTo(2.5, 6);
    expect(r.litres).toBeCloseTo(2.5 * 6.8, 6);
  });

  it("empty-string start + end → duration basis", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: "", end_engine_hours: 996.2 }),
      tractor,
      [],
    );
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
  });

  it("boolean / NaN / Infinity readings → not treated as valid", () => {
    for (const bad of [true, NaN, Infinity, {}, []] as unknown[]) {
      const r = computeFuelEstimate(
        makeTrip({ start_engine_hours: bad, end_engine_hours: 996.2 }),
        tractor,
        [],
      );
      expect(r.basis).toBe("trip_duration");
      expect(r.engineHourDelta).toBeNull();
    }
  });

  it("non-empty numeric string readings may be accepted", () => {
    const r = computeFuelEstimate(
      makeTrip({ start_engine_hours: "990", end_engine_hours: "996.2" }),
      tractor,
      [],
    );
    expect(r.basis).toBe("engine_hours");
    expect(r.engineHourDelta).toBeCloseTo(6.2, 6);
  });
});

describe("computeFuelEstimate — production regression fixture", () => {
  it("end-only 996.2 reading → ~20.465 L / ~$31.28 via duration", () => {
    // start 01:21:12Z → end 04:55:55.539Z; pause-aware active duration 3.009518 hr
    const trip = makeTrip({
      start_engine_hours: null,
      end_engine_hours: 996.2,
      pause_timestamps: ["2026-09-04T02:00:00Z"],
      resume_timestamps: ["2026-09-04T02:34:09.274Z"],
    });
    const fuelPurchases = [
      { volume_litres: 100, total_cost: 152.841807909605 },
    ] as any;
    const r = computeFuelEstimate(trip, tractor, fuelPurchases);
    expect(r.basis).toBe("trip_duration");
    expect(r.engineHourDelta).toBeNull();
    expect(r.activeHours).toBeCloseTo(3.009518, 3);
    expect(r.litres).toBeCloseTo(20.465, 2);
    expect(r.cost).toBeCloseTo(31.28, 2);
  });
});
