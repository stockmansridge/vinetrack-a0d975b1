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
//
// `label_reference` is NOT assumed to be registration/gazette evidence. Under
// the live backend contract it frequently carries the authoritative APVMA
// eLabel document (e.g. https://elabels.apvma.gov.au/90279ELBL.pdf), while
// `regulator_label_url` may carry an APVMA Gazette PDF. A Gazette is a
// publication, never a product label, so it must never be offered as one.

import type { WriteDataSource } from "@/lib/chemicalIntelligenceWrite";

export const MANUFACTURER_LABEL_UNRESOLVED = "Manufacturer label not resolved";

const httpUrl = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^https?:\/\//i.test(s) ? s : undefined;
};

/** An APVMA eLabel document, e.g. `https://elabels.apvma.gov.au/90279ELBL.pdf`. */
export function isApvmaELabelUrl(v: unknown): boolean {
  const url = httpUrl(v);
  if (!url) return false;
  return /^https?:\/\/(www\.)?elabels\.apvma\.gov\.au\//i.test(url);
}

/**
 * An APVMA Gazette / publication PDF. These are regulatory publications, never
 * product labels, and must never be surfaced as "Open official label".
 */
export function isApvmaGazetteUrl(v: unknown): boolean {
  const url = httpUrl(v);
  if (!url) return false;
  if (isApvmaELabelUrl(url)) return false;
  return /gazette|\/sites\/default\/files\//i.test(url);
}

/**
 * Choose the authoritative regulator LABEL from candidate URLs, in supplied
 * order. A recognised APVMA eLabel always wins; Gazette/publication URLs are
 * never eligible. Nothing is ever constructed or guessed.
 */
export function pickRegulatorLabelUrl(
  candidates: Array<string | null | undefined>,
): string | undefined {
  const urls = candidates.map(httpUrl).filter((u): u is string => !!u);
  return urls.find(isApvmaELabelUrl) ?? urls.find((u) => !isApvmaGazetteUrl(u));
}

export interface ChemicalLabelLinks {
  manufacturerLabelUrl?: string;
  /** The ACTUAL regulator eLabel / label document. */
  regulatorLabelUrl?: string;
  /**
   * Registration / gazette evidence (an `official_register` source, a Gazette
   * URL, or a `label_reference` that is not the resolved label). This is NOT a
   * product label and must never be offered as one.
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
  /** Registration label reference — may itself be the authoritative eLabel. */
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
  // A recognised eLabel wins wherever it arrives; a Gazette never becomes a
  // label. The portal never constructs a guessed eLabel URL.
  const regulatorLabel = pickRegulatorLabelUrl([input.labelUrl, input.labelReference]);
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
