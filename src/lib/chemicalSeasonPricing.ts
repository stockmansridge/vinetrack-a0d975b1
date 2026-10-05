// SQL 264 seasonal chemical-purchase pricing — the Portal client.
//
// `chemical_season_purchase_prices(p_vineyard_id, p_vintage, p_as_of)` is the
// ONLY financial authority for spray chemical cost. The weighted average is
// computed by the database; the Portal never re-derives it from purchase
// history rows.
//
//   * Reporting (Cost Reports, completed-trip costing, financial exports):
//     p_as_of = null → the complete weighted average for the vintage.
//   * Live planning preview: p_as_of = vineyard-local today.
//
// One RPC call per vineyard + vintage (+ as-of), never one per chemical.
// Owner/Manager only: the request itself is gated by the cost permission —
// Supervisor and Operator never call this RPC.
import { useQueries, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useCanSeeCosts } from "@/lib/permissions";

export const SEASON_PRICE_RPC = "chemical_season_purchase_prices";
export const SEASON_PRICE_QUERY_ROOT = "chemical-season-prices";

export const SEASON_PRICING_BASES = [
  "season_weighted_purchase_average",
  "season_purchase_cost_unavailable",
  "currency_conflict",
  "physical_dimension_conflict",
  "invalid_purchase_data",
] as const;
export type SeasonPricingBasis = (typeof SEASON_PRICING_BASES)[number];

/** One SQL 264 row, typed explicitly. */
export interface ChemicalSeasonPriceRow {
  saved_chemical_id: string;
  vintage: number;
  /** Cost per canonical base unit (mL for volume, g for mass). */
  weighted_cost_per_base_unit: number | null;
  base_unit: "mL" | "g" | string | null;
  currency: string | null;
  purchase_count: number;
  total_quantity_base: number | null;
  total_purchase_cost: number | null;
  pricing_basis: SeasonPricingBasis;
  warning: string | null;
}

/** saved_chemical_id → SQL 264 row. */
export type SeasonPriceMap = Map<string, ChemicalSeasonPriceRow>;

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function basisOf(v: unknown): SeasonPricingBasis {
  return (SEASON_PRICING_BASES as readonly string[]).includes(String(v))
    ? (v as SeasonPricingBasis)
    : // Unknown basis is never treated as a usable price.
      "invalid_purchase_data";
}

/** Decode the RPC response. Values are taken verbatim — never recalculated. */
export function parseSeasonPriceRows(data: unknown): ChemicalSeasonPriceRow[] {
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  const out: ChemicalSeasonPriceRow[] = [];
  for (const r of arr as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || !r.saved_chemical_id) continue;
    out.push({
      saved_chemical_id: String(r.saved_chemical_id),
      vintage: Number(r.vintage),
      weighted_cost_per_base_unit: numOrNull(r.weighted_cost_per_base_unit),
      base_unit: r.base_unit == null ? null : String(r.base_unit),
      currency: r.currency == null ? null : String(r.currency),
      purchase_count: numOrNull(r.purchase_count) ?? 0,
      total_quantity_base: numOrNull(r.total_quantity_base),
      total_purchase_cost: numOrNull(r.total_purchase_cost),
      pricing_basis: basisOf(r.pricing_basis),
      warning: r.warning == null ? null : String(r.warning),
    });
  }
  return out;
}

export function seasonPriceQueryKey(
  vineyardId: string | null | undefined,
  vintage: number,
  asOf?: string | null,
) {
  return [SEASON_PRICE_QUERY_ROOT, vineyardId ?? null, vintage, asOf ?? "final"] as const;
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: any }> };

/**
 * ONE batch request for every Saved Chemical of a vineyard + vintage.
 * `asOf` null/undefined → final reporting price (p_as_of = null).
 */
export async function fetchChemicalSeasonPrices(
  vineyardId: string,
  vintage: number,
  asOf?: string | null,
  client: RpcClient = supabase as unknown as RpcClient,
): Promise<SeasonPriceMap> {
  const { data, error } = await client.rpc(SEASON_PRICE_RPC, {
    p_vineyard_id: vineyardId,
    p_vintage: vintage,
    p_as_of: asOf ?? null,
  });
  if (error) throw error;
  return new Map(parseSeasonPriceRows(data).map((r) => [r.saved_chemical_id, r] as const));
}

/** Vineyard-local calendar date (YYYY-MM-DD) for planning previews. */
export function vineyardLocalToday(timeZone?: string | null, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export interface SeasonPricesByVintage {
  byVintage: Map<number, SeasonPriceMap>;
  isLoading: boolean;
  /** True when the role may not see costs: no request was made. */
  gated: boolean;
}

/**
 * Cached SQL 264 batches for the given vintages (one query per distinct
 * vintage). Never fires for Supervisor/Operator.
 */
export function useChemicalSeasonPrices(
  vineyardId: string | null | undefined,
  vintages: ReadonlyArray<number>,
  opts: { asOf?: string | null; enabled?: boolean } = {},
): SeasonPricesByVintage {
  const canSeeCosts = useCanSeeCosts();
  const distinct = Array.from(new Set(vintages.filter((v) => Number.isFinite(v)))).sort();
  const enabled = !!vineyardId && canSeeCosts && opts.enabled !== false;
  const results = useQueries({
    queries: distinct.map((v) => ({
      queryKey: seasonPriceQueryKey(vineyardId, v, opts.asOf),
      enabled,
      staleTime: 5 * 60 * 1000,
      queryFn: () => fetchChemicalSeasonPrices(vineyardId!, v, opts.asOf ?? null),
    })),
  });
  const byVintage = new Map<number, SeasonPriceMap>();
  distinct.forEach((v, i) => {
    const d = results[i]?.data;
    if (d) byVintage.set(v, d);
  });
  return {
    byVintage,
    isLoading: enabled && results.some((r) => r.isLoading),
    gated: !canSeeCosts,
  };
}

/** After a Chemical Purchase is recorded: refresh that vineyard's prices. */
export function invalidateChemicalSeasonPrices(
  qc: Pick<QueryClient, "invalidateQueries">,
  vineyardId?: string | null,
) {
  return qc.invalidateQueries({
    queryKey: vineyardId ? [SEASON_PRICE_QUERY_ROOT, vineyardId] : [SEASON_PRICE_QUERY_ROOT],
  });
}
