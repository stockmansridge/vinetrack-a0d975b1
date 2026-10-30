import { describe, it, expect, vi, beforeEach } from "vitest";

const pages: { data: any[]; count: number | null; error?: any }[] = [];
const calls: { range: [number, number]; order: string; count?: string }[] = [];
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
  return { supabase: { from: () => builder() } };
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

const V = "AAAAAAAA-0000-0000-0000-000000000001";
const r = (id: string, o: any = {}) => ({
  id, vineyard_id: V.toLowerCase(), paddock_id: null, variety_key: "shiraz",
  variety_name: "Shiraz", bunch_weight_grams: "120", updated_at: null, ...o,
});

beforeEach(() => { pages.length = 0; calls.length = 0; });

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
  it("empty vineyard (count 0) is a confirmed empty read", async () => {
    pages.push({ data: [], count: 0 });
    expect(await fetchYieldBunchWeights(V)).toEqual([]);
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
    const s = summariseYieldSession(
      { id: "s", payload: { blockIds: ["b1"], sites: [{ blockId: "b1", bunchesPerVine: 10 }] } } as any,
      { blocks: [{ id: "b1", name: "B1" }] as any, bunchWeightFor: () => ({ grams: null, source: "unavailable" }) },
    ) as any;
    const blk = s.blocks?.[0];
    if (blk) {
      expect(blk.bunchWeightSource).toBe("unavailable");
      expect(blk.bunchWeightKg).toBeNull();
    }
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
