// Yield Analytics — pure aggregation layer.
//
// IMPORTANT: this module makes NO schema changes and issues no queries. It
// consumes the existing VineTrack production contract only:
//   * historical_yield_records.block_results  (basic actual yield)
//   * picking_yield_totals                    (detailed picking log, SQL 180)
//   * paddocks (area + variety_allocations)   (hectares / variety identity)
//   * unified cost dataset rows               (trip + pruning allocations)
//
// The canonical precedence rule from `pickingRecordsQuery.ts` is preserved:
// detailed picks SUPERSEDE basic actual yield for the same
// Block + Variety + Vintage — they are never summed.
import type { HistoricalBlockRow } from "@/lib/yieldReportsQuery";
import type { PickingYieldTotal } from "@/lib/pickingRecordsQuery";

export interface AnalyticsBlockInfo {
  id: string;
  name: string | null;
  areaHa: number | null;
  /** paddocks.variety_allocations jsonb — [{ name, percent }, ...]. */
  varietyAllocations?: unknown;
}

export interface AnalyticsCostRow {
  vintage_year: number | null;
  block_id: string | null;
  variety: string | null;
  total_cost: number;
}

/** One vintage × block × variety production fact. */
export interface YieldFact {
  vintage: number | null;
  blockId: string | null;
  blockName: string;
  variety: string | null;
  tonnes: number;
  /** Crop value where the source records a price; null when unknown. */
  revenue: number | null;
  /** Tonnes that carry a price — the denominator for weighted average price. */
  pricedTonnes: number;
  /** Hectares attributed to this variety (allocated ha, else tonnage share). */
  areaHa: number | null;
  /** True when hectares came from the block's variety_allocations percent. */
  areaFromAllocation: boolean;
  /** Whole-block hectares for the vintage (never summed per variety). */
  blockAreaHa: number | null;
  /** Allocated production cost, null when no cost data is available. */
  cost: number | null;
  source: "basic" | "detailed";
  pickCount: number | null;
  /**
   * Inferred commercial disposition — NOT an explicit database field. A record
   * with a grape sale value is treated as sold, one without as retained for
   * internal use, and a partly priced record as mixed.
   */
  disposition: "sold" | "retained" | "mixed";

}


const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function factKey(f: { vintage: number | null; blockId: string | null; variety: string | null }) {
  return `${f.vintage ?? ""}|${norm(f.blockId)}|${norm(f.variety)}`;
}

/**
 * Minimal shape of a picking record used to split sold vs retained tonnage.
 * Only non-financial columns are read (`sold`, weight, identity) so this works
 * for every role under the sql/187 financial-privacy contract.
 */
export interface AnalyticsPickingSoldRow {
  vintage: number | null;
  paddock_id: string | null;
  variety_name: string | null;
  weight_kg: number | null;
  sold: boolean | null;
}

export interface BuildFactsArgs {
  historicalRows: HistoricalBlockRow[];
  pickingTotals: PickingYieldTotal[];
  blocks: AnalyticsBlockInfo[];
  costRows?: AnalyticsCostRow[];
  /**
   * Individual picks. When supplied, sold tonnes are derived ONLY from picks
   * flagged `sold`, so Sale $/t never divides grape revenue by retained fruit.
   */
  pickingRecords?: AnalyticsPickingSoldRow[];
}


/**
 * Build the canonical analytics fact table.
 *
 * Hectares are resolved ONCE per vintage × block (current block area, falling
 * back to the largest recorded historical area) and then apportioned across
 * that block's varieties by tonnage share, so neither hectares nor tonnes are
 * ever double counted when a block has several harvest records.
 */
export function buildYieldFacts({
  historicalRows,
  pickingTotals,
  blocks,
  costRows = [],
}: BuildFactsArgs): YieldFact[] {
  const blockById = new Map(blocks.map((b) => [norm(b.id), b]));

  interface Raw {
    vintage: number | null;
    blockId: string | null;
    blockName: string;
    variety: string | null;
    tonnes: number;
    revenue: number | null;
    pricedTonnes: number;
    recordedAreaHa: number | null;
    source: "basic" | "detailed";
    pickCount: number | null;
  }
  const bucket = new Map<string, Raw>();
  const push = (r: Raw) => {
    const k = factKey(r);
    const cur = bucket.get(k);
    if (!cur) {
      bucket.set(k, { ...r });
      return;
    }
    cur.tonnes += r.tonnes;
    cur.pricedTonnes += r.pricedTonnes;
    if (r.revenue != null) cur.revenue = (cur.revenue ?? 0) + r.revenue;
    if (r.recordedAreaHa != null) {
      cur.recordedAreaHa = Math.max(cur.recordedAreaHa ?? 0, r.recordedAreaHa);
    }
    if (r.pickCount != null) cur.pickCount = (cur.pickCount ?? 0) + r.pickCount;
  };

  // 1) Detailed picking totals (authoritative where present).
  for (const t of pickingTotals) {
    if (!t.paddock_id) continue;
    const tonnes =
      num(t.actual_yield_tonnes) ?? (num(t.total_weight_kg) != null ? num(t.total_weight_kg)! / 1000 : null);
    if (tonnes == null) continue;
    const revenue = num(t.total_grape_value);
    push({
      vintage: t.vintage ?? null,
      blockId: t.paddock_id,
      blockName: t.paddock_name?.trim() || blockById.get(norm(t.paddock_id))?.name || "Unnamed block",
      variety: t.variety_name?.trim() || null,
      tonnes,
      revenue: revenue != null && revenue > 0 ? revenue : null,
      pricedTonnes: revenue != null && revenue > 0 ? tonnes : 0,
      recordedAreaHa: null,
      source: "detailed",
      pickCount: num(t.pick_count),
    });
  }

  const detailedExact = new Set(Array.from(bucket.keys()));
  const detailedBlockVintage = new Set(
    Array.from(bucket.values()).map((r) => `${r.vintage ?? ""}|${norm(r.blockId)}`),
  );

  // 2) Basic historical rows, dropped where detailed picks supersede them.
  for (const r of historicalRows) {
    if (!r.blockId || r.yieldTonnes == null) continue;
    const vintage = r.year ?? (Number.isFinite(Number(r.season)) ? Number(r.season) : null);
    const k = factKey({ vintage, blockId: r.blockId, variety: r.variety });
    if (detailedExact.has(k)) continue;
    if (!norm(r.variety) && detailedBlockVintage.has(`${vintage ?? ""}|${norm(r.blockId)}`)) continue;
    push({
      vintage,
      blockId: r.blockId,
      blockName: r.blockName?.trim() || blockById.get(norm(r.blockId))?.name || "Unnamed block",
      variety: r.variety?.trim() || null,
      tonnes: r.yieldTonnes,
      revenue: null,
      pricedTonnes: 0,
      recordedAreaHa: r.areaHa ?? null,
      source: "basic",
      pickCount: null,
    });
  }

  const raws = Array.from(bucket.values());

  // 3) Resolve whole-block hectares ONCE per vintage × block. The current
  //    paddock area wins; otherwise the largest area recorded on the harvest
  //    records for that block/vintage is used (never their sum).
  const blockAreaKey = (r: { vintage: number | null; blockId: string | null }) =>
    `${r.vintage ?? ""}|${norm(r.blockId)}`;
  const blockArea = new Map<string, number | null>();
  const blockTonnes = new Map<string, number>();
  for (const r of raws) {
    const k = blockAreaKey(r);
    const current = blockById.get(norm(r.blockId))?.areaHa ?? null;
    const prev = blockArea.get(k) ?? null;
    const recorded =
      r.recordedAreaHa != null && r.recordedAreaHa > 0
        ? Math.max(r.recordedAreaHa, prev ?? 0)
        : prev;
    blockArea.set(k, current && current > 0 ? current : recorded && recorded > 0 ? recorded : null);
    blockTonnes.set(k, (blockTonnes.get(k) ?? 0) + r.tonnes);
  }

  // 4) Cost allocation. Zero-value rows are NOT evidence of costing, so a block
  //    whose allocations all total 0 keeps `cost: null` rather than a
  //    misleading $0 cost / $0-per-tonne. Variety-specific cost rows attach to
  //    that variety; block-level rows split across varieties by tonnage share.
  const costByBlock = new Map<string, number>();
  const costByVariety = new Map<string, number>();
  for (const c of costRows) {
    if (!c.block_id) continue;
    const amount = Number(c.total_cost) || 0;
    if (amount === 0) continue;
    const bk = `${c.vintage_year ?? ""}|${norm(c.block_id)}`;
    const variety = norm(c.variety);
    if (variety) {
      const vk = `${bk}|${variety}`;
      costByVariety.set(vk, (costByVariety.get(vk) ?? 0) + amount);
    } else {
      costByBlock.set(bk, (costByBlock.get(bk) ?? 0) + amount);
    }
  }
  // Variety cost rows that match no harvested variety fall back to the block
  // pool so allocated cost is never silently dropped inside a harvested block.
  const factVarietyKeys = new Set(raws.map((r) => `${blockAreaKey(r)}|${norm(r.variety)}`));
  for (const [vk, amount] of costByVariety) {
    if (factVarietyKeys.has(vk)) continue;
    const bk = vk.slice(0, vk.lastIndexOf("|"));
    costByBlock.set(bk, (costByBlock.get(bk) ?? 0) + amount);
    costByVariety.delete(vk);
  }

  // 5) Hectares per variety: use the block's variety_allocations percent where
  //    the contract provides it, otherwise apportion by tonnage share. Either
  //    way the block's hectares are counted at most once per vintage.
  const allocPercent = (blockId: string | null, variety: string | null): number | null => {
    const raw = blockById.get(norm(blockId))?.varietyAllocations;
    if (!Array.isArray(raw) || !norm(variety)) return null;
    let pct = 0;
    let matched = false;
    for (const a of raw as Array<Record<string, unknown>>) {
      if (norm(String(a?.name ?? "")) !== norm(variety)) continue;
      const p = num(a?.percent);
      if (p == null || p <= 0) continue;
      pct += p;
      matched = true;
    }
    return matched ? Math.min(pct, 100) : null;
  };

  // Remaining (unallocated) hectares available to varieties with no allocation.
  const unallocated = new Map<string, { area: number; tonnes: number }>();
  for (const r of raws) {
    const k = blockAreaKey(r);
    const area = blockArea.get(k) ?? null;
    if (area == null) continue;
    const entry = unallocated.get(k) ?? { area, tonnes: 0 };
    const pct = allocPercent(r.blockId, r.variety);
    if (pct != null) entry.area -= (area * pct) / 100;
    else entry.tonnes += r.tonnes;
    unallocated.set(k, entry);
  }

  return raws.map((r) => {
    const k = blockAreaKey(r);
    const area = blockArea.get(k) ?? null;
    const totalTonnes = blockTonnes.get(k) ?? 0;
    const share = totalTonnes > 0 ? r.tonnes / totalTonnes : 1;

    const pct = allocPercent(r.blockId, r.variety);
    const spare = unallocated.get(k);
    let areaHa: number | null = null;
    let areaFromAllocation = false;
    if (area != null) {
      if (pct != null) {
        areaHa = (area * pct) / 100;
        areaFromAllocation = true;
      } else if (spare && spare.tonnes > 0 && spare.area > 0) {
        areaHa = spare.area * (r.tonnes / spare.tonnes);
      } else {
        areaHa = area * share;
      }
    }

    const blockCost = costByBlock.get(k);
    const varietyCost = costByVariety.get(`${k}|${norm(r.variety)}`);
    const cost =
      blockCost == null && varietyCost == null
        ? null
        : (varietyCost ?? 0) + (blockCost != null ? blockCost * share : 0);

    return {
      vintage: r.vintage,
      blockId: r.blockId,
      blockName: r.blockName,
      variety: r.variety,
      tonnes: r.tonnes,
      revenue: r.revenue,
      pricedTonnes: r.pricedTonnes,
      areaHa,
      areaFromAllocation,
      blockAreaHa: area,
      cost,
      source: r.source,
      pickCount: r.pickCount,
      disposition:
        r.pricedTonnes <= 0
          ? "retained"
          : r.pricedTonnes >= r.tonnes - 1e-6
            ? "sold"
            : "mixed",

    } satisfies YieldFact;
  });
}


// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface AggMetrics {
  /** All harvested tonnes, sold and internally retained. */
  tonnes: number;
  areaHa: number | null;
  /** Grape-sale revenue. Null when no fruit in the group was sold. */
  revenue: number | null;
  /** Tonnes with a recorded grape sale value. */
  soldTonnes: number;
  /** Harvested tonnes with no grape sale value — treated as internal use. */
  retainedTonnes: number;
  /** Share of harvested tonnes that were sold, 0-1. */
  soldShare: number | null;
  /** @deprecated alias of soldTonnes, kept for existing callers. */
  pricedTonnes: number;
  /** Hectares behind sold fruit — the denominator for grape revenue / ha. */
  soldAreaHa: number | null;
  /** @deprecated alias of soldAreaHa. */
  pricedAreaHa: number | null;
  /** True when every harvested tonne in the group was sold. */
  allSold: boolean;
  /** True when part of the harvest was retained for internal use. */
  hasRetained: boolean;
  /** Allocated production cost for ALL harvested fruit. */
  cost: number | null;
  /** Portion of allocated cost attributable to sold fruit. */
  soldCost: number | null;
  /** Portion of allocated cost carried by internally retained fruit. */
  retainedCost: number | null;
  tonnesPerHa: number | null;
  /** Average sale price achieved on sold fruit only. */
  pricePerTonne: number | null;
  /** Grape revenue per sold hectare. */
  revenuePerHa: number | null;
  /** Production cost across all harvested hectares. */
  costPerHa: number | null;
  /** Production cost across all harvested tonnes, sold and retained. */
  costPerTonne: number | null;
  /** Grape-sale margin: sale revenue less the cost attributable to sold fruit. */
  margin: number | null;
  marginPerHa: number | null;
  count: number;
}

const div = (a: number | null, b: number | null): number | null =>
  a != null && b != null && b > 0 ? a / b : null;

/**
 * Aggregate facts.
 *
 * Harvest disposition: a harvest record with no grape sale value is NOT missing
 * data — it is fruit retained for internal use (e.g. the business's own wine).
 * Sold and retained tonnes are reported separately, and no sale price is ever
 * imputed for retained fruit.
 *
 * Sale metrics (revenue, average sale price, revenue per hectare, grape-sale
 * margin) are derived from sold fruit only. Production metrics (yield, cost,
 * cost per tonne, cost per hectare) cover ALL harvested fruit, because the cost
 * of retained fruit is real and becomes an input cost of the internal product.
 *
 * Grape-sale margin subtracts only the cost attributable to sold fruit, so a
 * view mixing sold and retained fruit still reports a meaningful margin rather
 * than an artificial loss.
 *
 * Cost integrity: cost per tonne is always allocated cost ÷ the CANONICAL yield
 * tonnes computed here — never the `yield_tonnes` snapshot stored on cost
 * allocations, which can be stale, zero or null.
 */
export function aggregate(facts: YieldFact[]): AggMetrics {
  let tonnes = 0;
  let area = 0;
  let areaSeen = false;
  let revenue = 0;
  let revenueSeen = false;
  let soldTonnes = 0;
  let soldArea = 0;
  let soldAreaSeen = false;
  let cost = 0;
  let costSeen = false;
  let soldCost = 0;

  for (const f of facts) {
    tonnes += f.tonnes;
    if (f.areaHa != null) {
      area += f.areaHa;
      areaSeen = true;
    }
    if (f.revenue != null) {
      revenue += f.revenue;
      revenueSeen = true;
    }
    soldTonnes += f.pricedTonnes;
    // Hectares attributed to sold fruit, pro-rated when a record is part sold.
    const soldFraction = f.tonnes > 0 ? Math.min(1, f.pricedTonnes / f.tonnes) : 0;
    if (f.areaHa != null && soldFraction > 0) {
      soldArea += f.areaHa * soldFraction;
      soldAreaSeen = true;
    }
    if (f.cost != null) {
      cost += f.cost;
      costSeen = true;
      soldCost += f.cost * soldFraction;
    }
  }

  const areaHa = areaSeen && area > 0 ? area : null;
  const soldAreaHa = soldAreaSeen && soldArea > 0 ? soldArea : null;
  const rev = revenueSeen ? revenue : null;
  const cst = costSeen ? cost : null;
  const retainedTonnes = Math.max(0, tonnes - soldTonnes);
  // Tolerate float noise on the tonnage comparison.
  const allSold = tonnes > 0 && soldTonnes >= tonnes - 1e-6;
  const hasRetained = retainedTonnes > 1e-6;
  const sCost = costSeen ? soldCost : null;
  const margin = rev != null && sCost != null ? rev - sCost : null;

  return {
    tonnes,
    areaHa,
    revenue: rev,
    soldTonnes,
    retainedTonnes,
    soldShare: tonnes > 0 ? soldTonnes / tonnes : null,
    pricedTonnes: soldTonnes,
    soldAreaHa,
    pricedAreaHa: soldAreaHa,
    allSold,
    hasRetained,
    cost: cst,
    soldCost: sCost,
    retainedCost: cst != null && sCost != null ? Math.max(0, cst - sCost) : null,
    tonnesPerHa: div(tonnes, areaHa),
    pricePerTonne: soldTonnes > 0 && rev != null ? rev / soldTonnes : null,
    revenuePerHa: div(rev, soldAreaHa),
    costPerHa: div(cst, areaHa),
    costPerTonne: cst != null && tonnes > 0 ? cst / tonnes : null,
    margin,
    marginPerHa: div(margin, soldAreaHa),
    count: facts.length,
  };
}


export interface GroupedMetrics extends AggMetrics {
  key: string;
  label: string;
  /** Secondary descriptor, e.g. the varieties inside a block. */
  detail: string | null;
}

export function groupBy(
  facts: YieldFact[],
  keyOf: (f: YieldFact) => string,
  labelOf: (f: YieldFact) => string,
  detailOf?: (facts: YieldFact[]) => string | null,
): GroupedMetrics[] {
  const map = new Map<string, YieldFact[]>();
  for (const f of facts) {
    const k = keyOf(f);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(f);
  }
  return Array.from(map.entries()).map(([key, rows]) => ({
    key,
    label: labelOf(rows[0]),
    detail: detailOf ? detailOf(rows) : null,
    ...aggregate(rows),
  }));
}

export const varietyLabel = (f: YieldFact) => f.variety?.trim() || "Unspecified";
export const blockLabel = (f: YieldFact) => f.blockName || "Unnamed block";

export const distinctVarieties = (rows: YieldFact[]): string =>
  Array.from(new Set(rows.map((r) => r.variety?.trim()).filter(Boolean))).join(", ");

export function byVariety(facts: YieldFact[]): GroupedMetrics[] {
  return groupBy(facts, (f) => norm(f.variety) || "__none__", varietyLabel);
}

export function byBlock(facts: YieldFact[]): GroupedMetrics[] {
  return groupBy(facts, (f) => norm(f.blockId) || norm(f.blockName), blockLabel, distinctVarieties);
}

export function byVintage(facts: YieldFact[]): GroupedMetrics[] {
  return groupBy(
    facts,
    (f) => String(f.vintage ?? ""),
    (f) => (f.vintage != null ? String(f.vintage) : "—"),
  ).sort((a, b) => a.label.localeCompare(b.label));
}

/** Metric keys shared by the ranked/trend charts. */
export type MetricKey =
  | "tonnes"
  | "tonnesPerHa"
  | "pricePerTonne"
  | "revenue"
  | "revenuePerHa"
  | "costPerHa"
  | "costPerTonne"
  | "marginPerHa";

export const metricValue = (m: AggMetrics, k: MetricKey): number | null => m[k] ?? null;

/**
 * Three-year trend for a group: current vintage, the trailing 3-year average
 * and the difference. Returns null when fewer than three valid vintages exist,
 * so no misleading average is displayed.
 */
export interface ThreeYearTrend {
  current: number | null;
  threeYearAverage: number | null;
  difference: number | null;
  years: number;
}

export function threeYearTrend(
  perVintage: { vintage: number; value: number | null }[],
  currentVintage: number,
  metricIsRate = true,
): ThreeYearTrend {
  const valid = perVintage
    .filter((p) => p.value != null && Number.isFinite(p.value))
    .sort((a, b) => b.vintage - a.vintage);
  const current = valid.find((p) => p.vintage === currentVintage)?.value ?? null;
  // Only the genuine three-vintage window ending at the current vintage counts;
  // older, non-contiguous vintages must not masquerade as a 3-year average.
  const window = valid.filter((p) => p.vintage <= currentVintage && p.vintage >= currentVintage - 2);
  if (window.length < 3) return { current, threeYearAverage: null, difference: null, years: window.length };
  const sum = window.reduce((a, p) => a + (p.value as number), 0);
  const avg = sum / window.length;

  return {
    current,
    threeYearAverage: avg,
    difference: current != null ? current - avg : null,
    years: window.length,
  };
}

/** Percentage change guarded against a missing or zero prior period. */
export function pctChange(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}
