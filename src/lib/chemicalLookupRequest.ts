// Single place that builds the request body for the shared VineTrack
// production `chemical-info-lookup` edge function.
//
// The deployed resolver dispatches on `action`. A body without it is
// rejected with `400 {"error":"Unknown action"}`, and the country must be
// supplied as `country` (ISO-2) — `country_code` alone resolves to
// `no_country`. Snake-case aliases are kept for backwards compatibility with
// older deployments; the resolver ignores unknown keys.
//
// Every request also carries a `client` diagnostics block so Rork can trace a
// Portal search and its subsequent structured lookup together. It is
// DIAGNOSTIC ONLY: nothing in the portal branches on it, and the resolver is
// free to ignore it.

/* --------------------------------------------------------- diagnostics */

export interface LookupClientBlock {
  platform: "portal";
  app_version: string;
  app_build: string;
  correlation_id: string;
}

/** Build/version information available to the browser bundle. */
const APP_VERSION =
  (import.meta as any)?.env?.VITE_APP_VERSION ?? "portal";
const APP_BUILD =
  (import.meta as any)?.env?.VITE_APP_BUILD ??
  (import.meta as any)?.env?.MODE ??
  "unknown";

/**
 * One correlation id per lookup FLOW (a search and the structured lookup the
 * user runs from it share the same id).
 */
export function newLookupCorrelationId(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function portalClientBlock(correlationId?: string): LookupClientBlock {
  return {
    platform: "portal",
    app_version: String(APP_VERSION),
    app_build: String(APP_BUILD),
    correlation_id: correlationId ?? newLookupCorrelationId(),
  };
}

/* ------------------------------------------------------------- bodies */

export interface StructuredLookupBody {
  action: "structured";
  productName: string;
  product_name: string;
  country: string;
  country_code: string;
  structured: true;
  client: LookupClientBlock;
  [key: string]: unknown;
}

export interface SearchLookupBody {
  action: "search";
  query: string;
  productName: string;
  product_name: string;
  country: string;
  country_code: string;
  client: LookupClientBlock;
  [key: string]: unknown;
}

export function buildStructuredLookupBody(
  productName: string,
  countryCode: string,
  extra: Record<string, unknown> = {},
): StructuredLookupBody {
  const { correlationId, ...rest } = extra as { correlationId?: string };
  return {
    action: "structured",
    productName,
    product_name: productName,
    country: countryCode,
    country_code: countryCode,
    structured: true,
    client: portalClientBlock(correlationId),
    ...rest,
  };
}

/**
 * Candidate search. The server ranks; the portal never re-ranks a response
 * that carries server ranking metadata (see `chemicalLookupDiagnostics`).
 */
export function buildSearchLookupBody(
  query: string,
  countryCode: string,
  extra: Record<string, unknown> = {},
): SearchLookupBody {
  const { correlationId, ...rest } = extra as { correlationId?: string };
  return {
    action: "search",
    query,
    productName: query,
    product_name: query,
    country: countryCode,
    country_code: countryCode,
    client: portalClientBlock(correlationId),
    ...rest,
  };
}

/** Attach the diagnostics block to any other resolver body (import/preview). */
export function withClientDiagnostics<T extends Record<string, unknown>>(
  body: T,
  correlationId?: string,
): T & { client: LookupClientBlock } {
  return { ...body, client: portalClientBlock(correlationId) };
}

/**
 * Shared first-search expectation copy. Identical wording to the iOS Chemical
 * Store so both clients set the same expectation for the same backend work.
 * Repeat lookups are usually faster, but are never promised as instant.
 */
export const CHEMICAL_LOOKUP_WAIT_MESSAGE =
  "Official register searches and product details can take a few minutes the first time. " +
  "Keep this screen open while VineTrack checks the product.";
