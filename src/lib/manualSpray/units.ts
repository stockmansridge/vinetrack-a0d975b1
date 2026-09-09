// Manual spray entry — unit handling.
//
// Shared contract (VineTrack manual spray entry review, "Units and validation"):
//   * Water is stored in LITRES.
//   * Liquid chemical base quantities are stored in mL.
//   * Solid chemical base quantities are stored in g.
//   * Wire unit vocabulary is exactly: "Litres" | "mL" | "Kg" | "g".
//
// This module is PURE. It converts within one physical dimension only and
// never invents a density: litres never become kilograms.

export const WIRE_UNITS = ["Litres", "mL", "Kg", "g"] as const;
export type WireUnit = (typeof WIRE_UNITS)[number];

export type UnitDimension = "volume" | "mass";

/** Base unit each dimension is persisted in. */
export type BaseUnit = "mL" | "g";

const DIMENSION: Record<WireUnit, UnitDimension> = {
  Litres: "volume",
  mL: "volume",
  Kg: "mass",
  g: "mass",
};

/** Multiplier from a wire unit to its base unit (mL or g). */
const TO_BASE: Record<WireUnit, number> = {
  Litres: 1000,
  mL: 1,
  Kg: 1000,
  g: 1,
};

export const UNIT_DISPLAY_LABEL: Record<WireUnit, string> = {
  Litres: "L",
  mL: "mL",
  Kg: "kg",
  g: "g",
};

export const isWireUnit = (u: unknown): u is WireUnit =>
  typeof u === "string" && (WIRE_UNITS as readonly string[]).includes(u);

export function unitDimension(unit: unknown): UnitDimension | null {
  return isWireUnit(unit) ? DIMENSION[unit] : null;
}

export function baseUnitFor(unit: WireUnit): BaseUnit {
  return DIMENSION[unit] === "volume" ? "mL" : "g";
}

/** Wire units a physical form may legitimately use. */
export function unitsForForm(form: "liquid" | "solid" | "unknown"): WireUnit[] {
  if (form === "liquid") return ["Litres", "mL"];
  if (form === "solid") return ["Kg", "g"];
  return [...WIRE_UNITS];
}

export const sameDimension = (a: unknown, b: unknown): boolean => {
  const da = unitDimension(a);
  const db = unitDimension(b);
  return !!da && da === db;
};

export interface BaseAmount {
  /** Amount in the dimension's base unit: mL for volume, g for mass. */
  base: number;
  baseUnit: BaseUnit;
  dimension: UnitDimension;
}

const finiteNonNegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Convert an entered amount to its persisted base amount.
 * Returns null for a missing amount, an unknown unit, or a non-finite /
 * negative value — a blank is never silently treated as zero.
 */
export function toBaseAmount(value: unknown, unit: unknown): BaseAmount | null {
  if (!isWireUnit(unit)) return null;
  if (!finiteNonNegative(value)) return null;
  const base = round6((value as number) * TO_BASE[unit]);
  return { base, baseUnit: baseUnitFor(unit), dimension: DIMENSION[unit] };
}

/**
 * Convert a persisted base amount back to the unit it is displayed in.
 * Refuses a cross-dimension request rather than converting mass to volume.
 */
export function fromBaseAmount(base: unknown, unit: unknown): number | null {
  if (!isWireUnit(unit)) return null;
  if (!finiteNonNegative(base)) return null;
  return round6((base as number) / TO_BASE[unit]);
}

/** Convert between two units of the SAME dimension. Null when incompatible. */
export function convertAmount(value: unknown, from: unknown, to: unknown): number | null {
  if (!sameDimension(from, to)) return null;
  const b = toBaseAmount(value, from);
  if (!b) return null;
  return fromBaseAmount(b.base, to);
}

/** Parse a text field: "" -> missing (null); invalid -> undefined. */
export function parseAmountText(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null; // missing, explicitly distinct from zero
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined; // invalid
  return n;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
