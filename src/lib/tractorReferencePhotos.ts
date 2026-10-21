export interface TractorPhotoIdentity {
  brand: string | null;
  model: string | null;
  model_year: number | null;
}

export interface TractorReferencePhoto {
  brands: string[];
  models: string[];
  /** Verified model production years, not the year the photo was taken. */
  firstYear: number;
  lastYear: number;
  url: string;
  sourceUrl: string;
  attribution: string;
  label: string;
  /** Explicitly verified from the source photo; missing evidence fails closed. */
  attachmentFree?: boolean;
}

const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Exact curated identity only. Never use nearest-model or inferred year matches. */
export function matchTractorReferencePhoto(
  tractor: TractorPhotoIdentity,
  catalogue: readonly TractorReferencePhoto[],
): TractorReferencePhoto | null {
  const brand = tractor.brand?.trim();
  const model = tractor.model?.trim();
  const year = tractor.model_year;
  if (!brand || !model || year == null || !Number.isInteger(year)) return null;
  return catalogue.find((photo) =>
    photo.attachmentFree === true &&
    photo.brands.some((alias) => normalise(alias) === normalise(brand)) &&
    photo.models.some((alias) => normalise(alias) === normalise(model)) &&
    year >= photo.firstYear && year <= photo.lastYear,
  ) ?? null;
}