// Quick View / Overview model for the Yields page.
//
// Deliberately dumb: it does NOT calculate estimates. Estimated tonnes come
// from `summariseYieldSession()` (the single shared Yield calculation) and are
// apportioned across a block's configured allocations using the canonical
// `variety_allocations` percentages. Actual tonnes come from picking records
// and from `historical_yield_records.block_results`.
//
// IMPORTANT: a block may hold several allocations of the SAME variety that
// differ only by clone / rootstock. Each allocation is its own production
// unit: actual and estimated tonnes are attributed to exactly one allocation
// and are never repeated across same-variety rows. Harvest that cannot be
// resolved to a single allocation is reported as "Unallocated" for that
// block + variety instead of being guessed or duplicated.

export interface OverviewBlockVariety {
  name: string | null;
  percent: number | null;
  /** Stable allocation identity (see lib/yieldAllocations). */
  allocationKey?: string | null;
  allocationId?: string | null;
  cloneLabel?: string | null;
  rootstockLabel?: string | null;
  /** Allocated hectares for this planting. */
  areaHa?: number | null;
}

export interface OverviewBlockInput {
  id: string;
  name: string | null;
  areaHa?: number | null;
  varieties: OverviewBlockVariety[];
}

export interface OverviewActualEntry {
  blockId: string | null;
  variety: string | null;
  tonnes: number | null;
  /** Allocation this harvest belongs to; null when it cannot be resolved. */
  allocationKey?: string | null;
  /** Which system produced the total — detailed picks supersede basic. */
  source?: "basic" | "detailed";
  /** Number of picking records behind a detailed total. */
  pickCount?: number | null;
}

export type ActualSource = "basic" | "detailed" | null;

export interface OverviewVarietyRow {
  variety: string | null;
  allocationKey: string | null;
  allocationId: string | null;
  cloneLabel: string | null;
  rootstockLabel: string | null;
  percent: number | null;
  areaHa: number | null;
  estimatedTonnes: number | null;
  actualTonnes: number | null;
  actualSource: ActualSource;
  actualPickCount: number | null;
}

export interface OverviewUnallocatedRow {
  variety: string | null;
  actualTonnes: number;
  actualSource: ActualSource;
  actualPickCount: number | null;
}

export interface OverviewBlockCard {
  blockId: string;
  blockName: string;
  areaHa: number | null;
  varieties: OverviewVarietyRow[];
  /** Harvest that could not be tied to a single planting. */
  unallocated: OverviewUnallocatedRow[];
  estimatedTonnes: number | null;
  actualTonnes: number | null;
  actualSource: ActualSource;
  actualPickCount: number | null;
}

const key = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Split a block total across allocations by percent (equal when unset). */
function apportion(total: number | null, varieties: OverviewBlockVariety[]): (number | null)[] {
  if (total == null) return varieties.map(() => null);
  if (!varieties.length) return [];
  const percents = varieties.map((v) => (typeof v.percent === "number" && v.percent > 0 ? v.percent : 0));
  const sum = percents.reduce((a, b) => a + b, 0);
  if (sum <= 0) return varieties.map(() => total / varieties.length);
  return percents.map((p) => (total * p) / sum);
}

interface Agg {
  tonnes: number;
  detailed: boolean;
  basic: boolean;
  pickCount: number | null;
}

export function buildYieldOverview(args: {
  blocks: OverviewBlockInput[];
  /** Estimated tonnes per block id (from summariseYieldSession). */
  estimatedByBlock: Map<string, number>;
  /** Actual yield entries (detailed picks and/or historical block results). */
  actuals: OverviewActualEntry[];
  /** Estimated tonnes already known per allocation key (never apportioned). */
  estimatedByAllocation?: Map<string, number>;
}): OverviewBlockCard[] {
  const { blocks, estimatedByBlock, actuals, estimatedByAllocation } = args;

  const blank = (): Agg => ({ tonnes: 0, detailed: false, basic: false, pickCount: null });
  const add = (agg: Agg, a: OverviewActualEntry) => {
    agg.tonnes += a.tonnes as number;
    if (a.source === "detailed") {
      agg.detailed = true;
      if (a.pickCount != null) agg.pickCount = (agg.pickCount ?? 0) + a.pickCount;
    } else {
      agg.basic = true;
    }
    return agg;
  };

  interface Bucket {
    byAllocation: Map<string, Agg>;
    /** Variety matched but the planting is ambiguous. */
    byVarietyOnly: Map<string, Agg>;
    /** No variety recorded at all. */
    unassigned: Agg;
  }
  const actualByBlock = new Map<string, Bucket>();
  const allocationVarieties = new Map<string, Map<string, string | null>>();
  for (const b of blocks) {
    const map = new Map<string, string | null>();
    for (const v of b.varieties) if (v.allocationKey) map.set(v.allocationKey, v.name ?? null);
    allocationVarieties.set(key(b.id), map);
  }

  for (const a of actuals) {
    if (!a.blockId || a.tonnes == null || !Number.isFinite(a.tonnes)) continue;
    const bk = key(a.blockId);
    if (!actualByBlock.has(bk)) {
      actualByBlock.set(bk, {
        byAllocation: new Map(),
        byVarietyOnly: new Map(),
        unassigned: blank(),
      });
    }
    const bucket = actualByBlock.get(bk)!;
    const known = allocationVarieties.get(bk);
    if (a.allocationKey && known?.has(a.allocationKey)) {
      bucket.byAllocation.set(
        a.allocationKey,
        add(bucket.byAllocation.get(a.allocationKey) ?? blank(), a),
      );
      continue;
    }
    const vk = key(a.variety);
    if (vk) bucket.byVarietyOnly.set(vk, add(bucket.byVarietyOnly.get(vk) ?? blank(), a));
    else add(bucket.unassigned, a);
  }

  const sourceOf = (parts: Agg[]): ActualSource => {
    const used = parts.filter((p) => p.tonnes !== 0 || p.detailed || p.basic);
    if (!used.length) return null;
    if (used.some((p) => p.detailed)) return "detailed";
    return "basic";
  };
  const countOf = (parts: Agg[]): number | null => {
    const counts = parts.map((p) => p.pickCount).filter((c): c is number => c != null);
    return counts.length ? counts.reduce((a, b) => a + b, 0) : null;
  };

  return blocks.map((b) => {
    const bk = key(b.id);
    const est = estimatedByBlock.get(bk) ?? null;
    const varieties: OverviewBlockVariety[] = b.varieties.length
      ? b.varieties
      : [{ name: null, percent: null }];
    const shares = apportion(est, varieties);
    const bucket = actualByBlock.get(bk);

    // A variety-only actual can still be attributed when the block holds
    // exactly ONE allocation of that variety — that is unambiguous.
    const soleAllocationForVariety = new Map<string, OverviewBlockVariety>();
    const counts = new Map<string, number>();
    for (const v of varieties) counts.set(key(v.name), (counts.get(key(v.name)) ?? 0) + 1);
    for (const v of varieties) if (counts.get(key(v.name)) === 1) soleAllocationForVariety.set(key(v.name), v);

    const usedVarietyOnly = new Set<string>();

    const rows: OverviewVarietyRow[] = varieties.map((v, i) => {
      const parts: Agg[] = [];
      let actual: number | null = null;
      if (bucket) {
        const direct = v.allocationKey ? bucket.byAllocation.get(v.allocationKey) : undefined;
        if (direct) {
          actual = direct.tonnes;
          parts.push(direct);
        }
        const vk = key(v.name);
        if (soleAllocationForVariety.get(vk) === v) {
          const varietyOnly = bucket.byVarietyOnly.get(vk);
          if (varietyOnly) {
            actual = (actual ?? 0) + varietyOnly.tonnes;
            parts.push(varietyOnly);
            usedVarietyOnly.add(vk);
          }
        }
        // An actual recorded without any variety belongs to the block as a
        // whole; only attribute it when the block has a single allocation.
        if (bucket.unassigned.tonnes > 0 && varieties.length === 1) {
          actual = (actual ?? 0) + bucket.unassigned.tonnes;
          parts.push(bucket.unassigned);
        }
      }
      const allocEst =
        v.allocationKey != null ? estimatedByAllocation?.get(v.allocationKey) ?? null : null;
      return {
        variety: v.name,
        allocationKey: v.allocationKey ?? null,
        allocationId: v.allocationId ?? null,
        cloneLabel: v.cloneLabel ?? null,
        rootstockLabel: v.rootstockLabel ?? null,
        percent: v.percent ?? null,
        areaHa: v.areaHa ?? null,
        estimatedTonnes: allocEst ?? shares[i] ?? null,
        actualTonnes: actual,
        actualSource: actual == null ? null : sourceOf(parts),
        actualPickCount: actual == null ? null : countOf(parts),
      };
    });

    // Anything left over stays visible but unallocated — never duplicated.
    const unallocated: OverviewUnallocatedRow[] = [];
    if (bucket) {
      for (const [vk, agg] of bucket.byVarietyOnly) {
        if (usedVarietyOnly.has(vk)) continue;
        if (!agg.tonnes) continue;
        const label = varieties.find((v) => key(v.name) === vk)?.name ?? vk ?? null;
        unallocated.push({
          variety: label,
          actualTonnes: agg.tonnes,
          actualSource: sourceOf([agg]),
          actualPickCount: countOf([agg]),
        });
      }
      if (bucket.unassigned.tonnes > 0 && varieties.length > 1) {
        unallocated.push({
          variety: null,
          actualTonnes: bucket.unassigned.tonnes,
          actualSource: sourceOf([bucket.unassigned]),
          actualPickCount: countOf([bucket.unassigned]),
        });
      }
    }

    const actualValues = rows.map((r) => r.actualTonnes).filter((v): v is number => v != null);
    const unallocatedTotal = unallocated.reduce((a, u) => a + u.actualTonnes, 0);
    let actualTotal: number | null =
      actualValues.length || unallocated.length
        ? actualValues.reduce((a, c) => a + c, 0) + unallocatedTotal
        : null;

    const blockParts: Agg[] = [];
    if (bucket) {
      for (const agg of bucket.byAllocation.values()) blockParts.push(agg);
      for (const agg of bucket.byVarietyOnly.values()) blockParts.push(agg);
      if (bucket.unassigned.tonnes > 0) blockParts.push(bucket.unassigned);
    }

    return {
      blockId: b.id,
      blockName: b.name ?? "Unnamed block",
      areaHa: b.areaHa ?? null,
      varieties: rows,
      unallocated,
      estimatedTonnes: est,
      actualTonnes: actualTotal,
      actualSource: actualTotal == null ? null : sourceOf(blockParts),
      actualPickCount: actualTotal == null ? null : countOf(blockParts),
    };
  });
}
