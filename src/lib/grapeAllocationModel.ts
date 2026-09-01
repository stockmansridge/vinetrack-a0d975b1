// Grape Allocation Tracker — pure aggregation model.
//
// Estimated tonnes are NEVER calculated here. They come from the existing
// authoritative Yield estimate (latest completed Bunch Count trip per block
// for the vintage, apportioned per planting) and are passed in per variety.
import type { AllocationType, GrapeAllocation } from "@/lib/grapeAllocationsQuery";

export interface AllocationFinancialLookup {
  pricePerTonne: number | null;
  contractValue: number | null;
}

export interface VarietyAllocationRow {
  varietyKey: string;
  variety: string;
  estimatedTonnes: number | null;
  ownUseTonnes: number;
  externalTonnes: number;
  allocatedTonnes: number;
  /** Positive = still available, negative = over-allocated (shortfall). */
  availableTonnes: number | null;
  /** Owner / Manager only — null when financials are not visible. */
  contractedIncome: number | null;
}

export interface AllocationTotals {
  estimatedTonnes: number | null;
  ownUseTonnes: number;
  externalTonnes: number;
  allocatedTonnes: number;
  availableTonnes: number | null;
  contractedIncome: number | null;
}

export const varietyKeyOf = (v: string | null | undefined) =>
  (v ?? "").trim().toLowerCase() || "__unspecified__";

const tonnesOf = (a: GrapeAllocation) =>
  typeof a.quantity_tonnes === "number" && Number.isFinite(a.quantity_tonnes)
    ? a.quantity_tonnes
    : 0;

export function buildAllocationRows(args: {
  allocations: GrapeAllocation[];
  /** Estimated tonnes by variety key for the selected vintage. */
  estimatedByVariety: Map<string, number>;
  /** Present only when the viewer may see money. */
  financials?: Map<string, AllocationFinancialLookup> | null;
}): VarietyAllocationRow[] {
  const { allocations, estimatedByVariety, financials } = args;
  const rows = new Map<string, VarietyAllocationRow>();

  const ensure = (key: string, label: string): VarietyAllocationRow => {
    let r = rows.get(key);
    if (!r) {
      r = {
        varietyKey: key,
        variety: label,
        estimatedTonnes: estimatedByVariety.get(key) ?? null,
        ownUseTonnes: 0,
        externalTonnes: 0,
        allocatedTonnes: 0,
        availableTonnes: null,
        contractedIncome: financials ? 0 : null,
      };
      rows.set(key, r);
    }
    return r;
  };

  // Every estimated variety appears even with no allocations yet.
  for (const [key, tonnes] of estimatedByVariety) {
    const r = ensure(key, key === "__unspecified__" ? "Unspecified variety" : key);
    r.estimatedTonnes = tonnes;
  }

  for (const a of allocations) {
    const key = varietyKeyOf(a.variety_name);
    const label = (a.variety_name ?? "").trim() || "Unspecified variety";
    const r = ensure(key, label);
    if (r.variety === key) r.variety = label;
    const t = tonnesOf(a);
    if (a.allocation_type === ("own_use" satisfies AllocationType)) r.ownUseTonnes += t;
    else r.externalTonnes += t;
    r.allocatedTonnes += t;
    if (financials) {
      const f = financials.get(a.id);
      const value =
        f?.contractValue ?? (f?.pricePerTonne != null ? f.pricePerTonne * t : null);
      if (value != null) r.contractedIncome = (r.contractedIncome ?? 0) + value;
    }
  }

  for (const r of rows.values()) {
    r.availableTonnes =
      r.estimatedTonnes == null ? null : r.estimatedTonnes - r.allocatedTonnes;
  }

  return Array.from(rows.values()).sort((a, b) => a.variety.localeCompare(b.variety));
}

export function totalsFromRows(rows: VarietyAllocationRow[]): AllocationTotals {
  const anyEstimate = rows.some((r) => r.estimatedTonnes != null);
  const estimated = anyEstimate
    ? rows.reduce((a, r) => a + (r.estimatedTonnes ?? 0), 0)
    : null;
  const own = rows.reduce((a, r) => a + r.ownUseTonnes, 0);
  const ext = rows.reduce((a, r) => a + r.externalTonnes, 0);
  const allocated = own + ext;
  const anyIncome = rows.some((r) => r.contractedIncome != null);
  return {
    estimatedTonnes: estimated,
    ownUseTonnes: own,
    externalTonnes: ext,
    allocatedTonnes: allocated,
    availableTonnes: estimated == null ? null : estimated - allocated,
    contractedIncome: anyIncome ? rows.reduce((a, r) => a + (r.contractedIncome ?? 0), 0) : null,
  };
}
