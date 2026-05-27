// Central date/time formatting.
//
// Default is d/m/y (en-GB) so vineyards in Australia, NZ, UK, Europe etc.
// see the format they expect. Only US vineyards (country === "United States"
// or ISO "US") get the en-US m/d/y order.
//
// The active locale is updated by VineyardContext when the selected vineyard
// (and therefore the country) changes, so plain utility functions can format
// dates without needing React hooks.

const DEFAULT_LOCALE = "en-GB";
const US_LOCALE = "en-US";

let activeLocale: string = DEFAULT_LOCALE;

function isUsCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  const c = country.trim().toLowerCase();
  return (
    c === "us" ||
    c === "usa" ||
    c === "u.s." ||
    c === "u.s.a." ||
    c === "united states" ||
    c === "united states of america"
  );
}

/** Called by VineyardContext when the selected vineyard's country changes. */
export function setDateLocaleFromCountry(country: string | null | undefined) {
  activeLocale = isUsCountry(country) ? US_LOCALE : DEFAULT_LOCALE;
}

export function getDateLocale(): string {
  return activeLocale;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === undefined) return new Date();
  if (value === null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Format as date only, respecting vineyard country (default d/m/y). */
export function formatDate(
  value?: Date | string | number | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString(activeLocale, options);
}

/** Format as date + time, respecting vineyard country. */
export function formatDateTime(
  value?: Date | string | number | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString(activeLocale, options);
}
