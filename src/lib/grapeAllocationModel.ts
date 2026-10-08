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

// ---- Per-block breakdown (presentation only) --------------------------------

export const UNASSIGNED_BLOCK_KEY = "__no_block__";

export interface BlockAllocationRow {
  /** Lower-cased paddock id, or UNASSIGNED_BLOCK_KEY. */
  blockKey: string;
  paddockId: string | null;
  estimatedTonnes: number | null;
  ownUseTonnes: number;
  externalTonnes: number;
  allocatedTonnes: number;
  availableTonnes: number | null;
  /** Allocation records contributing to this block (for direct Edit). */
  allocationIds: string[];
}

/**
 * Splits each allocation across its linked blocks using the stored
 * grape_allocation_blocks quantities. One block with no quantity takes the
 * whole allocation. Any tonnes not covered by block quantities (no blocks,
 * several blocks without quantities, or block sums below the total) land in
 * the "No block" row so children always sum to the parent and nothing is
 * counted twice.
 */
export function buildBlockBreakdown(args: {
  allocations: GrapeAllocation[];
  /** Estimated tonnes keyed `${paddockId lower}|${varietyKey}`. */
  estimatedByBlockVariety?: Map<string, number>;
}): Map<string, BlockAllocationRow[]> {
  const { allocations, estimatedByBlockVariety } = args;
  const byVariety = new Map<string, Map<string, BlockAllocationRow>>();

  const ensure = (vk: string, bk: string, paddockId: string | null) => {
    let m = byVariety.get(vk);
    if (!m) byVariety.set(vk, (m = new Map()));
    let r = m.get(bk);
    if (!r) {
      r = {
        blockKey: bk,
        paddockId,
        estimatedTonnes:
          bk === UNASSIGNED_BLOCK_KEY ? null : estimatedByBlockVariety?.get(`${bk}|${vk}`) ?? null,
        ownUseTonnes: 0,
        externalTonnes: 0,
        allocatedTonnes: 0,
        availableTonnes: null,
        allocationIds: [],
      };
      m.set(bk, r);
    }
    return r;
  };
  const add = (r: BlockAllocationRow, a: GrapeAllocation, t: number) => {
    if (a.allocation_type === "own_use") r.ownUseTonnes += t;
    else r.externalTonnes += t;
    r.allocatedTonnes += t;
    if (!r.allocationIds.includes(a.id)) r.allocationIds.push(a.id);
  };

  for (const a of allocations) {
    const vk = varietyKeyOf(a.variety_name);
    const total = tonnesOf(a);
    // Merge duplicate links to the same paddock.
    const links = new Map<string, { id: string; q: number | null }>();
    for (const b of a.blocks ?? []) {
      if (!b.paddock_id) continue;
      const k = b.paddock_id.toLowerCase();
      const prev = links.get(k);
      const q = typeof b.quantity_tonnes === "number" && Number.isFinite(b.quantity_tonnes) ? b.quantity_tonnes : null;
      links.set(k, { id: b.paddock_id, q: prev ? (prev.q ?? 0) + (q ?? 0) || (prev.q ?? q) : q });
    }
    let assigned = 0;
    if (links.size === 1) {
      const [[k, l]] = Array.from(links);
      const t = l.q ?? total;
      add(ensure(vk, k, l.id), a, t);
      assigned = t;
    } else {
      for (const [k, l] of links) {
        if (l.q == null) continue;
        add(ensure(vk, k, l.id), a, l.q);
        assigned += l.q;
      }
    }
    const rest = total - assigned;
    if (Math.abs(rest) > 1e-9 || links.size === 0) {
      add(ensure(vk, UNASSIGNED_BLOCK_KEY, null), a, rest);
    }
  }

  const out = new Map<string, BlockAllocationRow[]>();
  for (const [vk, m] of byVariety) {
    for (const r of m.values()) {
      r.availableTonnes = r.estimatedTonnes == null ? null : r.estimatedTonnes - r.allocatedTonnes;
    }
    out.set(vk, Array.from(m.values()));
  }
  return out;
}
