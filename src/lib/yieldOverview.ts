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
}

export interface OverviewVarietyRow {
  variety: string | null;
  estimatedTonnes: number | null;
  actualTonnes: number | null;
}

export interface OverviewBlockCard {
  blockId: string;
  blockName: string;
  areaHa: number | null;
  varieties: OverviewVarietyRow[];
  estimatedTonnes: number | null;
  actualTonnes: number | null;
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
  const actualByBlock = new Map<string, { byVariety: Map<string, number>; unassigned: number }>();
  for (const a of actuals) {
    if (!a.blockId || a.tonnes == null || !Number.isFinite(a.tonnes)) continue;
    const bk = key(a.blockId);
    if (!actualByBlock.has(bk)) actualByBlock.set(bk, { byVariety: new Map(), unassigned: 0 });
    const bucket = actualByBlock.get(bk)!;
    const vk = key(a.variety);
    if (vk) bucket.byVariety.set(vk, (bucket.byVariety.get(vk) ?? 0) + a.tonnes);
    else bucket.unassigned += a.tonnes;
  }

  return blocks.map((b) => {
    const bk = key(b.id);
    const est = estimatedByBlock.get(bk) ?? null;
    const varieties = b.varieties.length ? b.varieties : [{ name: null, percent: null }];
    const shares = apportion(est, varieties);
    const bucket = actualByBlock.get(bk);

    const rows: OverviewVarietyRow[] = varieties.map((v, i) => {
      let actual: number | null = null;
      if (bucket) {
        const direct = bucket.byVariety.get(key(v.name));
        if (direct != null) actual = direct;
        // An actual recorded without a variety belongs to the block as a whole;
        // only attribute it when the block has a single configured variety.
        if (bucket.unassigned > 0 && varieties.length === 1) {
          actual = (actual ?? 0) + bucket.unassigned;
        }
      }
      return { variety: v.name, estimatedTonnes: shares[i] ?? null, actualTonnes: actual };
    });

    const actualValues = rows.map((r) => r.actualTonnes).filter((v): v is number => v != null);
    let actualTotal = actualValues.length ? actualValues.reduce((a, c) => a + c, 0) : null;
    if (bucket && bucket.unassigned > 0 && varieties.length > 1) {
      actualTotal = (actualTotal ?? 0) + bucket.unassigned;
    }

    return {
      blockId: b.id,
      blockName: b.name ?? "Unnamed block",
      areaHa: b.areaHa ?? null,
      varieties: rows,
      estimatedTonnes: est,
      actualTonnes: actualTotal,
    };
  });
}
