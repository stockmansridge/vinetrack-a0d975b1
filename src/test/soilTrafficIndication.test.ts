import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mock.invoke(...args) } } }));
import { buildSoilTrafficSnapshots, type BlockAnalyteResult } from "@/lib/soilAnalysis";
import { indicateSoilSnapshots, requestSoilIndications, soilIndicationResultIds, type SoilIndication } from "@/lib/soilTrafficIndication";
const row = (id: string, status: string | null, block = "a", date = "2026-01-01") => ({ id, analyte_key: "ca", lab_status: status, matched_paddock_id: block, sample: { id, sampled_at: date, extraction_status: "confirmed" } }) as BlockAnalyteResult;
const indication = (id: string, value: SoilIndication["indication"]): SoilIndication => ({ result_id: id, indication: value, confidence: 0.82, reason: "Screening only", basis: "lab_range" });
beforeEach(() => { mock.invoke.mockReset(); });
describe("read-only AI screening", () => {
  it("requests sorted unique Other entries only, excluding rated entries even in mixed snapshots", () => {
    const snapshots = buildSoilTrafficSnapshots([row("z", null), row("rated", "Low"), row("z", null, "b"), row("a", "Acidic", "c"), row("old", null, "c", "2025-01-01")]);
    expect(soilIndicationResultIds(snapshots)).toEqual(["a", "z"]);
  });
  it.each(["low", "satisfactory", "high"] as const)("overlays %s without modifying source entries or lab-rated buckets", (bucket) => {
    const snapshots = buildSoilTrafficSnapshots([row("one", "Acidic"), row("rated", "High", "b")]);
    const original = structuredClone(snapshots);
    const out = indicateSoilSnapshots(snapshots, [indication("one", bucket)]);
    expect(out[0]).toMatchObject({ bucket, sourceBucket: "other", aiLabel: `AI indication: ${bucket[0].toUpperCase()}${bucket.slice(1)}` });
    expect(out[1]).toMatchObject({ bucket: "high", sourceBucket: "high" }); expect(out[1].aiLabel).toBeUndefined();
    expect(snapshots).toEqual(original); expect(out[0].entries[0].lab_status).toBe("Acidic");
    expect(indicateSoilSnapshots(snapshots)[0].bucket).toBe("other");
  });
  it("unable stays Other", () => {
    expect(indicateSoilSnapshots(buildSoilTrafficSnapshots([row("one", null)]), [indication("one", "unable")])[0]).toMatchObject({ bucket: "other", aiLabel: "AI: Unable to rate" });
  });
  it("conflicting same-date AI entries stay Other", () => {
    expect(indicateSoilSnapshots(buildSoilTrafficSnapshots([row("one", null), row("two", "Acidic")]), [indication("one", "high"), indication("two", "low")])[0]).toMatchObject({ bucket: "other", aiLabel: "AI: Mixed indications" });
  });
  it("conflicts with a same-date lab bucket remain Other without rating that lab entry", () => {
    expect(indicateSoilSnapshots(buildSoilTrafficSnapshots([row("one", null), row("two", "Low")]), [indication("one", "high")])[0]).toMatchObject({ bucket: "other", aiLabel: "AI: Mixed indications" });
  });
  it("missing indications cannot move a snapshot", () => {
    expect(indicateSoilSnapshots(buildSoilTrafficSnapshots([row("one", null)]), [])[0]).toMatchObject({ bucket: "other", aiLabel: "AI: Unable to rate" });
  });
  it("batches at 150 and combines classifications with vineyard identity", async () => {
    mock.invoke.mockImplementation(async (_name, { body }) => ({ data: { classifications: body.result_ids.map((id: string) => indication(id, "high")) } }));
    const ids = Array.from({ length: 301 }, (_, i) => `r${i}`);
    expect(await requestSoilIndications("vineyard", [...ids, ids[0]])).toHaveLength(301);
    expect(mock.invoke.mock.calls.map((c) => c[1].body.result_ids.length)).toEqual([150, 150, 1]);
    expect(mock.invoke.mock.calls.every((c) => c[0] === "soil-analysis-viticulture-indicate" && c[1].body.vineyard_id === "vineyard")).toBe(true);
  });
  it("does not invoke without ids", async () => { expect(await requestSoilIndications("v", [])).toEqual([]); expect(mock.invoke).not.toHaveBeenCalled(); });
  it("terminal failure stops later batches with safe error and no retry", async () => {
    mock.invoke.mockResolvedValue({ error: new Error("secret error") });
    await expect(requestSoilIndications("v", Array.from({ length: 151 }, (_, i) => `${i}`))).rejects.toThrow("AI indication is unavailable. Laboratory statuses are still shown.");
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([{ classifications: [] }, { classifications: [indication("wrong", "high")] }, { classifications: [{ ...indication("one", "high"), confidence: 82 }] }, { classifications: [{ ...indication("one", "high"), indication: "invented" }] }])("rejects incomplete or invalid output safely", async (data) => {
    mock.invoke.mockResolvedValue({ data }); await expect(requestSoilIndications("v", ["one"])).rejects.toThrow("AI indication is unavailable");
  });
});