// Label / reference link ordering for the New Chemical modal.
//
// Practical order for a vineyard operator:
//
//   1. Manufacturer label  (the label actually in the shed)
//   2. APVMA / regulator label (the regulatory reference)
//   3. Manufacturer product page
//
// The APVMA URL is NEVER relabelled as a manufacturer label. When the backend
// did not resolve a manufacturer label the UI must say so.

import type { WriteDataSource } from "@/lib/chemicalIntelligenceWrite";

export const MANUFACTURER_LABEL_UNRESOLVED = "Manufacturer label not resolved";

const httpUrl = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^https?:\/\//i.test(s) ? s : undefined;
};

export interface ChemicalLabelLinks {
  manufacturerLabelUrl?: string;
  regulatorLabelUrl?: string;
  productUrl?: string;
  /** False when no manufacturer label URL was supplied by the backend. */
  manufacturerResolved: boolean;
}

export function resolveChemicalLabelLinks(input: {
  sources?: WriteDataSource[];
  /** Registration label reference (regulator label / citation). */
  labelReference?: string | null;
  /** Saved chemical `label_url` column. */
  labelUrl?: string | null;
  /** Saved chemical `product_url` column. */
  productUrl?: string | null;
  /** Explicit backend manufacturer label URL when the contract supplies one. */
  manufacturerLabelUrl?: string | null;
}): ChemicalLabelLinks {
  const sources = input.sources ?? [];
  const manufacturer =
    httpUrl(input.manufacturerLabelUrl) ??
    httpUrl(sources.find((s) => s.kind === "manufacturer_label")?.reference);
  const regulator =
    httpUrl(sources.find((s) => s.kind === "official_register")?.reference) ??
    httpUrl(input.labelReference) ??
    httpUrl(input.labelUrl);
  return {
    manufacturerLabelUrl: manufacturer,
    regulatorLabelUrl: regulator,
    productUrl: httpUrl(input.productUrl),
    manufacturerResolved: !!manufacturer,
  };
}
