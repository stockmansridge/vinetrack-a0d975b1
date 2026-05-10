// Tank-mix preview math, mirroring the iOS spray/tank mix calculator.
//
// Inputs:
// - totalAreaHa: sum of selected paddock areas
// - sprayRatePerHa: water rate (L/ha)
// - tankCapacityL: tank size from equipment
// - chemical lines (rate + unit, e.g. "L/ha", "kg/ha", "mL/100L", "g/100L")
//
// Outputs per chemical: total amount across all tanks, amount per full tank,
// amount in the last (partial) tank.

import type { SprayJobChemicalLine } from "./sprayJobsQuery";

export type RateBasis = "per_ha" | "per_100L" | "unknown";

export function detectRateBasis(unit?: string | null): RateBasis {
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (!u) return "unknown";
  if (u.includes("/ha") || u.endsWith("ha")) return "per_ha";
  if (u.includes("/100l") || u.includes("/100litre") || u.includes("per100")) return "per_100L";
  return "unknown";
}

/** Strip the "/ha" or "/100L" suffix to get the chemical unit (L, mL, kg, g). */
export function chemUnitOnly(unit?: string | null): string {
  if (!unit) return "";
  return unit.replace(/\s*\/\s*(ha|100\s*l|100l|100litre)\b/i, "").trim() || unit;
}

export interface TankMixInputs {
  totalAreaHa: number | null;
  sprayRatePerHa: number | null;
  tankCapacityL: number | null;
  chemicalLines: SprayJobChemicalLine[];
}

export interface TankMixChemicalResult {
  name: string;
  unit: string; // chem unit only (no /ha or /100L)
  rate: number;
  basis: RateBasis;
  totalAmount: number | null;
  perFullTank: number | null;
  inLastTank: number | null;
}

export interface TankMixResult {
  totalWaterL: number | null;
  numFullTanks: number | null;
  lastTankL: number | null;
  totalTanks: number | null;
  chemicals: TankMixChemicalResult[];
}

export function computeTankMix(inp: TankMixInputs): TankMixResult {
  const { totalAreaHa, sprayRatePerHa, tankCapacityL, chemicalLines } = inp;
  const totalWaterL =
    totalAreaHa != null && sprayRatePerHa != null && sprayRatePerHa > 0
      ? totalAreaHa * sprayRatePerHa
      : null;

  let numFullTanks: number | null = null;
  let lastTankL: number | null = null;
  let totalTanks: number | null = null;
  if (totalWaterL != null && tankCapacityL != null && tankCapacityL > 0) {
    numFullTanks = Math.floor(totalWaterL / tankCapacityL);
    lastTankL = +(totalWaterL - numFullTanks * tankCapacityL).toFixed(1);
    totalTanks = numFullTanks + (lastTankL > 0 ? 1 : 0);
  }

  const chemicals: TankMixChemicalResult[] = (chemicalLines ?? []).map((line) => {
    const rate = Number(line.rate ?? NaN);
    // Prefer the structurally-stored rate_basis on the line; fall back to
    // detecting it from the unit text for legacy records.
    const explicit = (line as any).rate_basis as "per_hectare" | "per_100L" | null | undefined;
    const basis: RateBasis = explicit === "per_hectare"
      ? "per_ha"
      : explicit === "per_100L"
      ? "per_100L"
      : detectRateBasis(line.unit);
    const unit = chemUnitOnly(line.unit);
    let totalAmount: number | null = null;
    let perFullTank: number | null = null;
    let inLastTank: number | null = null;
    if (Number.isFinite(rate) && rate > 0) {
      if (basis === "per_ha" && totalAreaHa != null) {
        totalAmount = rate * totalAreaHa;
        if (sprayRatePerHa != null && sprayRatePerHa > 0 && tankCapacityL != null && tankCapacityL > 0) {
          perFullTank = rate * (tankCapacityL / sprayRatePerHa);
          if (lastTankL != null && lastTankL > 0)
            inLastTank = rate * (lastTankL / sprayRatePerHa);
        }
      } else if (basis === "per_100L" && totalWaterL != null) {
        totalAmount = rate * (totalWaterL / 100);
        if (tankCapacityL != null && tankCapacityL > 0) {
          perFullTank = rate * (tankCapacityL / 100);
          if (lastTankL != null && lastTankL > 0)
            inLastTank = rate * (lastTankL / 100);
        }
      }
    }
    return {
      name: line.name ?? "Unnamed",
      unit,
      rate: Number.isFinite(rate) ? rate : 0,
      basis,
      totalAmount,
      perFullTank,
      inLastTank,
    };
  });

  return { totalWaterL, numFullTanks, lastTankL, totalTanks, chemicals };
}

export function fmtAmount(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`;
}
