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
}


const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function factKey(f: { vintage: number | null; blockId: string | null; variety: string | null }) {
  return `${f.vintage ?? ""}|${norm(f.blockId)}|${norm(f.variety)}`;
}

export interface BuildFactsArgs {
  historicalRows: HistoricalBlockRow[];
  pickingTotals: PickingYieldTotal[];
  blocks: AnalyticsBlockInfo[];
  costRows?: AnalyticsCostRow[];
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

  // 3) Resolve whole-block hectares once per vintage × block.
  const blockAreaKey = (r: { vintage: number | null; blockId: string | null }) =>
    `${r.vintage ?? ""}|${norm(r.blockId)}`;
  const blockArea = new Map<string, number | null>();
  const blockTonnes = new Map<string, number>();
  for (const r of raws) {
    const k = blockAreaKey(r);
    const current = blockById.get(norm(r.blockId))?.areaHa ?? null;
    const recorded = r.recordedAreaHa;
    const prev = blockArea.get(k) ?? null;
    const resolved = current && current > 0 ? current : recorded && recorded > 0 ? recorded : prev;
    blockArea.set(k, resolved ?? null);
    blockTonnes.set(k, (blockTonnes.get(k) ?? 0) + r.tonnes);
  }

  // 4) Allocate cost by vintage × block, split across varieties by tonnage.
  const costByBlock = new Map<string, number>();
  for (const c of costRows) {
    if (!c.block_id) continue;
    const k = `${c.vintage_year ?? ""}|${norm(c.block_id)}`;
    costByBlock.set(k, (costByBlock.get(k) ?? 0) + (Number(c.total_cost) || 0));
  }

  return raws.map((r) => {
    const k = blockAreaKey(r);
    const area = blockArea.get(k) ?? null;
    const totalTonnes = blockTonnes.get(k) ?? 0;
    const share = totalTonnes > 0 ? r.tonnes / totalTonnes : 1;
    const cost = costByBlock.has(k) ? (costByBlock.get(k) as number) * share : null;
    return {
      vintage: r.vintage,
      blockId: r.blockId,
      blockName: r.blockName,
      variety: r.variety,
      tonnes: r.tonnes,
      revenue: r.revenue,
      pricedTonnes: r.pricedTonnes,
      areaHa: area != null ? area * share : null,
      blockAreaHa: area,
      cost,
      source: r.source,
      pickCount: r.pickCount,
    } satisfies YieldFact;
  });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface AggMetrics {
  tonnes: number;
  areaHa: number | null;
  revenue: number | null;
  pricedTonnes: number;
  cost: number | null;
  tonnesPerHa: number | null;
  pricePerTonne: number | null;
  revenuePerHa: number | null;
  costPerHa: number | null;
  costPerTonne: number | null;
  margin: number | null;
  marginPerHa: number | null;
  count: number;
}

const div = (a: number | null, b: number | null): number | null =>
  a != null && b != null && b > 0 ? a / b : null;

export function aggregate(facts: YieldFact[]): AggMetrics {
  let tonnes = 0;
  let area = 0;
  let areaSeen = false;
  let revenue = 0;
  let revenueSeen = false;
  let pricedTonnes = 0;
  let cost = 0;
  let costSeen = false;

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
    pricedTonnes += f.pricedTonnes;
    if (f.cost != null) {
      cost += f.cost;
      costSeen = true;
    }
  }

  const areaHa = areaSeen && area > 0 ? area : null;
  const rev = revenueSeen ? revenue : null;
  const cst = costSeen ? cost : null;
  const margin = rev != null && cst != null ? rev - cst : null;

  return {
    tonnes,
    areaHa,
    revenue: rev,
    pricedTonnes,
    cost: cst,
    tonnesPerHa: div(tonnes, areaHa),
    pricePerTonne: pricedTonnes > 0 && rev != null ? rev / pricedTonnes : null,
    revenuePerHa: div(rev, areaHa),
    costPerHa: div(cst, areaHa),
    costPerTonne: cst != null && tonnes > 0 ? cst / tonnes : null,
    margin,
    marginPerHa: div(margin, areaHa),
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
  const window = valid.filter((p) => p.vintage <= currentVintage).slice(0, 3);
  if (window.length < 3) return { current, threeYearAverage: null, difference: null, years: window.length };
  const sum = window.reduce((a, p) => a + (p.value as number), 0);
  const avg = metricIsRate ? sum / window.length : sum / window.length;
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
