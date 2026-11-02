// Manual Spray is an ACTUALS record. This helper only produces a read-only
// reference from the chemical's confirmed default rate and the tank water the
// operator entered. It never fills, changes or commits the "Amount used".
import { decodePersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

export interface LabelRateReference {
  basis: "per_100_litres" | "per_hectare";
  /** e.g. "200 mL/100 L" or "1–2 L/ha". */
  label: string;
  /** per-100 L only: rate × tank water ÷ 100, as text. Null when not computable. */
  estimate: string | null;
}

const n = (v: number) => String(Number(v.toFixed(3)));
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function labelRateReferences(defaultRates: unknown, tankWaterLitres: number | null | undefined): LabelRateReference[] {
  const rates = decodePersistedDefaultRates(defaultRates);
  if (!rates) return [];
  const out: LabelRateReference[] = [];
  const water = fin(tankWaterLitres) && tankWaterLitres > 0 ? tankWaterLitres : null;
  const p100 = rates.per_100_litres;
  if (p100) {
    const single = fin(p100.value) ? p100.value : null;
    const lo = fin(p100.min_value) ? p100.min_value : null;
    const hi = fin(p100.max_value) ? p100.max_value : null;
    const label = single != null ? `${n(single)} ${p100.unit}/100 L` : lo != null && hi != null ? `${n(lo)}–${n(hi)} ${p100.unit}/100 L` : null;
    if (label) {
      let estimate: string | null = null;
      if (water != null) {
        estimate = single != null
          ? `${n((single * water) / 100)} ${p100.unit}`
          : `${n((lo! * water) / 100)}–${n((hi! * water) / 100)} ${p100.unit}`;
      }
      out.push({ basis: "per_100_litres", label, estimate });
    }
  }
  const ha = rates.per_hectare;
  if (ha) {
    const single = fin(ha.value) ? ha.value : null;
    const lo = fin(ha.min_value) ? ha.min_value : null;
    const hi = fin(ha.max_value) ? ha.max_value : null;
    const label = single != null ? `${n(single)} ${ha.unit}/ha` : lo != null && hi != null ? `${n(lo)}–${n(hi)} ${ha.unit}/ha` : null;
    // Per-hectare rates depend on area, not tank water: never estimated here.
    if (label) out.push({ basis: "per_hectare", label, estimate: null });
  }
  return out;
}
