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
  /** The ACTUAL regulator eLabel document (`label_url`). */
  regulatorLabelUrl?: string;
  /**
   * Registration / gazette evidence (`label_reference`, or an
   * `official_register` source). This is NOT a product label and must never be
   * offered as one.
   */
  registrationSourceUrl?: string;
  productUrl?: string;
  /** False when no manufacturer label URL was supplied by the backend. */
  manufacturerResolved: boolean;
}

export const OPEN_REGULATOR_LABEL = "Open APVMA label";
export const OPEN_REGISTRATION_SOURCE = "Open APVMA registration source";
export const OPEN_MANUFACTURER_LABEL = "Open manufacturer label";
export const OPEN_PRODUCT_PAGE = "Open product page";

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
  // Only the stored eLabel document counts as the regulator label. A register
  // / gazette citation is evidence of registration, never a product label, and
  // the portal never constructs a guessed eLabel URL.
  const regulatorLabel = httpUrl(input.labelUrl);
  const registrationSource =
    httpUrl(input.labelReference) ??
    httpUrl(sources.find((s) => s.kind === "official_register")?.reference);
  return {
    manufacturerLabelUrl: manufacturer,
    regulatorLabelUrl: regulatorLabel,
    registrationSourceUrl:
      registrationSource && registrationSource !== regulatorLabel ? registrationSource : undefined,
    productUrl: httpUrl(input.productUrl),
    manufacturerResolved: !!manufacturer,
  };
}
