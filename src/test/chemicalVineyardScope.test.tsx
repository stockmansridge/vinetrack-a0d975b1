// Vineyard-first Chemical Lookup scope — save projection, spray readiness,
// duplicate handling and grapevine-only presentation.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DEFAULT_RATE_NO_LONGER_ON_LABEL_MESSAGE,
  LOOKUP_DURATION_NOTICE,
  defaultRateStillSupported,
  findSavedChemicalByName,
  grapevineOnlyDraft,
  hasConfirmedRate,
  hasGrapevineRegistration,
  isSprayReady,
  normaliseChemicalName,
} from "@/lib/chemicalVineyardScope";
import { emptyDraft, type WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import { GrapevineUsesCard } from "@/components/chemicals/GrapevineUsesCard";
import type { PersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

const grapeUse = {
  crop: "Grapevines",
  target_raw: "Powdery mildew",
  rates: [{ rate_id: "rate_v1_a", basis: "per_100_litres", unit: "g", min: 100, max: 200 }],
} as unknown as WriteRegisteredUse;

const citrusUse = {
  crop: "Citrus",
  target_raw: "Scale",
  rates: [{ rate_id: "rate_v1_b", basis: "per_100_litres", unit: "g", min: 400, max: 500 }],
} as unknown as WriteRegisteredUse;

const defaults = (rateIds: string[]): PersistedDefaultRates => ({
  version: 1,
  per_hectare: null,
  per_100_litres: {
    option_key: "default_option_v1_x",
    rate_ids: rateIds,
    basis: "per_100_litres",
    unit: "g",
    value: 150,
    min_value: null,
    max_value: null,
    source: "operator",
    selected_at: null,
    label_version: null,
  },
});

describe("grapevine-only save projection", () => {
  it("persists grapevine directions only and drops other crops whole", () => {
    const draft = { ...emptyDraft(), registeredUses: [grapeUse, citrusUse] };
    const projected = grapevineOnlyDraft(draft);
    expect(projected.registeredUses).toHaveLength(1);
    expect(projected.registeredUses[0].crop).toBe("Grapevines");
    // Never merges ranges across crops.
    expect((projected.registeredUses[0] as any).rates[0].max).toBe(200);
    // Input untouched.
    expect(draft.registeredUses).toHaveLength(2);
  });

  it("returns the same draft when every use is already a grapevine use", () => {
    const draft = { ...emptyDraft(), registeredUses: [grapeUse] };
    expect(grapevineOnlyDraft(draft)).toBe(draft);
  });
});

describe("spray readiness", () => {
  it("requires both a grapevine registration and a confirmed rate", () => {
    expect(isSprayReady({ uses: [grapeUse], defaults: defaults(["rate_v1_a"]) })).toBe(true);
    expect(isSprayReady({ uses: [grapeUse], defaults: null })).toBe(false);
    // No grapevine use can never become spray-ready, even with a rate.
    expect(isSprayReady({ uses: [citrusUse], defaults: defaults(["rate_v1_b"]) })).toBe(false);
    expect(hasGrapevineRegistration([citrusUse])).toBe(false);
    expect(hasConfirmedRate(null)).toBe(false);
  });
});

describe("re-verify rate survival", () => {
  it("keeps a default whose rate identity is still on the label", () => {
    expect(defaultRateStillSupported(defaults(["rate_v1_a"]), [grapeUse])).toBe(true);
  });

  it("forces reconfirmation when the saved rate is gone", () => {
    expect(defaultRateStillSupported(defaults(["rate_v1_gone"]), [grapeUse])).toBe(false);
    expect(DEFAULT_RATE_NO_LONGER_ON_LABEL_MESSAGE).toMatch(/Confirm a rate again/);
  });
});

describe("duplicate product prompt", () => {
  const saved = [
    { id: "s1", name: "Thiovit Jet" },
    { id: "s2", name: "Kumulus DF", deleted_at: "2026-01-01T00:00:00Z" },
  ];

  it("matches on name regardless of case and spacing", () => {
    expect(findSavedChemicalByName(saved, "  thiovit   jet ")?.id).toBe("s1");
    expect(normaliseChemicalName("Thiovit-Jet")).toBe("thiovit jet");
  });

  it("ignores deleted chemicals and never matches a different product", () => {
    expect(findSavedChemicalByName(saved, "Kumulus DF")).toBeNull();
    expect(findSavedChemicalByName(saved, "Thiovit")).toBeNull();
  });

  it("states how long the label read can take", () => {
    expect(LOOKUP_DURATION_NOTICE).toMatch(/can take a few minutes/);
  });
});

describe("grapevine-only presentation", () => {
  it("does not show other crops in the normal add flow", () => {
    render(<GrapevineUsesCard uses={[grapeUse, citrusUse]} />);
    expect(screen.getByText("Powdery mildew")).toBeTruthy();
    expect(screen.queryByText(/Other crops on this label/)).toBeNull();
  });

  it("still supports an explicit full-label review", () => {
    render(<GrapevineUsesCard uses={[grapeUse, citrusUse]} showOtherCrops />);
    expect(screen.getByText(/Other crops on this label \(1\)/)).toBeTruthy();
  });
});
