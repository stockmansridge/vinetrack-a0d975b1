// Wine Grape Levy availability: Australian vineyards only, owner/manager only.
//
// Country authority is the vineyard profile `vineyards.country`, resolved via
// the shared vineyard-country contract. Never use `country_code` (Region &
// Units), browser locale, currency, timezone or GPS. Unknown → blocked.
import { resolveVineyardCountry } from "@/lib/vineyardCountries";
import { canAccessRoute } from "@/lib/rolePermissions";

export const WINE_GRAPE_LEVY_PATH = "/reports/wine-grape-levy";

/** The one predicate: true only when the vineyard country resolves to AU. */
export function isAustralianVineyard(country: unknown): boolean {
  return resolveVineyardCountry(country) === "AU";
}

export type WineGrapeLevyAccess =
  | "allowed"
  | "loading"
  | "role"
  | "country-missing"
  | "country-foreign";

export function wineGrapeLevyAccess(input: {
  role: string | null | undefined;
  country: unknown;
  loading: boolean;
}): WineGrapeLevyAccess {
  if (input.loading) return "loading";
  if (!canAccessRoute(WINE_GRAPE_LEVY_PATH, input.role ?? null)) return "role";
  if (isAustralianVineyard(input.country)) return "allowed";
  return resolveVineyardCountry(input.country) ? "country-foreign" : "country-missing";
}
