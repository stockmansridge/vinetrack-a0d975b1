// Allocation-level planting identity for Yields.
//
// A block may contain several allocations of the SAME grape variety that are
// only distinguished by clone / rootstock (e.g. three Pinot Noir plantings).
// Yield must never be duplicated across those plantings, so every display and
// aggregation needs a planting identity rather than Block + Variety alone.
//
// Identity priority (see docs — no schema change is made from the portal):
//   1. Stable allocation id stored on `paddocks.variety_allocations[].id`
//   2. Block + Variety + cloneKey + rootstockKey (catalogue identity)
//   3. Legacy fallback: stored clone / rootstock display snapshots
//
// Picking records (sql/180 `picking_records`) currently store block, variety
// and a clone *display snapshot* only — there is no allocation id, clone_key
// or rootstock_key on the record. Therefore a pick can be matched to an
// allocation only when the clone snapshot resolves to exactly ONE allocation
// of that variety. Anything ambiguous stays "Unallocated within block/variety"
// and is never guessed or duplicated.
import type { ResolvedAllocation } from "@/lib/varietyResolver";

export interface AllocationUnit {
  /** Stable allocation id when the block config has one. */
  id: string | null;
  /** Synthetic, stable-within-block identity used for aggregation. */
  key: string;
  variety: string | null;
  cloneLabel: string | null;
  cloneKey: string | null;
  rootstockLabel: string | null;
  rootstockKey: string | null;
  percent: number | null;
  /** Allocated hectares (block area × allocation share). */
  areaHa: number | null;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Compact planting label: "Clone 777 · 101-14" (empty parts dropped). */
export function plantingLabel(a: {
  cloneLabel?: string | null;
  rootstockLabel?: string | null;
}): string | null {
  const parts = [a.cloneLabel, a.rootstockLabel]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  return parts.length ? parts.join(" · ") : null;
}

/** Full identity label: "Pinot Noir · Clone 777 · 101-14". */
export function allocationLabel(a: {
  variety?: string | null;
  cloneLabel?: string | null;
  rootstockLabel?: string | null;
}): string {
  const planting = plantingLabel(a);
  const variety = (a.variety ?? "").trim() || "Unspecified variety";
  return planting ? `${variety} · ${planting}` : variety;
}

/**
 * Build the allocation units for one block. Hectares are apportioned from the
 * stored allocation percentages so the parts add back to the block area; when
 * no percentages are stored the block area is split evenly (that is the same
 * assumption the rest of the Yield stack already makes).
 */
export function buildAllocationUnits(args: {
  blockId: string;
  areaHa?: number | null;
  allocations: ResolvedAllocation[];
}): AllocationUnit[] {
  const { blockId, allocations } = args;
  const area = typeof args.areaHa === "number" && args.areaHa > 0 ? args.areaHa : null;
  const percents = allocations.map((a) =>
    typeof a.percent === "number" && a.percent > 0 ? a.percent : 0,
  );
  const sum = percents.reduce((x, y) => x + y, 0);

  return allocations.map((a, i) => {
    const cloneKey = (a.raw?.cloneKey ?? (a.raw as any)?.clone_key ?? null) as string | null;
    const rootstockKey = (a.raw?.rootstockKey ??
      (a.raw as any)?.rootstock_key ??
      (a.raw as any)?.root_stock_key ??
      null) as string | null;
    const share =
      area == null
        ? null
        : sum > 0
        ? (area * percents[i]) / sum
        : area / (allocations.length || 1);
    const identity =
      a.id ??
      [norm(a.name), norm(cloneKey ?? a.clone), norm(rootstockKey ?? a.rootstock)].join("|");
    return {
      id: a.id ?? null,
      key: `${blockId}::${identity}::${i}`,
      variety: (a.name ?? "").trim() || null,
      cloneLabel: (a.clone ?? "").trim() || null,
      cloneKey,
      rootstockLabel: (a.rootstock ?? "").trim() || null,
      rootstockKey,
      percent: typeof a.percent === "number" ? a.percent : null,
      areaHa: share,
    } satisfies AllocationUnit;
  });
}

export interface AllocationMatch {
  /** Matched allocation key, or null when it cannot be resolved safely. */
  key: string | null;
  reason:
    | "single-variety-allocation"
    | "clone-snapshot"
    | "ambiguous"
    | "no-variety-match"
    | "no-allocations";
}

/**
 * Resolve one harvest record (block + variety + clone snapshot) to a planting.
 * Never guesses: when two allocations of the variety could match, the record
 * is reported ambiguous so the caller can show it as unallocated.
 */
export function matchAllocation(
  units: AllocationUnit[],
  variety: string | null | undefined,
  clone: string | null | undefined,
): AllocationMatch {
  if (!units.length) return { key: null, reason: "no-allocations" };
  const v = norm(variety);
  const candidates = v ? units.filter((u) => norm(u.variety) === v) : units.slice();
  if (!candidates.length) return { key: null, reason: "no-variety-match" };
  if (candidates.length === 1) {
    return { key: candidates[0].key, reason: "single-variety-allocation" };
  }
  const c = norm(clone);
  const byClone = candidates.filter((u) => norm(u.cloneLabel) === c || norm(u.cloneKey) === c);
  if (byClone.length === 1) return { key: byClone[0].key, reason: "clone-snapshot" };
  return { key: null, reason: "ambiguous" };
}
