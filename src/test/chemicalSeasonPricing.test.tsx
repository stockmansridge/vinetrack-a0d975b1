import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
  iosSupabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
let role = "owner";
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ currentRole: role, selectedVineyardId: "v1" }),
}));

import {
  fetchChemicalSeasonPrices,
  invalidateChemicalSeasonPrices,
  parseSeasonPriceRows,
  seasonPriceQueryKey,
  useChemicalSeasonPrices,
  SEASON_PRICE_RPC,
} from "@/lib/chemicalSeasonPricing";

const row = (over: Record<string, unknown> = {}) => ({
  saved_chemical_id: "c1",
  vintage: 2026,
  weighted_cost_per_base_unit: 0.05,
  base_unit: "mL",
  currency: "AUD",
  purchase_count: 2,
  total_quantity_base: 40000,
  total_purchase_cost: 2000,
  pricing_basis: "season_weighted_purchase_average",
  warning: null,
  ...over,
});

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [row()], error: null });
  role = "owner";
});

describe("SQL 264 client", () => {
  it("1/3: calls chemical_season_purchase_prices with p_as_of null for final pricing", async () => {
    await fetchChemicalSeasonPrices("v1", 2026);
    expect(rpc).toHaveBeenCalledWith(SEASON_PRICE_RPC, { p_vineyard_id: "v1", p_vintage: 2026, p_as_of: null });
    expect(SEASON_PRICE_RPC).toBe("chemical_season_purchase_prices");
  });
  it("2: one batch request per vineyard/vintage returns every chemical", async () => {
    rpc.mockResolvedValue({ data: [row(), row({ saved_chemical_id: "c2" })], error: null });
    const m = await fetchChemicalSeasonPrices("v1", 2026);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect([...m.keys()]).toEqual(["c1", "c2"]);
  });
  it("4: sends an as-of date for planning", async () => {
    await fetchChemicalSeasonPrices("v1", 2026, "2026-10-05");
    expect(rpc.mock.calls[0][1].p_as_of).toBe("2026-10-05");
  });
  it("5: consumes the SQL weighted cost verbatim (no browser re-averaging)", () => {
    const [r] = parseSeasonPriceRows([row({ weighted_cost_per_base_unit: 0.0333, total_purchase_cost: 999, total_quantity_base: 1 })]);
    expect(r.weighted_cost_per_base_unit).toBe(0.0333);
  });
  it("6: a valid zero-cost purchase stays a valid $0 price", () => {
    const [r] = parseSeasonPriceRows([row({ weighted_cost_per_base_unit: 0 })]);
    expect(r.weighted_cost_per_base_unit).toBe(0);
    expect(r.pricing_basis).toBe("season_weighted_purchase_average");
  });
  it("7-9: conflicts stay as returned", () => {
    for (const b of ["currency_conflict", "physical_dimension_conflict", "invalid_purchase_data"]) {
      expect(parseSeasonPriceRows([row({ pricing_basis: b, weighted_cost_per_base_unit: null })])[0].pricing_basis).toBe(b);
    }
  });
});

describe("permissions + cache", () => {
  for (const r of ["owner", "manager"]) {
    it(`53/54: ${r} requests seasonal pricing`, async () => {
      role = r;
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHook(() => useChemicalSeasonPrices("v1", [2026]), { wrapper: wrap(qc) });
      await waitFor(() => expect(result.current.byVintage.get(2026)?.get("c1")).toBeTruthy());
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  }
  for (const r of ["supervisor", "operator"]) {
    it(`55/56: ${r} never calls the financial RPC`, async () => {
      role = r;
      const qc = new QueryClient();
      const { result } = renderHook(() => useChemicalSeasonPrices("v1", [2026]), { wrapper: wrap(qc) });
      await new Promise((res) => setTimeout(res, 20));
      expect(rpc).not.toHaveBeenCalled();
      expect(result.current.gated).toBe(true);
    });
  }
  it("58/59: one final query per distinct vintage, reused across trips", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChemicalSeasonPrices("v1", [2026, 2026, 2026, 2025]), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.byVintage.size).toBe(2));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData(seasonPriceQueryKey("v1", 2026, null))).toBeTruthy();
    expect(seasonPriceQueryKey("v1", 2026, null)).toEqual(["chemical-season-prices", "v1", 2026, "final"]);
  });
  it("60: recording a purchase invalidates that vineyard's seasonal pricing", async () => {
    const qc = new QueryClient();
    qc.setQueryData(seasonPriceQueryKey("v1", 2026, null), new Map());
    qc.setQueryData(seasonPriceQueryKey("v2", 2026, null), new Map());
    await invalidateChemicalSeasonPrices(qc, "v1");
    expect(qc.getQueryState(seasonPriceQueryKey("v1", 2026, null))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(seasonPriceQueryKey("v2", 2026, null))?.isInvalidated).toBe(false);
  });
});
