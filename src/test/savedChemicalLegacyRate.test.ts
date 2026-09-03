// Legacy `saved_chemicals.rate_per_ha` compatibility.
//
// The structured rate contract is authoritative. `rate_per_ha` is a legacy
// scalar that may only ever carry a GENUINE per-hectare single rate.
import { describe, it, expect, vi } from "vitest";
import {
  legacyRatePerHa,
  isLegacyRatePerHaViolation,
  LEGACY_RATE_PER_HA_MESSAGE,
  describeSavedChemicalSaveError,
} from "@/lib/savedChemicalLegacyRate";
import { emptyManualRateDraft, type ManualRateDraft } from "@/lib/chemicalManualRate";
import type { PersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

const manual = (p: Partial<ManualRateDraft>): ManualRateDraft => ({
  ...emptyManualRateDraft(),
  open: true,
  confirmed: true,
  ...p,
});

const defaults = (
  slot: "per_hectare" | "per_100_litres",
  amount: Partial<{ value: number | null; min_value: number | null; max_value: number | null }>,
): PersistedDefaultRates => ({
  version: 1,
  per_hectare: slot === "per_hectare"
    ? {
        option_key: "k", rate_ids: ["r"], basis: "per_hectare", unit: "L",
        value: null, min_value: null, max_value: null, source: "operator",
        selected_at: null, label_version: null, ...amount,
      }
    : null,
  per_100_litres: slot === "per_100_litres"
    ? {
        option_key: "k", rate_ids: ["r"], basis: "per_100_litres", unit: "L",
        value: null, min_value: null, max_value: null, source: "operator",
        selected_at: null, label_version: null, ...amount,
      }
    : null,
});

describe("legacy rate_per_ha projection", () => {
  it("single per-hectare manual rate projects the scalar", () => {
    expect(
      legacyRatePerHa({ manual: manual({ kind: "single", basis: "per_hectare", value: "1.5" }) }),
    ).toBe(1.5);
  });

  it("per-hectare RANGE invents no scalar", () => {
    expect(
      legacyRatePerHa({
        manual: manual({ kind: "range", basis: "per_hectare", min: "2", max: "3" }),
      }),
    ).toBeUndefined();
  });

  it("single per-100 L rate is never projected", () => {
    expect(
      legacyRatePerHa({ manual: manual({ kind: "single", basis: "per_100_litres", value: "2" }) }),
    ).toBeUndefined();
  });

  it("SACOA Stifle 2–3 L/100 L range projects nothing", () => {
    const value = legacyRatePerHa({
      manual: manual({ kind: "range", basis: "per_100_litres", unit: "L", min: "2", max: "3" }),
    });
    expect(value).toBeUndefined();
    // Explicitly not 0, min, max or midpoint.
    expect([0, 2, 3, 2.5]).not.toContain(value as any);
  });

  it("an unconfirmed manual rate projects nothing", () => {
    expect(
      legacyRatePerHa({
        manual: manual({ kind: "single", basis: "per_hectare", value: "1.5", confirmed: false }),
      }),
    ).toBeUndefined();
  });

  it("persisted per-hectare default supplies the legacy scalar", () => {
    expect(legacyRatePerHa({ defaults: defaults("per_hectare", { value: 4 }) })).toBe(4);
  });

  it("persisted per-100 L default never supplies it", () => {
    expect(legacyRatePerHa({ defaults: defaults("per_100_litres", { value: 4 }) })).toBeUndefined();
  });

  it("the typed legacy field wins and blanks are omitted", () => {
    expect(legacyRatePerHa({ typed: "2.25" })).toBe(2.25);
    expect(legacyRatePerHa({ typed: "" })).toBeUndefined();
    expect(legacyRatePerHa({ typed: 0 })).toBeUndefined();
    expect(legacyRatePerHa({})).toBeUndefined();
  });

  it("recognises and explains the legacy NOT NULL failure", () => {
    const err = {
      message: 'null value in column "rate_per_ha" of relation "saved_chemicals" violates not-null constraint',
    };
    expect(isLegacyRatePerHaViolation(err)).toBe(true);
    expect(describeSavedChemicalSaveError(err)).toBe(LEGACY_RATE_PER_HA_MESSAGE);
    expect(describeSavedChemicalSaveError({ message: "boom" })).toBe("boom");
  });
});

/* ------------------------------------------------------------ write payload */

const writes: any[] = [];
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (payload: any) => {
        writes.push(payload);
        return { select: () => ({ single: async () => ({ data: payload, error: null }) }) };
      },
      update: (payload: any) => {
        writes.push(payload);
        return {
          eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }),
        };
      },
    }),
  },
}));

describe("saved_chemicals write payload", () => {
  it("never sends a null rate_per_ha", async () => {
    writes.length = 0;
    const { createSavedChemical } = await import("@/lib/savedChemicalsQuery");
    await createSavedChemical("v1", { name: "SACOA Stifle", rate_per_ha: null });
    expect("rate_per_ha" in writes[0]).toBe(false);
  });

  it("writes a genuine per-hectare scalar", async () => {
    writes.length = 0;
    const { createSavedChemical } = await import("@/lib/savedChemicalsQuery");
    await createSavedChemical("v1", { name: "Dithane", rate_per_ha: 2 });
    expect(writes[0].rate_per_ha).toBe(2);
  });

  it("an update that omits the field leaves the legacy column untouched", async () => {
    writes.length = 0;
    const { updateSavedChemical } = await import("@/lib/savedChemicalsQuery");
    await updateSavedChemical("sc-1", { name: "Legacy product" });
    expect("rate_per_ha" in writes[0]).toBe(false);
  });
});
