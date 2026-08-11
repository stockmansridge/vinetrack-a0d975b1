// Quick View / Overview model for the Yields page.
//
// Deliberately dumb: it does NOT calculate estimates. Estimated tonnes come
// from `summariseYieldSession()` (the single shared Yield calculation) and are
// apportioned across a block's configured varieties using the canonical
// `variety_allocations` percentages. Actual tonnes come from the existing
// `historical_yield_records.block_results` entries.

export interface OverviewBlockVariety {
  name: string | null;
  percent: number | null;
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
  /** Which system produced the total — detailed picks supersede basic. */
  source?: "basic" | "detailed";
  /** Number of picking records behind a detailed total. */
  pickCount?: number | null;
}

export type ActualSource = "basic" | "detailed" | null;

export interface OverviewVarietyRow {
  variety: string | null;
  estimatedTonnes: number | null;
  actualTonnes: number | null;
  actualSource: ActualSource;
  actualPickCount: number | null;
}

export interface OverviewBlockCard {
  blockId: string;
  blockName: string;
  areaHa: number | null;
  varieties: OverviewVarietyRow[];
  estimatedTonnes: number | null;
  actualTonnes: number | null;
  actualSource: ActualSource;
  actualPickCount: number | null;
}

const key = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Split a block total across varieties by allocation percent (equal when unset). */
function apportion(total: number | null, varieties: OverviewBlockVariety[]): (number | null)[] {
  if (total == null) return varieties.map(() => null);
  if (!varieties.length) return [];
  const percents = varieties.map((v) => (typeof v.percent === "number" && v.percent > 0 ? v.percent : 0));
  const sum = percents.reduce((a, b) => a + b, 0);
  if (sum <= 0) return varieties.map(() => total / varieties.length);
  return percents.map((p) => (total * p) / sum);
}

export function buildYieldOverview(args: {
  blocks: OverviewBlockInput[];
  /** Estimated tonnes per block id (from summariseYieldSession). */
  estimatedByBlock: Map<string, number>;
  /** Actual yield entries extracted from historical block_results. */
  actuals: OverviewActualEntry[];
}): OverviewBlockCard[] {
  const { blocks, estimatedByBlock, actuals } = args;

  // block id → variety name → tonnes (null variety collected separately).
  interface Agg {
    tonnes: number;
    detailed: boolean;
    basic: boolean;
    pickCount: number | null;
  }
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
  const actualByBlock = new Map<string, { byVariety: Map<string, Agg>; unassigned: Agg }>();
  for (const a of actuals) {
    if (!a.blockId || a.tonnes == null || !Number.isFinite(a.tonnes)) continue;
    const bk = key(a.blockId);
    if (!actualByBlock.has(bk)) actualByBlock.set(bk, { byVariety: new Map(), unassigned: blank() });
    const bucket = actualByBlock.get(bk)!;
    const vk = key(a.variety);
    if (vk) bucket.byVariety.set(vk, add(bucket.byVariety.get(vk) ?? blank(), a));
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
    const varieties = b.varieties.length ? b.varieties : [{ name: null, percent: null }];
    const shares = apportion(est, varieties);
    const bucket = actualByBlock.get(bk);

    const rows: OverviewVarietyRow[] = varieties.map((v, i) => {
      let actual: number | null = null;
      const parts: Agg[] = [];
      if (bucket) {
        const direct = bucket.byVariety.get(key(v.name));
        if (direct != null) {
          actual = direct.tonnes;
          parts.push(direct);
        }
        // An actual recorded without a variety belongs to the block as a whole;
        // only attribute it when the block has a single configured variety.
        if (bucket.unassigned.tonnes > 0 && varieties.length === 1) {
          actual = (actual ?? 0) + bucket.unassigned.tonnes;
          parts.push(bucket.unassigned);
        }
      }
      return {
        variety: v.name,
        estimatedTonnes: shares[i] ?? null,
        actualTonnes: actual,
        actualSource: actual == null ? null : sourceOf(parts),
        actualPickCount: actual == null ? null : countOf(parts),
      };
    });

    const actualValues = rows.map((r) => r.actualTonnes).filter((v): v is number => v != null);
    let actualTotal = actualValues.length ? actualValues.reduce((a, c) => a + c, 0) : null;
    const blockParts: Agg[] = [];
    if (bucket) {
      for (const v of varieties) {
        const direct = bucket.byVariety.get(key(v.name));
        if (direct) blockParts.push(direct);
      }
      if (bucket.unassigned.tonnes > 0) blockParts.push(bucket.unassigned);
    }
    if (bucket && bucket.unassigned.tonnes > 0 && varieties.length > 1) {
      actualTotal = (actualTotal ?? 0) + bucket.unassigned.tonnes;
    }

    return {
      blockId: b.id,
      blockName: b.name ?? "Unnamed block",
      areaHa: b.areaHa ?? null,
      varieties: rows,
      estimatedTonnes: est,
      actualTonnes: actualTotal,
      actualSource: actualTotal == null ? null : sourceOf(blockParts),
      actualPickCount: actualTotal == null ? null : countOf(blockParts),
    };
  });
}
