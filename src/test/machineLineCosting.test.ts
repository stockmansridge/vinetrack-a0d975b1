import { describe, expect, it } from "vitest";
import {
  computeMachineLineAuto,
  equipmentLitresPerHour,
  isOverride,
} from "@/lib/machineLineCosting";
import { buildWorkTaskCostRollup } from "@/lib/workTaskCostRollup";

const inp = (d: string, e = "", r = "") => ({ duration_hours: d, engine_hours_used: e, hourly_machine_rate: r });

describe("manual machine line auto-costing", () => {
  it("repro: 2 h × 8 L/hr at $2/L → 16 L, $32 fuel", () => {
    const a = computeMachineLineAuto(inp("2"), { litresPerHour: 8, fuelPricePerLitre: 2 });
    expect(a.fuel_litres).toBe(16);
    expect(a.fuel_cost).toBe(32);
    expect(a.total_machine_cost).toBeNull();
  });

  it("engine hours take precedence over duration for fuel", () => {
    const a = computeMachineLineAuto(inp("2", "3"), { litresPerHour: 5, fuelPricePerLitre: 2 });
    expect(a.fuel_litres).toBe(15);
  });

  it("machine charge = duration × hourly rate; blank rate is no charge, 0 is $0", () => {
    const cfg = { litresPerHour: null, fuelPricePerLitre: null };
    expect(computeMachineLineAuto(inp("2", "", "40"), cfg).total_machine_cost).toBe(80);
    expect(computeMachineLineAuto(inp("2", "", "0"), cfg).total_machine_cost).toBe(0);
    expect(computeMachineLineAuto(inp("2"), cfg).total_machine_cost).toBeNull();
  });

  it("missing L/hr or fuel price is flagged, not zero", () => {
    const noRate = computeMachineLineAuto(inp("2"), { litresPerHour: 0, fuelPricePerLitre: 2 });
    expect(noRate.fuel_litres).toBeNull();
    expect(noRate.missing.length).toBe(1);
    const noPrice = computeMachineLineAuto(inp("2"), { litresPerHour: 8, fuelPricePerLitre: null });
    expect(noPrice.fuel_litres).toBe(16);
    expect(noPrice.fuel_cost).toBeNull();
    expect(noPrice.missing.length).toBe(1);
  });

  it("saved values differing from auto are durable overrides; blank is auto", () => {
    expect(isOverride("20", 16)).toBe(true);
    expect(isOverride("0", 32)).toBe(true);
    expect(isOverride("16", 16)).toBe(false);
    expect(isOverride("", 16)).toBe(false);
  });

  it("tractor L/hr resolves directly or via linked vineyard machine", () => {
    const lookups = {
      machines: [{ id: "m1", fuel_usage_l_per_hour: 6, legacy_tractor_id: "t2" }],
      tractors: [{ id: "t1", fuel_usage_l_per_hour: 8 }, { id: "t2", fuel_usage_l_per_hour: 0 }],
    };
    expect(equipmentLitresPerHour("tractor", "t1", lookups)).toBe(8);
    expect(equipmentLitresPerHour("tractor", "t2", lookups)).toBe(6);
    expect(equipmentLitresPerHour("free_text", null, lookups)).toBeNull();
  });

  it("task total includes fuel + charge once on top of $76 labour", () => {
    const a = computeMachineLineAuto(inp("2", "", "40"), { litresPerHour: 8, fuelPricePerLitre: 2 });
    const r = buildWorkTaskCostRollup({
      task: { id: "t", costing_method: "hourly" } as never,
      labourLines: [{ id: "l", total_cost: 76, total_hours: 2, deleted_at: null } as never],
      machineLines: [{ id: "x", fuel_cost: a.fuel_cost, total_machine_cost: a.total_machine_cost, duration_hours: 2, deleted_at: null } as never],
    });
    expect(r.total).toBe(76 + 32 + 80);
  });
});
