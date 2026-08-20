// Single place that builds the request body for the shared VineTrack
// production `chemical-info-lookup` edge function.
//
// The deployed resolver dispatches on `action`. A body without it is
// rejected with `400 {"error":"Unknown action"}`, and the country must be
// supplied as `country` (ISO-2) — `country_code` alone resolves to
// `no_country`. Snake-case aliases are kept for backwards compatibility with
// older deployments; the resolver ignores unknown keys.

export interface StructuredLookupBody {
  action: "structured";
  productName: string;
  product_name: string;
  country: string;
  country_code: string;
  structured: true;
  [key: string]: unknown;
}

export function buildStructuredLookupBody(
  productName: string,
  countryCode: string,
  extra: Record<string, unknown> = {},
): StructuredLookupBody {
  return {
    action: "structured",
    productName,
    product_name: productName,
    country: countryCode,
    country_code: countryCode,
    structured: true,
    ...extra,
  };
}
