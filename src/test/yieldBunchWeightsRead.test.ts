import { describe, it, expect, vi, beforeEach } from "vitest";

const pages: { data: any[]; count: number | null; error?: any }[] = [];
const calls: { range: [number, number]; order: string; count?: string }[] = [];
const rpcResults: { data: any; error: any }[] = [];
const rpcCalls: { fn: string; args: any }[] = [];
vi.mock("@/integrations/ios-supabase/client", () => {
  const builder = () => {
    const st: any = {};
    const b: any = {
      select: (_c: string, o: any) => ((st.count = o?.count), b),
      eq: () => b,
      is: () => b,
      order: (c: string) => ((st.order = c), b),
      range: (f: number, t: number) => {
        calls.push({ range: [f, t], order: st.order, count: st.count });
        const p = pages.shift() ?? { data: [], count: 0 };
        return Promise.resolve({ data: p.data, count: p.count, error: p.error ?? null });
      },
    };
    return b;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve(rpcResults.shift() ?? { data: null, error: { message: "no rpc stub" } });
      },
    },
  };
});

import {
  fetchYieldBunchWeights,
  bunchWeightReadStatus,
  usableBunchWeightRows,
  resolveBunchWeight,
  canonicalVarietyKey,
  type YieldBunchWeightRow,
} from "@/lib/yieldBunchWeights";
import { summariseYieldSession } from "@/lib/yieldSessionSummary";
import { gateTotalOnWeightRead } from "@/lib/vintageYieldEstimateTotal";

const V = "AAAAAAAA-0000-0000-0000-000000000001";
const r = (id: string, o: any = {}) => ({
  id, vineyard_id: V.toLowerCase(), paddock_id: null, variety_key: "shiraz",
  variety_name: "Shiraz", bunch_weight_grams: "120", updated_at: null, ...o,
});

beforeEach(() => { pages.length = 0; calls.length = 0; rpcResults.length = 0; rpcCalls.length = 0; });

describe("fetchYieldBunchWeights", () => {
  it("pages with stable id order + exact count until the count is reached", async () => {
    pages.push({ data: [r("a"), r("b")], count: 3 }, { data: [r("c")], count: 3 });
    const rows = await fetchYieldBunchWeights(V, 2);
    expect(rows.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(rows[0].bunch_weight_grams).toBe(120);
    expect(calls).toEqual([
      { range: [0, 1], order: "id", count: "exact" },
      { range: [2, 3], order: "id", count: "exact" },
    ]);
  });
  it("rejects a short (partial) read", async () => {
    pages.push({ data: [r("a")], count: 3 });
    await expect(fetchYieldBunchWeights(V, 2)).rejects.toThrow(/incomplete/);
  });
  it("rejects a count change between pages", async () => {
    pages.push({ data: [r("a"), r("b")], count: 3 }, { data: [r("c")], count: 4 });
    await expect(fetchYieldBunchWeights(V, 2)).rejects.toThrow(/changed/);
  });
  it("rejects missing count, repeated ids, cross-vineyard rows and non-canonical keys", async () => {
    pages.push({ data: [r("a")], count: null });
    await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/exact count/);
    pages.push({ data: [r("a"), r("A")], count: 2 });
    await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/repeated/);
    pages.push({ data: [r("a", { vineyard_id: "other" })], count: 1 });
    await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/another vineyard/);
    pages.push({ data: [r("a", { variety_key: " Shiraz" })], count: 1 });
    await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/non-canonical/);
  });
  it("propagates server errors", async () => {
    pages.push({ data: [], count: null, error: { message: "boom" } });
    await expect(fetchYieldBunchWeights(V)).rejects.toMatchObject({ message: "boom" });
  });
  it("empty vineyard (count 0) is confirmed empty only after the membership preflight", async () => {
    pages.push({ data: [], count: 0 });
    rpcResults.push({ data: true, error: null });
    expect(await fetchYieldBunchWeights(V)).toEqual([]);
    expect(rpcCalls).toEqual([{ fn: "is_vineyard_member", args: { p_vineyard_id: V } }]);
  });
  it("inaccessible vineyard empty read is NOT 'Not configured' (throws)", async () => {
    pages.push({ data: [], count: 0 });
    rpcResults.push({ data: false, error: null });
    await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/don't have access/);
    pages.push({ data: [], count: 0 });
    rpcResults.push({ data: null, error: { message: "network" } });
    await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/confirm access/);
  });
  it("non-empty reads need no preflight", async () => {
    pages.push({ data: [r("a")], count: 1 });
    await fetchYieldBunchWeights(V);
    expect(rpcCalls).toEqual([]);
  });
  it("rejects invalid page sizes and counts", async () => {
    for (const ps of [0, -1, 1.5, NaN, 1001]) await expect(fetchYieldBunchWeights(V, ps)).rejects.toThrow(/page size/);
    expect(calls).toEqual([]);
    for (const c of [-1, 1.5, NaN, "2" as any]) {
      pages.push({ data: [], count: c });
      await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/exact count/);
    }
  });
  it("rejects non-finite, zero, negative and >5000 g weights", async () => {
    for (const g of ["abc", null, 0, -5, 5000.01, Infinity]) {
      pages.push({ data: [r("a", { bunch_weight_grams: g })], count: 1 });
      await expect(fetchYieldBunchWeights(V)).rejects.toThrow(/invalid weight/);
    }
    pages.push({ data: [r("a", { bunch_weight_grams: 5000 })], count: 1 });
    expect((await fetchYieldBunchWeights(V))[0].bunch_weight_grams).toBe(5000);
  });
});

describe("read status", () => {
  const rows = [r("a")] as any as YieldBunchWeightRow[];
  it("distinguishes loading, unavailable, stale and current", () => {
    expect(bunchWeightReadStatus({ isLoading: true })).toBe("loading");
    expect(bunchWeightReadStatus({ isError: true })).toBe("unavailable");
    expect(bunchWeightReadStatus({ data: rows, isError: true })).toBe("stale");
    expect(bunchWeightReadStatus({ data: rows })).toBe("current");
    expect(bunchWeightReadStatus({ data: [] })).toBe("current");
  });
  it("only current/stale reads give usable rows", () => {
    expect(usableBunchWeightRows("loading", undefined)).toBeNull();
    expect(usableBunchWeightRows("unavailable", undefined)).toBeNull();
    expect(usableBunchWeightRows("stale", rows)).toBe(rows);
  });
  it("unavailable weights surface as unavailable, not not_configured", () => {
    const B1 = "b1b1b1b1-0000-0000-0000-000000000001";
    const payload = {
      blockBunchWeightsKg: { [B1]: 0.2 },
      sampleSites: [{ paddockId: B1, latitude: -34.1, longitude: 138.2, siteIndex: 1, bunchCountEntry: { bunchesPerVine: 20 } }],
    };
    const s = summariseYieldSession(payload, {
      blocks: [{ id: B1, name: "Block A", areaHa: 1, vineCount: 1000 }] as any,
      bunchWeightFor: () => ({ grams: null, source: "unavailable" }),
    });
    expect(s.blocks.length).toBeGreaterThan(0);
    const blk = s.blocks[0];
    expect(blk.bunchWeightSource).toBe("unavailable");
    expect(blk.bunchWeightKg).toBeNull();
    expect(blk.estimatedYieldTonnes).toBeNull();
    expect(blk.recordedBunchWeightKg).toBe(0.2); // historical evidence kept, not used
  });
  it("Dashboard total is withheld when a refetch fails over cached rows", () => {
    const rows = [r("a")];
    expect(gateTotalOnWeightRead({ data: rows }, 12)).toBe(12);
    expect(gateTotalOnWeightRead({ data: rows, isError: true }, 12)).toBeNull();
    expect(gateTotalOnWeightRead({ isError: true }, 12)).toBeNull();
    expect(gateTotalOnWeightRead({ isLoading: true }, 12)).toBeNull();
  });
});

describe("canonical identity (lower+trim like the DB RPCs)", () => {
  const B = "11111111-aaaa-1111-1111-111111111111";
  const rows = [
    { id: "m", vineyard_id: "v", paddock_id: null, variety_key: "pinot noir", variety_name: "Pinot", bunch_weight_grams: 110, updated_at: null },
    { id: "o", vineyard_id: "v", paddock_id: B, variety_key: "pinot noir", variety_name: "Pinot", bunch_weight_grams: 90, updated_at: null },
  ];
  it("canonicalises keys", () => expect(canonicalVarietyKey("  Pinot Noir ")).toBe("pinot noir"));
  it("matches allocation keys case/space-insensitively and block ids case-insensitively", () => {
    expect(resolveBunchWeight(rows, B.toUpperCase(), " Pinot Noir ").source).toBe("block_override");
  });
  it("cleared override falls back to the variety master", () => {
    expect(resolveBunchWeight([rows[0]], B, "pinot noir")).toMatchObject({ grams: 110, source: "variety_default" });
  });
  it("does not fuzzy-match different names", () => {
    expect(resolveBunchWeight(rows, B, "pinot").source).toBe("not_configured");
    expect(resolveBunchWeight(rows, B, "pinot_noir").source).toBe("not_configured");
  });
});
