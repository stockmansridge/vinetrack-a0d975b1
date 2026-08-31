// Release contract §4 — the lookup-only save gate applies to the selection
// mode, so a lookup with zero extracted uses can no longer bypass it.
import { describe, it, expect } from "vitest";
import { lookupSaveBlocked } from "@/lib/chemicalVineyardScope";
import type { WriteRegisteredUse } from "@/lib/chemicalIntelligenceWrite";
import type { PersistedDefaultRates } from "@/lib/chemicalDefaultRatesContract";

const grapeUse = {
  crop: "Grapevines",
  target_raw: "Powdery mildew",
  rates: [{ rate_id: "rate_v1_a", basis: "per_100_litres", unit: "g", min: 100, max: 200 }],
} as unknown as WriteRegisteredUse;

const citrusUse = { ...(grapeUse as any), crop: "Citrus" } as WriteRegisteredUse;

const confirmed: PersistedDefaultRates = {
  version: 1,
  per_hectare: null,
  per_100_litres: {
    option_key: "default_option_v1_x",
    rate_ids: ["rate_v1_a"],
    basis: "per_100_litres",
    unit: "g",
    value: 150,
    min_value: null,
    max_value: null,
    source: "operator",
    selected_at: null,
    label_version: null,
  },
} as PersistedDefaultRates;

const gate = (over: Partial<Parameters<typeof lookupSaveBlocked>[0]> = {}) =>
  lookupSaveBlocked({
    isExistingRecord: false,
    selectionMode: "registered",
    uses: [grapeUse],
    defaults: confirmed,
    staleDefaultRate: false,
    ...over,
  });

describe("lookup save gate", () => {
  it("blocks a lookup that returned zero registered uses", () => {
    expect(gate({ uses: [], defaults: null })).toBe(true);
    expect(gate({ uses: [] })).toBe(true);
  });

  it("blocks a lookup with non-grapevine uses only", () => {
    expect(gate({ uses: [citrusUse] })).toBe(true);
  });

  it("blocks a grapevine lookup with no confirmed rate", () => {
    expect(gate({ defaults: null })).toBe(true);
  });

  it("blocks a grapevine lookup whose confirmed rate is stale", () => {
    expect(gate({ staleDefaultRate: true })).toBe(true);
  });

  it("allows a grapevine lookup with a fresh confirmed rate", () => {
    expect(gate()).toBe(false);
    expect(gate({ selectionMode: "master" })).toBe(false);
  });

  it("leaves manual entry and existing records exempt", () => {
    expect(gate({ selectionMode: "manual", uses: [], defaults: null })).toBe(false);
    expect(gate({ isExistingRecord: true, uses: [], defaults: null })).toBe(false);
  });
});
