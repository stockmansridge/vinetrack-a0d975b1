// Manual RATE fallback for an already-resolved registered product.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  emptyManualRateDraft,
  manualRateLabelRate,
  manualRateRegisteredUse,
  manualRateSatisfiesGate,
  manualRateSummary,
  validateManualRate,
  type ManualRateDraft,
} from "@/lib/chemicalManualRate";
import { ManualRateEditor } from "@/components/chemicals/ManualRateEditor";
import { lookupSaveBlocked } from "@/lib/chemicalVineyardScope";
import { ENTER_MANUALLY_LABEL } from "@/lib/chemicalRateOptionsRecovery";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";

const draft = (over: Partial<ManualRateDraft> = {}): ManualRateDraft => ({
  ...emptyManualRateDraft(),
  open: true,
  ...over,
});

const grapeUse = {
  crop: "Grapevines",
  target_raw: "Powdery mildew",
  rates: [],
} as unknown as WriteRegisteredUse;

describe("manual rate validation", () => {
  it("accepts a single positive rate", () => {
    const v = validateManualRate(draft({ value: "2.5", unit: "L" }));
    expect(v).toMatchObject({ ok: true, value: 2.5, min_value: null, max_value: null });
  });

  it("rejects empty, zero, negative and non-finite values", () => {
    expect(validateManualRate(draft()).ok).toBe(false);
    expect(validateManualRate(draft({ value: "0" })).ok).toBe(false);
    expect(validateManualRate(draft({ value: "-1" })).ok).toBe(false);
    expect(validateManualRate(draft({ value: "abc" })).ok).toBe(false);
  });

  it("accepts a range and rejects an inverted range", () => {
    expect(validateManualRate(draft({ kind: "range", min: "2", max: "4" })).ok).toBe(true);
    const bad = validateManualRate(draft({ kind: "range", min: "4", max: "2" }));
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.message).toMatch(/below the minimum/i);
    expect(validateManualRate(draft({ kind: "range", min: "2", max: "" })).ok).toBe(false);
  });

  it("preserves a range as a range with no midpoint or conversion", () => {
    const rate = manualRateLabelRate(
      draft({ kind: "range", basis: "per_100_litres", min: "20", max: "40", unit: "mL" }),
    )!;
    expect(rate.basis).toBe("range_per_100_litres");
    expect(rate.min_value).toBe(20);
    expect(rate.max_value).toBe(40);
    expect(rate.value).toBeUndefined();
    expect(rate.unit).toBe("mL");
  });

  it("keeps the chosen basis untouched", () => {
    expect(manualRateLabelRate(draft({ value: "3" }))!.basis).toBe("per_hectare");
    expect(
      manualRateLabelRate(draft({ value: "3", basis: "per_100_litres" }))!.basis,
    ).toBe("per_100_litres");
    expect(manualRateSummary(draft({ value: "3" }))).toBe("3 L/ha");
  });

  it("marks provenance as user-entered and mints no canonical identity", () => {
    const use = manualRateRegisteredUse(draft({ value: "3", confirmed: true }))!;
    expect((use as any).provenance.rates).toBe("user_entered");
    const json = JSON.stringify(use);
    expect(json).not.toMatch(/default_option_v1_/);
    expect(json).not.toMatch(/rate_v1_/);
    expect(json).not.toMatch(/option_key/);
    expect(json).toContain("user_confirmed_against_label");
  });
});

describe("manual rate save gate", () => {
  const gate = (manualRateConfirmed: boolean) =>
    lookupSaveBlocked({
      isExistingRecord: false,
      selectionMode: "registered",
      uses: [grapeUse],
      defaults: null,
      staleDefaultRate: false,
      manualRateConfirmed,
    });

  it("stays blocked until the manual rate is valid AND confirmed", () => {
    expect(manualRateSatisfiesGate(draft({ value: "3" }))).toBe(false);
    expect(manualRateSatisfiesGate(draft({ confirmed: true }))).toBe(false);
    expect(manualRateSatisfiesGate(draft({ value: "3", confirmed: true }))).toBe(true);
    expect(manualRateSatisfiesGate(draft({ value: "3", confirmed: true, open: false }))).toBe(false);
    expect(gate(false)).toBe(true);
    expect(gate(true)).toBe(false);
  });

  it("never unblocks a lookup without a grapevine registration", () => {
    expect(
      lookupSaveBlocked({
        isExistingRecord: false,
        selectionMode: "registered",
        uses: [],
        defaults: null,
        staleDefaultRate: false,
        manualRateConfirmed: true,
      }),
    ).toBe(true);
  });
});

describe("ManualRateEditor", () => {
  it("is reached from a rate-manual recovery action, not manual chemical entry", () => {
    expect(ENTER_MANUALLY_LABEL).toBe("Enter rate manually");
  });

  it("edits type, basis, amounts and confirmation", () => {
    const onChange = vi.fn();
    render(
      <ManualRateEditor draft={draft({ value: "2" })} onChange={onChange} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: "5" }));
    fireEvent.click(screen.getByLabelText(/I have checked this rate/i));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }));
  });

  it("shows the inverted-range error", () => {
    render(
      <ManualRateEditor
        draft={draft({ kind: "range", min: "4", max: "2" })}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/below the minimum/i);
  });
});
