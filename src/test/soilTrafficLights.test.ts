import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ calls: [] as any[], maps: [] as any[], legacy: [] as any[], results: [] as any[] }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { from: (table: string) => {
  const q: any = { then: (resolve: any) => resolve({ data: table === "soil_sample_block_mappings" ? mock.maps : table === "soil_samples" ? mock.legacy : mock.results, error: null }) };
  for (const method of ["select", "in", "eq", "is", "lte"]) q[method] = (...args: any[]) => { mock.calls.push([table, method, ...args]); return q; };
  return q;
} } }));
import { soilTrafficBucket, listSoilTrafficResults, buildSoilTrafficSnapshots, soilTrafficCounts, type BlockAnalyteResult } from "@/lib/soilAnalysis";
const row = (id: string, status: string | null, date = "2026-01-01", block = "a", analyte = "ca"): BlockAnalyteResult => ({
  id, sample_id: id, analyte_key: analyte, value_numeric: 100, unit: "ppm", method: "Method", lab_status: status,
  matched_paddock_id: block, sample: { id, sampled_at: date, extraction_status: "confirmed", deleted_at: null },
} as BlockAnalyteResult);
beforeEach(() => { mock.calls = []; mock.maps = []; mock.legacy = []; mock.results = []; });
describe("laboratory-only traffic buckets", () => {
  it.each(["Low", "Very Low", "low", "very_low"])("%s is low", (s) => expect(soilTrafficBucket(s)).toBe("low"));
  it.each(["High", "Very High"])("%s is high", (s) => expect(soilTrafficBucket(s)).toBe("high"));
  it.each(["Satisfactory", "Within lab range", "within_range", "Within laboratory range"])("%s is satisfactory", (s) => expect(soilTrafficBucket(s)).toBe("satisfactory"));
  it.each(["Acidic", "Slightly acidic", "", null, "Optimal", "Normal"])("%s remains other", (s) => expect(soilTrafficBucket(s)).toBe("other"));
  it("numeric value never determines the bucket", () => {
    expect(buildSoilTrafficSnapshots([{ ...row("r", null), value_numeric: -999 }])[0].bucket).toBe("other");
    expect(buildSoilTrafficSnapshots([{ ...row("r", "Low"), value_numeric: 999999 }])[0].bucket).toBe("low");
  });
});
describe("confirmed mapping-aware traffic read", () => {
  it("returns no results without selected blocks", async () => { expect(await listSoilTrafficResults([])).toEqual([]); expect(mock.calls).toEqual([]); });
  it("reads every analyte, confirmed only, applies as-of and preserves once per matched block", async () => {
    mock.maps = [{ sample_id: "r", paddock_id: "a" }, { sample_id: "r", paddock_id: "b" }, { sample_id: "r", paddock_id: "a" }];
    const { sample, matched_paddock_id, ...r } = row("r", "Very Low");
    mock.results = [{ ...r, soil_samples: sample }, { ...r, soil_samples: sample }, { ...r, id: "ph", analyte_key: "ph", soil_samples: sample },
      { ...r, id: "draft", soil_samples: { ...sample, extraction_status: "review_required" } },
      { ...r, id: "future", soil_samples: { ...sample, sampled_at: "2027-01-01" } }];
    const out = await listSoilTrafficResults(["a", "b", "a"], "2026-10-27");
    expect(out.map((r) => [r.id, r.matched_paddock_id])).toEqual([["r", "a"], ["r", "b"], ["ph", "a"], ["ph", "b"]]);
    expect(mock.calls).toContainEqual(["soil_sample_results", "eq", "soil_samples.extraction_status", "confirmed"]);
    expect(mock.calls).toContainEqual(["soil_sample_results", "lte", "soil_samples.sampled_at", "2026-10-27"]);
    expect(mock.calls.some((c) => c[2] === "analyte_key")).toBe(false);
    expect(out[0]).toMatchObject({ lab_status: "Very Low", value_numeric: 100, method: "Method", unit: "ppm", sample: { sampled_at: "2026-01-01" } });
  });
});
describe("latest block-analyte snapshots", () => {
  it("uses latest date independently for each block and analyte", () => {
    const out = buildSoilTrafficSnapshots([row("old", "High", "2025-01-01"), row("new", "Low"), row("b", "Satisfactory", "2025-01-01", "b"), row("ph", "Acidic", "2024-01-01", "a", "ph")]);
    expect(out.map((s) => [s.paddockId, s.analyteKey, s.date, s.bucket])).toEqual([["a", "ca", "2026-01-01", "low"], ["b", "ca", "2025-01-01", "satisfactory"], ["a", "ph", "2024-01-01", "other"]]);
  });
  it("same-date same-bucket replicates stay raw including exact wording and mixed units", () => {
    const out = buildSoilTrafficSnapshots([row("one", "Low"), { ...row("two", "Very Low"), unit: "%", method: null }]);
    expect(out[0].bucket).toBe("low"); expect(out[0].entries).toHaveLength(2);
    expect(out[0].entries.map((r) => r.lab_status)).toEqual(["Low", "Very Low"]);
  });
  it("same-date conflicting buckets become Other / Mixed latest statuses", () => {
    const snapshot = buildSoilTrafficSnapshots([row("one", "Low"), row("two", "High")])[0];
    expect(snapshot).toMatchObject({ bucket: "other", statusLabel: "Mixed latest statuses" }); expect(snapshot.entries).toHaveLength(2);
  });
  it("blank beside satisfactory cannot silently become satisfactory", () => {
    expect(buildSoilTrafficSnapshots([row("one", "Satisfactory"), row("two", null)])[0]).toMatchObject({ bucket: "other", statusLabel: "Mixed latest statuses" });
  });
  it("neutral exact acidic and blank statuses remain distinguished", () => {
    expect(buildSoilTrafficSnapshots([row("one", "Slightly acidic")])[0].statusLabel).toBe("Slightly acidic");
    expect(buildSoilTrafficSnapshots([row("one", null)])[0].statusLabel).toBe("Not stated");
  });
  it("counts block-analyte snapshots, not unique analytes or replicates", () => {
    const rows = [row("a", "Low"), row("rep", "Very Low"), row("b", "Low", undefined, "b"), row("sat", "Satisfactory", undefined, "c"), row("high", "High", undefined, "d"), row("other", "Acidic", undefined, "e")];
    expect(soilTrafficCounts(buildSoilTrafficSnapshots(rows))).toEqual({ low: 2, satisfactory: 1, high: 1, other: 1 });
  });
});