// Parser for `yield_estimation_sessions.payload`, matched to the canonical
// iOS document shape (`YieldEstimationSession` in YieldEstimationModels.swift):
//
//   { id, vineyardId, createdAt, selectedPaddockIds: [uuid],
//     samplesPerHectare: int,
//     sampleSites: [{ id, paddockId, paddockName, rowNumber, latitude,
//                     longitude, siteIndex,
//                     bunchCountEntry: { bunchesPerVine, recordedAt, recordedBy } }],
//     blockBunchWeightsKg: { <paddockId>: kg },   // legacy: averageBunchWeightKg (flat)
//     previousBunchWeights: [...], pathWaypoints: [...],
//     isCompleted, completedAt }
//
// Tonnage parity with iOS: totalVines comes from the block record
// (vine_count_override ?? derived from geometry), NOT from the payload.
//   avgBunchesPerVine = mean(recorded sites), rounded to 2 dp
//   totalBunches      = totalVines × avgBunchesPerVine
//   yieldKg           = totalBunches × bunchWeightKg × damageFactor
import { blockEstimate, DEFAULT_BUNCH_WEIGHT_KG } from "@/lib/pruningYieldFormula";

export interface SessionBlockInfo {
  id: string;
  name?: string | null;
  areaHa?: number | null;
  vineCount?: number | null;
}

export interface SessionSite {
  paddockId: string | null;
  rowNumber: number | null;
  siteIndex: number | null;
  bunchesPerVine: number | null;
  lat: number | null;
  lon: number | null;
  recordedAt: string | null;
  recordedBy: string | null;
}

export interface SessionBlockSummary {
  blockId: string | null;
  blockName: string | null;
  variety: string | null;
  areaHa: number | null;
  totalVines: number | null;
  vineCountKnown: boolean;
  bunchWeightKg: number;
  bunchWeightIsDefault: boolean;
  damageFactor: number;
  sites: SessionSite[];
  siteCount: number;
  recordedCount: number;
  totalBunchesSampled: number;
  avgBunchesPerVine: number | null;
  totalBunches: number | null;
  estimatedYieldKg: number | null;
  estimatedYieldTonnes: number | null;
  /** Recorded observation, never mutated by damage (sql/187 §2). */
  baseEstimatedYieldTonnes: number | null;
  /** Base × the LIVE damage factor for the block. */
  adjustedEstimatedYieldTonnes: number | null;
  /** True when the displayed estimate includes the damage adjustment. */
  damageApplied: boolean;
  notes: string | null;
}

export interface SessionSummary {
  season: string | number | null;
  notes: string | null;
  samplesPerHectare: number | null;
  /**
   * sql/187 additive key. Absent on pre-187 sessions → `true`, so historical
   * numbers are unchanged. Display rule: adjusted when true, base when false.
   */
  applyDamage: boolean;
  /** sql/187 additive key: the trip whose route/sample sites were reused. */
  routeSourceSessionId: string | null;
  blocks: SessionBlockSummary[];
  totalAreaHa: number | null;
  totalEstTonnes: number | null;
  /** Undamaged total — always recoverable. */
  totalBaseTonnes: number | null;
  hasAnySamples: boolean;
  missing: { sampleSites: boolean; bunchWeight: boolean; area: boolean; vines: boolean };
}


function pickFirst(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normaliseSite(raw: any, fallbackPaddockId?: string | null): SessionSite {
  const entry = raw?.bunchCountEntry ?? raw?.bunch_count_entry ?? null;
  const bunches =
    num(pickFirst(entry ?? {}, ["bunchesPerVine", "bunches_per_vine"])) ??
    num(pickFirst(raw, ["bunchesPerVine", "bunches_per_vine", "bunchCount", "bunch_count", "bunches", "count"]));
  return {
    paddockId:
      (pickFirst(raw, ["paddockId", "paddock_id", "blockId", "block_id"]) as string | undefined) ??
      fallbackPaddockId ??
      null,
    rowNumber: num(pickFirst(raw, ["rowNumber", "row_number", "row"])),
    siteIndex: num(pickFirst(raw, ["siteIndex", "site_index", "vineNumber", "vine_number", "vine"])),
    bunchesPerVine: bunches,
    lat: num(pickFirst(raw, ["latitude", "lat"])),
    lon: num(pickFirst(raw, ["longitude", "lng", "lon", "long"])),
    recordedAt:
      (pickFirst(entry ?? {}, ["recordedAt", "recorded_at"]) as string | undefined) ??
      (pickFirst(raw, ["recordedAt", "recorded_at", "createdAt", "created_at", "timestamp"]) as
        | string
        | undefined) ??
      null,
    recordedBy:
      (pickFirst(entry ?? {}, ["recordedBy", "recorded_by"]) as string | undefined) ??
      (pickFirst(raw, ["recordedBy", "recorded_by", "operator", "userName", "user_name"]) as
        | string
        | undefined) ??
      null,
  };
}

function bunchWeightMap(p: any): { map: Record<string, number>; flat: number | null } {
  const raw = pickFirst(p, ["blockBunchWeightsKg", "block_bunch_weights_kg"]);
  const map: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = num(v);
      if (n != null && n > 0) map[String(k).toLowerCase()] = n;
    }
  }
  const flat = num(pickFirst(p, ["averageBunchWeightKg", "average_bunch_weight_kg"]));
  return { map, flat };
}

export interface SummariseOptions {
  /** Block records from `paddocks` (area + effective vine count). */
  blocks?: SessionBlockInfo[];
  /** Damage adjustment per block id; defaults to 1.0 (no reduction). */
  damageFactor?: (blockId: string) => number;
}

export function summariseYieldSession(payload: any, opts: SummariseOptions = {}): SessionSummary {
  const p = payload && typeof payload === "object" ? payload : {};
  const season = (pickFirst(p, ["season", "year", "vintage"]) as string | number | undefined) ?? null;
  const notes = (pickFirst(p, ["notes", "note", "comment"]) as string | undefined) ?? null;
  const samplesPerHectare = num(pickFirst(p, ["samplesPerHectare", "samples_per_hectare"]));

  const blockInfo = new Map<string, SessionBlockInfo>();
  for (const b of opts.blocks ?? []) blockInfo.set(String(b.id).toLowerCase(), b);

  const { map: weights, flat: flatWeight } = bunchWeightMap(p);

  // Grouped sites keyed by block id (or a synthetic key when unknown).
  const grouped = new Map<string, { name: string | null; variety: string | null; notes: string | null; sites: SessionSite[] }>();
  const ensure = (key: string, name?: string | null) => {
    const k = key.toLowerCase();
    if (!grouped.has(k)) grouped.set(k, { name: name ?? null, variety: null, notes: null, sites: [] });
    const g = grouped.get(k)!;
    if (!g.name && name) g.name = name;
    return g;
  };

  // Canonical flat shape.
  const flatSites = asArray(pickFirst(p, ["sampleSites", "sample_sites"]));
  for (const raw of flatSites) {
    const site = normaliseSite(raw);
    const key = site.paddockId ?? "unknown";
    const g = ensure(key, pickFirst(raw, ["paddockName", "paddock_name", "blockName", "block_name"]) ?? null);
    g.sites.push(site);
  }

  // Legacy nested shape (sampleSets / blocks with nested sites).
  if (!flatSites.length) {
    const sets = asArray(
      pickFirst(p, ["sampleSets", "sample_sets", "blocks", "blockSamples", "block_samples", "samples"]),
    );
    for (const set of sets) {
      const blockId = (pickFirst(set, ["paddockId", "paddock_id", "blockId", "block_id", "id"]) as string) ?? null;
      const key = blockId ?? "unknown";
      const g = ensure(
        key,
        pickFirst(set, ["paddockName", "paddock_name", "blockName", "block_name", "name", "paddock", "block"]) ?? null,
      );
      g.variety = (pickFirst(set, ["variety", "varietyName", "variety_name"]) as string) ?? g.variety;
      g.notes = (pickFirst(set, ["notes", "note", "comment"]) as string) ?? g.notes;
      const legacyWeight = num(
        pickFirst(set, [
          "avgBunchWeight",
          "averageBunchWeight",
          "bunchWeight",
          "bunch_weight",
          "avg_bunch_weight_kg",
          "avgBunchWeightKg",
        ]),
      );
      if (legacyWeight != null && legacyWeight > 0 && blockId) weights[blockId.toLowerCase()] = legacyWeight;
      for (const raw of asArray(pickFirst(set, ["sites", "sampleSites", "sample_sites", "samples", "vines"]))) {
        g.sites.push(normaliseSite(raw, blockId));
      }
    }
  }

  // Blocks selected but never sampled still belong in the summary.
  for (const id of asArray(pickFirst(p, ["selectedPaddockIds", "selected_paddock_ids"]))) {
    if (typeof id === "string") ensure(id, blockInfo.get(id.toLowerCase())?.name ?? null);
  }

  const blocks: SessionBlockSummary[] = [];
  for (const [key, g] of grouped) {
    const info = blockInfo.get(key);
    const blockId = key === "unknown" ? null : key;
    const recorded = g.sites.filter((s) => s.bunchesPerVine != null);
    const totalBunchesSampled = recorded.reduce((a, s) => a + (s.bunchesPerVine ?? 0), 0);
    const avgRaw = recorded.length ? totalBunchesSampled / recorded.length : null;
    const avg = avgRaw == null ? null : Math.round(avgRaw * 100) / 100;

    const weight = (blockId ? weights[blockId] : undefined) ?? flatWeight ?? DEFAULT_BUNCH_WEIGHT_KG;
    const bunchWeightIsDefault = !(blockId && weights[blockId] != null) && flatWeight == null;

    const totalVines = info?.vineCount ?? null;
    const damageFactor = blockId && opts.damageFactor ? opts.damageFactor(blockId) : 1;

    let est: { totalBunches: number; estimatedYieldKg: number; estimatedYieldTonnes: number } | null = null;
    if (avg != null && totalVines != null && totalVines > 0) {
      est = blockEstimate({
        totalVines,
        averageBunchesPerVine: avg,
        bunchWeightKg: weight,
        damageFactor,
      });
    }

    blocks.push({
      blockId,
      blockName: info?.name ?? g.name ?? null,
      variety: g.variety,
      areaHa: info?.areaHa ?? null,
      totalVines,
      vineCountKnown: totalVines != null && totalVines > 0,
      bunchWeightKg: weight,
      bunchWeightIsDefault,
      damageFactor,
      sites: g.sites,
      siteCount: g.sites.length,
      recordedCount: recorded.length,
      totalBunchesSampled,
      avgBunchesPerVine: avg,
      totalBunches: est?.totalBunches ?? null,
      estimatedYieldKg: est?.estimatedYieldKg ?? null,
      estimatedYieldTonnes: est?.estimatedYieldTonnes ?? null,
      notes: g.notes,
    });
  }

  blocks.sort((a, b) => (a.blockName ?? "").localeCompare(b.blockName ?? ""));

  const areaValues = blocks.map((b) => b.areaHa).filter((v): v is number => v != null);
  const tonnesValues = blocks
    .map((b) => b.estimatedYieldTonnes)
    .filter((v): v is number => v != null);

  return {
    season,
    notes,
    samplesPerHectare,
    blocks,
    totalAreaHa: areaValues.length ? areaValues.reduce((a, b) => a + b, 0) : null,
    totalEstTonnes: tonnesValues.length ? tonnesValues.reduce((a, b) => a + b, 0) : null,
    hasAnySamples: blocks.some((b) => b.recordedCount > 0),
    missing: {
      sampleSites: blocks.every((b) => b.siteCount === 0),
      bunchWeight: blocks.some((b) => b.bunchWeightIsDefault),
      area: blocks.some((b) => b.areaHa == null),
      vines: blocks.some((b) => !b.vineCountKnown),
    },
  };
}
