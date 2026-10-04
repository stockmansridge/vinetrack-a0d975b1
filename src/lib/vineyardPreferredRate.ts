// Vineyard Preferred Rate — the vineyard's own normal operational rate for a
// Saved Chemical (`saved_chemicals.vineyard_preferred_rate`, SQL 261).
//
// Shared contract with iOS/Android (version 1):
//   { "version": 1, "value": 2.0, "unit": "L", "basis": "per_hectare", "note": null }
// unit ∈ L | mL | kg | g, basis ∈ per_hectare | per_100_litres.
//
// It is an exact operational rate, never a registered/label rate: it is never
// written into registered_uses or default_rates, and /ha and /100 L are never
// converted into each other.
//
// Rate priority for a Program Step / Planned Spray product line:
//   1. the line's own stored rate (Program Step / planned spray decision)
//   2. Vineyard Preferred Rate
//   3. confirmed default registered rate (SQL 214 default_rates)
//   4. registered-rate selection by the operator
//   5. manual operator entry
import type { SprayProductLine } from "@/lib/sprayApplicationDomain";

export const PREFERRED_RATE_UNITS = ["L", "mL", "kg", "g"] as const;
export type PreferredRateUnit = (typeof PREFERRED_RATE_UNITS)[number];
export const PREFERRED_RATE_BASES = ["per_hectare", "per_100_litres"] as const;
export type PreferredRateBasis = (typeof PREFERRED_RATE_BASES)[number];

export interface VineyardPreferredRate {
  version: 1;
  value: number;
  unit: PreferredRateUnit;
  basis: PreferredRateBasis;
  note: string | null;
}

export const PREFERRED_RATE_HELPER =
  "Used as this vineyard's first-choice rate when building a Spray Program or planning a spray.";

export function preferredRateTitle(vineyardName: string | null | undefined): string {
  const n = (vineyardName ?? "").trim();
  return n ? `${n} Preferred Rate` : "Vineyard Preferred Rate";
}

/** Strict decode — anything malformed is treated as "no preferred rate". */
export function decodeVineyardPreferredRate(raw: unknown): VineyardPreferredRate | null {
  let v: any = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  if (Number(v.version) !== 1) return null;
  const value = typeof v.value === "number" ? v.value : Number(v.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!PREFERRED_RATE_UNITS.includes(v.unit)) return null;
  if (!PREFERRED_RATE_BASES.includes(v.basis)) return null;
  const note = typeof v.note === "string" && v.note.trim() ? v.note.trim() : null;
  return { version: 1, value, unit: v.unit, basis: v.basis, note };
}

export type PreferredRateBuild =
  | { ok: true; value: VineyardPreferredRate | null }
  | { ok: false; message: string };

/** Editor → wire. Empty amount = cleared (null). */
export function buildVineyardPreferredRate(input: {
  value: string;
  unit: string;
  basis: string;
  note?: string;
}): PreferredRateBuild {
  const t = input.value.trim();
  if (!t) return { ok: true, value: null };
  const value = Number(t);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: "Preferred rate must be a number greater than zero." };
  }
  if (!PREFERRED_RATE_UNITS.includes(input.unit as PreferredRateUnit)) {
    return { ok: false, message: "Choose a unit for the preferred rate (L, mL, kg or g)." };
  }
  if (!PREFERRED_RATE_BASES.includes(input.basis as PreferredRateBasis)) {
    return { ok: false, message: "Choose Per hectare or Per 100 L for the preferred rate." };
  }
  const note = (input.note ?? "").trim() || null;
  return {
    ok: true,
    value: {
      version: 1,
      value,
      unit: input.unit as PreferredRateUnit,
      basis: input.basis as PreferredRateBasis,
      note,
    },
  };
}

export function formatPreferredRate(r: VineyardPreferredRate | null): string | null {
  if (!r) return null;
  return `${r.value} ${r.unit}${r.basis === "per_hectare" ? "/ha" : "/100 L"}`;
}

export function productRateBasisForPreferred(
  basis: PreferredRateBasis,
): "whole_block_area" | "per_100_litres" {
  return basis === "per_hectare" ? "whole_block_area" : "per_100_litres";
}

/** The rate fields a preferred rate seeds onto a product line. */
export function preferredRateLineFields(r: VineyardPreferredRate): Pick<
  SprayProductLine,
  "rate" | "unit" | "rateBasis" | "rateSource"
> {
  return {
    rate: r.value,
    unit: r.unit,
    rateBasis: productRateBasisForPreferred(r.basis),
    rateSource: "vineyard_preferred",
  };
}

/**
 * Backwards compatibility: an existing line with NO stored rate falls back to
 * the Vineyard Preferred Rate. A line with any stored rate is never touched.
 */
export function withPreferredRateFallback(
  line: SprayProductLine,
  preferred: VineyardPreferredRate | null,
): SprayProductLine {
  if (line.rate != null || !preferred || !line.savedChemicalId) return line;
  return { ...line, ...preferredRateLineFields(preferred) };
}

/** True when the line still carries exactly the preferred rate it was seeded from. */
export function lineMatchesPreferred(
  line: SprayProductLine,
  preferred: VineyardPreferredRate | null,
): boolean {
  if (!preferred || line.rate == null) return false;
  return (
    line.rate === preferred.value &&
    line.unit === preferred.unit &&
    line.rateBasis === productRateBasisForPreferred(preferred.basis)
  );
}
