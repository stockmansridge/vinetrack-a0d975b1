// Manual chemical entry — portal parity with the mobile ChemicalSaveContract.
//
// Covers: the always-available manual action, the minimum save contract,
// range preservation, product-level rate carriers, the SQL 222 legacy scalar
// projection, and the operational columns reaching the write payload.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const inserts: any[] = [];
const updates: any[] = [];
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (payload: any) => {
        inserts.push(payload);
        return { select: () => ({ single: async () => ({ data: payload, error: null }) }) };
      },
      update: (payload: any) => {
        updates.push(payload);
        return {
          eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }),
        };
      },
    }),
    functions: { invoke: vi.fn(async () => ({ data: null, error: new Error("no network") })) },
  },
}));

import {
  evaluateManualSaveContract,
  isUsableLabelRate,
  newlyIntroducedViolations,
  ENTER_MANUALLY_LABEL,
} from "@/lib/chemicalManualEntry";
import { grapevineOnlyDraft } from "@/lib/chemicalVineyardScope";
import { emptyManualRateDraft, type ManualRateDraft } from "@/lib/chemicalManualRate";
import { emptyDraft, type WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import { legacyRatePerHaForWrite } from "@/lib/savedChemicalLegacyRate";
import { createSavedChemical } from "@/lib/savedChemicalsQuery";
import { ChemicalAILookup } from "@/components/spray/ChemicalAILookup";

const use = (over: Partial<WriteRegisteredUse> = {}): WriteRegisteredUse => ({
  crop: "Grapevines",
  target_raw: "Powdery mildew",
  rates: [{ label: "", basis: "per_hectare", value: 1.5, unit: "L/ha" }],
  ...over,
});

const singleRate = (over: Partial<ManualRateDraft> = {}): ManualRateDraft => ({
  ...emptyManualRateDraft(),
  open: true,
  kind: "single",
  value: "1.5",
  ...over,
});

describe("simplified manual save contract", () => {
  it("saves a manual product with only a name and a single rate", () => {
    const ok = evaluateManualSaveContract({ name: "Shed Mix", rate: singleRate() });
    expect(ok.ok).toBe(true);
    expect(ok.violations).toEqual([]);
  });

  it("saves with a rate range", () => {
    expect(
      evaluateManualSaveContract({
        name: "Shed Mix",
        rate: singleRate({ kind: "range", value: "", min: "1", max: "2" }),
      }).ok,
    ).toBe(true);
  });

  it("does not block on a missing category, registered uses or manufacturer", () => {
    const result = evaluateManualSaveContract({
      name: "Shed Mix",
      rate: singleRate(),
      category: "",
      uses: [],
    });
    expect(result.ok).toBe(true);
    expect(result.violations.map((v) => v.field)).toEqual([]);
  });

  it("reports a field-level error for a missing name and a genuinely missing rate", () => {
    const none = evaluateManualSaveContract({ name: "", rate: null });
    expect(none.ok).toBe(false);
    expect(none.violations.map((v) => v.field)).toEqual(["name", "rate"]);

    const badRange = evaluateManualSaveContract({
      name: "Shed Mix",
      rate: singleRate({ kind: "range", value: "", min: "5", max: "2" }),
    });
    expect(badRange.violations.map((v) => v.field)).toEqual(["rate"]);
    expect(badRange.violations[0].message).toBeTruthy();
  });

  it("only blocks violations introduced in this editing session", () => {
    const baseline = evaluateManualSaveContract({ name: "Old", rate: null }).violations;
    const current = evaluateManualSaveContract({ name: "", rate: null }).violations;
    expect(newlyIntroducedViolations(baseline, current).map((v) => v.field)).toEqual(["name"]);
  });

  it("keeps registered uses in the data model when they are populated", () => {
    const draft = { ...emptyDraft(), registeredUses: [use()] };
    expect(grapevineOnlyDraft(draft).registeredUses).toHaveLength(1);
  });
});

describe("label rate usability (Master Catalogue / label sourced rates)", () => {
  it("treats a range as calculable and rejects zero, negative and unitless rates", () => {
    expect(
      isUsableLabelRate({ label: "", basis: "range_per_hectare", min_value: 1, max_value: 2, unit: "L/ha" }),
    ).toBe(true);
    expect(
      isUsableLabelRate({ label: "", basis: "range_per_hectare", min_value: 1, unit: "L/ha" }),
    ).toBe(false);
    expect(isUsableLabelRate({ label: "", basis: "per_hectare", value: 0, unit: "L/ha" })).toBe(false);
    expect(isUsableLabelRate({ label: "", basis: "per_hectare", value: -1, unit: "L/ha" })).toBe(false);
    expect(isUsableLabelRate({ label: "", basis: "per_hectare", value: 1, unit: "" })).toBe(false);
  });
});

describe("vineyard scope projection", () => {
  it("keeps product-level rate carriers and drops other crops", () => {
    const carrier = use({ crop: "", target_raw: "" });
    const draft = {
      ...emptyDraft(),
      registeredUses: [use(), use({ crop: "Apples" }), carrier],
    };
    const kept = grapevineOnlyDraft(draft).registeredUses;
    expect(kept).toHaveLength(2);
    expect(kept).toContain(carrier);
    expect(kept.some((u) => u.crop === "Apples")).toBe(false);
  });
});

describe("legacy per-hectare projection (SQL 222)", () => {
  const defaults = { version: 1 as const, per_hectare: null, per_100_litres: null };
  it("writes null only for a deliberate rate decision, and never converts", () => {
    expect(legacyRatePerHaForWrite({ typed: "", manual: null, defaults })).toBeUndefined();
    expect(
      legacyRatePerHaForWrite({ typed: "", manual: null, defaults, rateDecisionChanged: true }),
    ).toBeNull();
    expect(
      legacyRatePerHaForWrite({ typed: "2.5", manual: null, defaults, rateDecisionChanged: true }),
    ).toBe(2.5);
  });

  it("sends an explicit null through to the insert payload", async () => {
    inserts.length = 0;
    await createSavedChemical("v1", { name: "Shed Mix", rate_per_ha: null });
    expect(inserts[0].rate_per_ha).toBeNull();
  });

  it("persists the shared operational columns", async () => {
    inserts.length = 0;
    await createSavedChemical("v1", {
      name: "Shed Mix",
      product_form: "liquid",
      pack_size: 20,
      pack_unit: "L",
      price_per_pack: 300,
    });
    expect(inserts[0]).toMatchObject({
      product_form: "liquid",
      pack_size: 20,
      pack_unit: "L",
      price_per_pack: 300,
    });
  });
});

describe("Enter manually action", () => {
  it("is available with no search text and no vineyard country, and runs no lookup", async () => {
    const onApply = vi.fn();
    render(<ChemicalAILookup country={null} onApply={onApply} />);
    const btn = await screen.findByRole("button", { name: ENTER_MANUALLY_LABEL });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledWith({ name: "", manual: true });
  });
});
