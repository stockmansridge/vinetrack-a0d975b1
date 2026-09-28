import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: any[]) => invoke(...a) },
    rpc: (...a: any[]) => rpc(...a),
    from: (...a: any[]) => from(...a),
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));

import type { MasterChemicalRow } from "@/lib/masterChemicals";
import { filterMasterQueue, buildMasterCurationPatch, masterLabelTargets } from "@/lib/masterCuration";
import {
  masterIssues, masterResistanceStatus, masterVineyardUses, vineyardRateStatus, masterIsComplete,
} from "@/lib/masterWorkbench";
import {
  BACKFILL_UNAVAILABLE_MESSAGE, buildBackfillBody, requestMasterBackfillPreview,
} from "@/lib/masterBackfill";
import { applyMasterReviewPreview } from "@/lib/masterReviewPreview";

const ready = (over: Partial<MasterChemicalRow> = {}): MasterChemicalRow => ({
  id: "m1",
  registered_product_name: "CropSure Beast 200",
  registration_number: "90143",
  registrant: "CropSure",
  product_category: "herbicide",
  review_status: "candidate",
  resistance_classification_state: "classified",
  active_ingredients: [{ name: "Glufosinate-ammonium", concentration: 200, concentration_unit: "g/L", activity_group: "HRAC 10" }],
  registered_uses: [{ crop: "Grapevines", target_raw: "Weeds", rates: [], withholding_period_days: 14 }],
  viticulture_rates: [{ basis: "per_hectare", kind: "range", min_value: 1, max_value: 5, unit: "L" }],
  verification_sources: [{ kind: "manufacturer_label", name: "CropSure", reference: "https://cropsure.example/beast-label.pdf" }],
  label_reference: "https://elabels.apvma.gov.au/90143.pdf",
  ...over,
});

const ids = (rows: MasterChemicalRow[]) => rows.map((r) => r.id);

describe("workbench filters", () => {
  const rows = [
    ready({ id: "ok" }),
    ready({ id: "unres", resistance_classification_state: "unresolved" }),
    ready({ id: "nogroup", resistance_classification_state: null, active_ingredients: [{ name: "X", concentration: 1, concentration_unit: "g/L" }] }),
    ready({ id: "norate", viticulture_rates: [] }),
    ready({ id: "conf", verification_conflicts: [{ field: "registrant" }] }),
  ];
  it("1 resistance unresolved", () => expect(ids(filterMasterQueue(rows, "resistance_unresolved")).sort()).toEqual(["nogroup", "unres"]));
  it("2 missing group", () => expect(ids(filterMasterQueue(rows, "missing_group"))).toEqual(["nogroup"]));
  it("3 vineyard use without rate", () => expect(ids(filterMasterQueue(rows, "vineyard_missing_rates"))).toEqual(["norate"]));
  it("4 conflicts", () => expect(ids(filterMasterQueue(rows, "conflicts"))).toEqual(["conf"]));
  it("5 rates:POTATO does not trigger Needs attention", () => {
    const row = ready({ verification_unresolved_fields: ["rates:POTATO"] });
    expect(masterIsComplete(row)).toBe(true);
    expect(filterMasterQueue([row], "needs_attention")).toHaveLength(0);
    expect(masterIsComplete(ready({ verification_unresolved_fields: ["whp:GRAPEVINES"] }))).toBe(false);
  });
  it("orders needs-attention by urgency", () =>
    expect(ids(filterMasterQueue(rows, "needs_attention"))[0]).toBe("conf"));
  it("does not require rates without a vineyard registration", () =>
    expect(masterIsComplete(ready({ registered_uses: [{ crop: "Wheat", target_raw: "x", rates: [] }], viticulture_rates: [] }))).toBe(true));
});

describe("presentation", () => {
  it("6 structured resistance display", () => {
    expect(masterResistanceStatus(ready()).text).toBe("HRAC 10");
    expect(masterResistanceStatus(ready({ resistance_classification_state: "not_applicable", active_ingredients: [] })).text)
      .toBe("No resistance group applies");
    // empty group array never becomes not applicable
    expect(masterResistanceStatus(ready({ resistance_classification_state: null, active_ingredients: [], activity_groups: [] })).state)
      .toBe("unresolved");
    const mix = masterResistanceStatus(ready({
      product_category: "fungicide",
      active_ingredients: [
        { name: "A", concentration: 1, concentration_unit: "g/L", activity_group: "FRAC 3" },
        { name: "B", concentration: 1, concentration_unit: "g/L" },
      ],
    }));
    expect(mix.text).toBe("Resistance classification incomplete");
  });
  it("7 vineyard-specific uses and rate status", () => {
    const row = ready({ registered_uses: [{ crop: "Grapevines", target_raw: "W", rates: [] }, { crop: "Potato", target_raw: "W", rates: [] }] });
    expect(masterVineyardUses(row).map((u) => u.crop)).toEqual(["Grapevines"]);
    expect(vineyardRateStatus(ready())).toBe("ha");
    expect(vineyardRateStatus(ready({ viticulture_rates: [] }))).toBe("vineyard_missing");
  });
  it("8 manufacturer vs regulator label separation", () => {
    const t = masterLabelTargets(ready());
    expect(t.find((x) => x.kind === "manufacturer_label")?.url).toContain("cropsure");
    expect(t.find((x) => x.kind === "regulator_label")?.url).toContain("apvma");
    expect(masterIssues(ready({ verification_sources: [] })).some((i) => i.key === "manufacturer_label_missing")).toBe(true);
  });
});

describe("Find Missing Data", () => {
  beforeEach(() => { invoke.mockReset(); rpc.mockReset(); from.mockReset(); });

  it("9 sends the Master ID only", async () => {
    invoke.mockResolvedValue({ data: { preview_id: "p1", changes: [{ field: "x", current: null, proposed: "y" }] }, error: null });
    await requestMasterBackfillPreview("m1");
    expect(invoke.mock.calls[0][1].body).toEqual({ action: "master_backfill_preview_v2", master_chemical_id: "m1" });
    expect(buildBackfillBody("m1")).toEqual({ action: "master_backfill_preview_v2", master_chemical_id: "m1" });
  });
  it("10 unavailable action → clean message", async () => {
    invoke.mockResolvedValue({ data: { error: "Unknown action: master_backfill_preview_v2" }, error: { message: "Edge Function returned a non-2xx status code" } });
    expect(await requestMasterBackfillPreview("m1")).toEqual({ outcome: "unavailable", message: BACKFILL_UNAVAILABLE_MESSAGE });
  });
  it("11 preview does not mutate data", async () => {
    invoke.mockResolvedValue({ data: { preview_id: "p1", changes: [{ field: "x", current: null, proposed: "y" }] }, error: null });
    const r = await requestMasterBackfillPreview("m1");
    expect(r.outcome).toBe("preview");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it("12–14 apply sends preview id + master id + reason, re-fetches, never approves", async () => {
    rpc.mockResolvedValue({ data: { status: "applied" }, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: ready({ review_status: "candidate" }), error: null });
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
    const res = await applyMasterReviewPreview({ previewId: "p1", masterId: "m1", reason: "fill" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["master_review_apply", { p_master_id: "m1", p_preview_id: "p1", p_reason: "fill" }]);
    expect(maybeSingle).toHaveBeenCalled();
    expect(res.row?.review_status).toBe("candidate");
  });
  it("15 manual curation never sends viticulture_rates", () => {
    const patch = buildMasterCurationPatch({
      row: ready({ viticulture_rates: [] }),
      identity: { product_category: "fungicide", viticulture_rates: [{}] } as any,
      reason: "r",
    });
    expect(patch).toEqual({ product_category: "fungicide" });
  });
});
