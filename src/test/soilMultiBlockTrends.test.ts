import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn(), calls: [] as any[], maps: [] as any[], legacy: [] as any[], results: [] as any[] }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { from: mock.from } }));
import { listBlocksAnalyteResults, buildTrendSeries, splitTrendByBlocks, buildDateAverages, summariseTrend } from "@/lib/soilAnalysis";
const row = (id: string, sampleId: string, value: number, date: string, method: string | null = null, unit = "ppm") => ({
  id, sample_id: sampleId, analyte_key: "calcium", value_numeric: value, method, unit,
  soil_samples: { id: sampleId, sampled_at: date, created_at: date, extraction_status: "confirmed", paddocks: { name: "Legacy" } },
});
beforeEach(() => {
  mock.calls = []; mock.maps = []; mock.legacy = []; mock.results = [];
  mock.from.mockReset().mockImplementation((table: string) => {
    const filters: any[] = [];
    const q: any = { then: (resolve: any) => resolve({ data: table === "soil_sample_block_mappings" ? mock.maps : table === "soil_samples" ? mock.legacy : mock.results.filter((r) => filters.every(([key, val]) => key !== "analyte_key" || r.analyte_key === val)), error: null }) };
    for (const name of ["select", "eq", "in", "is"]) q[name] = (...args: any[]) => { mock.calls.push([table, name, ...args]); if (name === "eq") filters.push(args); return q; };
    return q;
  });
});
describe("mapping-aware selected-analyte read", () => {
  it("empty selection returns [] without a database read", async () => { expect(await listBlocksAnalyteResults([], "calcium")).toEqual([]); expect(mock.from).not.toHaveBeenCalled(); });
  it("one mapped lab result appears once in each selected block", async () => {
    mock.maps = [{ sample_id: "s", paddock_id: "a" }, { sample_id: "s", paddock_id: "b" }]; mock.results = [row("r", "s", 10, "2026-01-01")];
    expect((await listBlocksAnalyteResults(["a", "b"], "calcium")).map((r) => [r.id, r.matched_paddock_id])).toEqual([["r", "a"], ["r", "b"]]);
  });
  it("duplicate mappings, legacy links, selected ids and source rows never duplicate within a block", async () => {
    mock.maps = [{ sample_id: "s", paddock_id: "a" }, { sample_id: "s", paddock_id: "a" }]; mock.legacy = [{ id: "s", paddock_id: "a" }];
    mock.results = [row("r", "s", 10, "2026-01-01"), row("r", "s", 10, "2026-01-01")];
    expect(await listBlocksAnalyteResults(["a", "a"], "calcium")).toHaveLength(1);
  });
  it("queries only the requested analyte and preserves the existing active-sample filter", async () => {
    mock.legacy = [{ id: "s", paddock_id: "a" }]; mock.results = [row("r", "s", 10, "2026-01-01"), { ...row("other", "s", 20, "2026-01-01"), analyte_key: "ph" }];
    expect((await listBlocksAnalyteResults(["a"], "calcium")).map((r) => r.analyte_key)).toEqual(["calcium"]);
    expect(mock.calls).toContainEqual(["soil_sample_results", "eq", "analyte_key", "calcium"]);
    expect(mock.calls).toContainEqual(["soil_sample_results", "is", "soil_samples.deleted_at", null]);
  });
  it("sorts oldest first with stable block and result ties", async () => {
    mock.maps = [{ sample_id: "s", paddock_id: "a" }, { sample_id: "old", paddock_id: "a" }];
    mock.results = [row("z", "s", 20, "2026-01-01"), row("a", "s", 10, "2026-01-01"), row("old", "old", 1, "2025-01-01")];
    expect((await listBlocksAnalyteResults(["a"], "calcium")).map((r) => r.id)).toEqual(["old", "a", "z"]);
  });
});
const mapped = (block: string, id: string, value: number, date = "2026-01-01", method: string | null = null, unit = "ppm") => {
  const { soil_samples, ...r } = row(id, id, value, date, method, unit);
  return { ...r, sample: soil_samples, matched_paddock_id: block } as any;
};
describe("block-isolated trend arithmetic", () => {
  it("builds one active visual series across blocks then NEVER averages A with B", () => {
    const rows = [mapped("a", "a1", 10), mapped("a", "a2", 20), mapped("b", "b1", 100), mapped("b", "b2", 200)];
    const active = buildTrendSeries(rows.map((r) => ({ result: r, sample: r.sample })))[0];
    expect(active.points).toHaveLength(4);
    const split = splitTrendByBlocks(active, rows, ["a", "b"]);
    expect(split.map((b) => buildDateAverages(b.series?.points ?? []))).toEqual([[{ date: "2026-01-01", average: 15, count: 2 }], [{ date: "2026-01-01", average: 150, count: 2 }]]);
    expect(split.map((b) => b.series?.points.length)).toEqual([2, 2]);
  });
  it("known/missing methods, different methods and units stay separate across blocks", () => {
    const rows = [mapped("a", "1", 1), mapped("b", "2", 2), mapped("b", "3", 3, undefined, "Known"), mapped("a", "4", 4, undefined, "Other"), mapped("b", "5", 5, undefined, null, "%")];
    const series = buildTrendSeries(rows.map((r) => ({ result: r, sample: r.sample })));
    expect(series).toHaveLength(4); expect(series[0].provisional).toBe(true); expect(series[0].points).toHaveLength(2);
  });
  it("retains selected block order and no-data blocks in active series", () => {
    const rows = [mapped("a", "1", 10), mapped("b", "2", 99, undefined, "Known")];
    const active = buildTrendSeries(rows.map((r) => ({ result: r, sample: r.sample }))).find((s) => s.provisional) ?? null;
    const split = splitTrendByBlocks(active, rows, ["b", "a", "c"]);
    expect(split.map((b) => b.paddockId)).toEqual(["b", "a", "c"]); expect(split[0].series).toBeNull(); expect(split[2].series).toBeNull(); expect(split[1].series?.points).toHaveLength(1);
  });
  it("one block retains separate raw samples, own date change and percent", () => {
    const rows = [mapped("a", "1", 10, "2025-01-01"), mapped("a", "2", 20, "2025-01-01"), mapped("a", "3", 30)];
    const active = buildTrendSeries(rows.map((r) => ({ result: r, sample: r.sample })))[0];
    const series = splitTrendByBlocks(active, rows, ["a"])[0].series;
    if (!series) throw new Error("Expected one-block series");
    expect(summariseTrend(series, "Calcium", "range")).toMatchObject({ delta: 15, percent: 100, sampleCount: 3, dateCount: 2 });
  });
});
