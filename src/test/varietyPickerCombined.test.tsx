// Regression: the block-setup variety picker must show the full built-in
// catalogue (like iOS), not only varieties the vineyard has explicitly added.
// The `list_vineyard_grape_varieties` RPC returns only vineyard-added rows,
// so the picker merges it with the global `get_grape_variety_catalog`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const rpcMock = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

import { useCombinedGrapeVarieties } from "@/lib/varietyCatalog";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCombinedGrapeVarieties", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "get_grape_variety_catalog") {
        return {
          data: [
            { variety_key: "shiraz", display_name: "Shiraz", optimal_gdd: 1300, is_builtin: true },
            { variety_key: "pinot_noir", display_name: "Pinot Noir", optimal_gdd: 1100, is_builtin: true },
          ],
          error: null,
        };
      }
      if (fn === "list_vineyard_grape_varieties") {
        return {
          data: [
            // Only a custom — mirrors the reported bug where built-ins vanish.
            {
              id: "cust-1",
              variety_key: "custom:v1:saperavi",
              display_name: "Saperavi",
              is_custom: true,
              optimal_gdd_override: 1250,
            },
            // A vineyard built-in row with a GDD override.
            {
              id: "vb-1",
              variety_key: "shiraz",
              display_name: "Shiraz",
              is_custom: false,
              optimal_gdd_override: 1350,
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
  });

  it("includes built-ins even when the vineyard list has none added", async () => {
    const { result } = renderHook(() => useCombinedGrapeVarieties("v1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data.length).toBe(3));
    const names = result.current.data.map((v) => v.display_name);
    expect(names).toContain("Shiraz");
    expect(names).toContain("Pinot Noir");
    expect(names).toContain("Saperavi");
  });

  it("applies vineyard GDD override over the catalogue value", async () => {
    const { result } = renderHook(() => useCombinedGrapeVarieties("v1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data.length).toBe(3));
    const shiraz = result.current.data.find((v) => v.variety_key === "shiraz")!;
    expect(shiraz.optimal_gdd).toBe(1350);
    expect(shiraz.optimal_gdd_override).toBe(1350);
    expect(shiraz.is_custom).toBe(false);
  });

  it("keeps catalogue GDD for built-ins with no vineyard row", async () => {
    const { result } = renderHook(() => useCombinedGrapeVarieties("v1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data.length).toBe(3));
    const pinot = result.current.data.find((v) => v.variety_key === "pinot_noir")!;
    expect(pinot.optimal_gdd).toBe(1100);
    expect(pinot.optimal_gdd_override).toBeNull();
  });

  it("excludes archived custom varieties", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "get_grape_variety_catalog") return { data: [], error: null };
      if (fn === "list_vineyard_grape_varieties") {
        return {
          data: [
            { id: "c1", variety_key: "custom:v1:old", display_name: "Old", is_custom: true, archived_at: "2026-01-01T00:00:00Z" },
            { id: "c2", variety_key: "custom:v1:new", display_name: "New", is_custom: true },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const { result } = renderHook(() => useCombinedGrapeVarieties("v1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data.length).toBe(1));
    expect(result.current.data[0].display_name).toBe("New");
  });
});
