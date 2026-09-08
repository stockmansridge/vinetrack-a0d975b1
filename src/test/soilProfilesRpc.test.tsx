import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpc(...a) },
}));

import {
  fromRow,
  buildPaddockUpsertArgs,
  buildVineyardDefaultUpsertArgs,
  validateSoilNumbers,
  parseSoilNumber,
  aggregateConservativeBuffer,
  usePaddockSoilProfile,
  useVineyardSoilProfiles,
  useVineyardDefaultSoilProfile,
  useUpsertPaddockSoilProfile,
  useUpsertVineyardDefaultSoilProfile,
  useDeletePaddockSoilProfile,
  useDeleteVineyardDefaultSoilProfile,
} from "@/lib/soilProfiles";

const PADDOCK = "11111111-1111-1111-1111-111111111111";
const VINEYARD = "22222222-2222-2222-2222-222222222222";

const storedRow = {
  paddock_id: PADDOCK,
  vineyard_id: VINEYARD,
  irrigation_soil_class: "loam",
  available_water_capacity_mm_per_m: 140,
  effective_root_depth_m: 0.8,
  management_allowed_depletion_percent: 35,
  is_manual_override: true,
  soil_landscape_code: "sl-1",
  land_soil_capability: "class 3",
  source_provider: "nsw_seed",
  raw_source_json: { a: 1 },
  country_code: "AU",
  region_code: "NSW",
  soil_description: "loamy",
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => rpc.mockReset());

describe("soil profile read mapping", () => {
  it("maps deployed columns into the portal model", () => {
    const p = fromRow(storedRow);
    expect(p.awc_mm_per_m).toBe(140);
    expect(p.allowed_depletion_percent).toBe(35);
    expect(p.manual_override).toBe(true);
    expect(p.salis_code).toBe("sl-1");
    expect(p.land_and_soil_capability).toBe("class 3");
    expect(p.provider).toBe("nsw_seed");
    expect(p.raw).toEqual({ a: 1 });
  });

  it("reads a block profile through get_paddock_soil_profile", async () => {
    rpc.mockResolvedValue({ data: [storedRow], error: null });
    const { result } = renderHook(() => usePaddockSoilProfile(PADDOCK), { wrapper });
    await waitFor(() => expect(result.current.data?.allowed_depletion_percent).toBe(35));
    expect(rpc).toHaveBeenCalledWith("get_paddock_soil_profile", { p_paddock_id: PADDOCK });
  });

  it("reads the vineyard-wide profile instead of returning null", async () => {
    rpc.mockResolvedValue({
      data: [{ ...storedRow, paddock_id: null }],
      error: null,
    });
    const { result } = renderHook(() => useVineyardDefaultSoilProfile(VINEYARD), { wrapper });
    await waitFor(() => expect(result.current.data?.awc_mm_per_m).toBe(140));
    expect(rpc).toHaveBeenCalledWith("get_vineyard_default_soil_profile", {
      p_vineyard_id: VINEYARD,
    });
  });

  it("lists block profiles and excludes vineyard-wide rows", async () => {
    rpc.mockResolvedValue({
      data: [storedRow, { ...storedRow, paddock_id: null }],
      error: null,
    });
    const { result } = renderHook(() => useVineyardSoilProfiles(VINEYARD), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(rpc).toHaveBeenCalledWith("list_vineyard_soil_profiles", {
      p_vineyard_id: VINEYARD,
    });
  });

  it("keeps read failures visible instead of returning empty data", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_authorized" } });
    const { result } = renderHook(() => usePaddockSoilProfile(PADDOCK), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("upsert argument mapping", () => {
  const existing = fromRow(storedRow);

  it("uses the deployed parameter names and preserves untouched metadata", () => {
    const args = buildPaddockUpsertArgs(
      {
        paddockId: PADDOCK,
        irrigationSoilClass: "clay_loam",
        awcMmPerM: 0,
        effectiveRootDepthM: 0.9,
        allowedDepletionPercent: 42,
        manualOverride: true,
      },
      existing,
    );
    expect(args.p_paddock_id).toBe(PADDOCK);
    expect(args.p_available_water_capacity_mm_per_m).toBe(0);
    expect(args.p_management_allowed_depletion_percent).toBe(42);
    expect(args.p_is_manual_override).toBe(true);
    expect(args.p_country_code).toBe("AU");
    expect(args.p_region_code).toBe("NSW");
    expect(args.p_soil_description).toBe("loamy");
    expect(args).not.toHaveProperty("p_awc_mm_per_m");
    expect(args).not.toHaveProperty("p_allowed_depletion_percent");
    expect(args).not.toHaveProperty("p_vineyard_id");
  });

  it("builds vineyard-default args keyed by vineyard", () => {
    const args = buildVineyardDefaultUpsertArgs(
      { vineyardId: VINEYARD, allowedDepletionPercent: 30 },
      null,
    );
    expect(args.p_vineyard_id).toBe(VINEYARD);
    expect(args.p_management_allowed_depletion_percent).toBe(30);
    expect(args).not.toHaveProperty("p_paddock_id");
  });
});

describe("validation", () => {
  it("keeps zero and rejects out-of-range values", () => {
    expect(parseSoilNumber("0")).toBe(0);
    expect(parseSoilNumber("")).toBeNull();
    expect(validateSoilNumbers({ awcMmPerM: 0 })).toBeNull();
    expect(validateSoilNumbers({ awcMmPerM: 401 })).toMatch(/400/);
    expect(validateSoilNumbers({ effectiveRootDepthM: 6 })).toMatch(/5 m/);
    expect(validateSoilNumbers({ allowedDepletionPercent: 120 })).toMatch(/100/);
  });
});

describe("write paths", () => {
  it("saves a block profile through the RPC after reading the stored row", async () => {
    rpc.mockResolvedValueOnce({ data: [storedRow], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useUpsertPaddockSoilProfile(), { wrapper });
    await result.current.mutateAsync({
      paddockId: PADDOCK,
      allowedDepletionPercent: 25,
    });
    expect(rpc.mock.calls[0][0]).toBe("get_paddock_soil_profile");
    expect(rpc.mock.calls[1][0]).toBe("upsert_paddock_soil_profile");
    expect(rpc.mock.calls[1][1].p_management_allowed_depletion_percent).toBe(25);
  });

  it("saves the vineyard profile without touching block rows", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useUpsertVineyardDefaultSoilProfile(), { wrapper });
    await result.current.mutateAsync({ vineyardId: VINEYARD, awcMmPerM: 120 });
    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      "get_vineyard_default_soil_profile",
      "upsert_vineyard_default_soil_profile",
    ]);
    expect(names).not.toContain("upsert_paddock_soil_profile");
  });

  it("deletes through the delete RPCs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const block = renderHook(() => useDeletePaddockSoilProfile(), { wrapper });
    await block.result.current.mutateAsync(PADDOCK);
    expect(rpc).toHaveBeenCalledWith("delete_paddock_soil_profile", {
      p_paddock_id: PADDOCK,
    });
    const vy = renderHook(() => useDeleteVineyardDefaultSoilProfile(), { wrapper });
    await vy.result.current.mutateAsync(VINEYARD);
    expect(rpc).toHaveBeenCalledWith("delete_vineyard_default_soil_profile", {
      p_vineyard_id: VINEYARD,
    });
  });

  it("surfaces write errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    const { result } = renderHook(() => useUpsertPaddockSoilProfile(), { wrapper });
    await expect(
      result.current.mutateAsync({ paddockId: PADDOCK, awcMmPerM: 100 }),
    ).rejects.toMatchObject({ message: "not_authorized" });
  });
});

describe("whole vineyard aggregation", () => {
  it("ignores vineyard-wide rows in the conservative aggregate", () => {
    const blocks = [
      fromRow(storedRow),
      fromRow({
        ...storedRow,
        paddock_id: null,
        available_water_capacity_mm_per_m: 10,
        effective_root_depth_m: 0.1,
        management_allowed_depletion_percent: 5,
      }),
    ];
    expect(aggregateConservativeBuffer(blocks)).toBeCloseTo(140 * 0.8 * 0.35, 5);
  });
});
