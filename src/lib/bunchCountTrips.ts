// Bunch Count Trips — the current Yield Estimate selection rule (sql/187).
//
// A vineyard holds MANY sessions per vintage: at most one active draft plus
// any number of completed trips. Every completed trip is a dated observation
// and is preserved forever.
//
// For each Vintage + Block the CURRENT Yield Estimate is:
//
//   the LATEST COMPLETED session (by completedAt, falling back to createdAt)
//   that has at least one RECORDED sample site in that block.
//
// Sessions are NEVER summed and NEVER averaged. Drafts never participate.
// A newer completed trip supersedes the previous estimate; older completed
// trips remain history.
import {
  summariseYieldSession,
  type SessionBlockInfo,
  type SessionBlockSummary,
  type SessionSummary,
} from "@/lib/yieldSessionSummary";

export interface TripSessionInput {
  id: string;
  payload?: any;
  is_completed?: boolean | null;
  completed_at?: string | null;
  session_created_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BunchCountTrip {
  id: string;
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string | null;
  /** completedAt ?? createdAt — the ordering key from the contract. */
  sortDate: string | null;
  vintage: number | null;
  /** sql/187: whether the displayed estimate includes damage adjustment. */
  applyDamage: boolean;
  /** sql/187: the earlier trip whose route was reused (provenance only). */
  routeSourceSessionId: string | null;
  routeReused: boolean;
  samplesPerHectare: number | null;
  summary: SessionSummary;
  /** Blocks with at least one recorded sample site. */
  sampledBlocks: SessionBlockSummary[];
  blockNames: string[];
  totalEstimatedTonnes: number | null;
  totalBaseTonnes: number | null;
}

export interface BuildTripsOptions {
  blocks?: SessionBlockInfo[];
  damageFactor?: (blockId: string) => number;
  /** Season-end vintage for a trip date (shared VintageResolver semantics). */
  vintageOf: (isoDate: string) => number | null;
}

export function buildBunchCountTrips(
  sessions: TripSessionInput[],
  opts: BuildTripsOptions,
): BunchCountTrip[] {
  const trips = sessions.map((s) => {
    const summary = summariseYieldSession(s.payload, {
      blocks: opts.blocks,
      damageFactor: opts.damageFactor,
    });
    const createdAt = s.session_created_at ?? s.created_at ?? null;
    const completedAt = s.completed_at ?? null;
    const sortDate = completedAt ?? createdAt;
    const sampledBlocks = summary.blocks.filter((b) => b.recordedCount > 0);
    return {
      id: s.id,
      isCompleted: !!s.is_completed,
      completedAt,
      createdAt,
      sortDate,
      vintage: sortDate ? opts.vintageOf(sortDate) : null,
      applyDamage: summary.applyDamage,
      routeSourceSessionId: summary.routeSourceSessionId,
      routeReused: !!summary.routeSourceSessionId,
      samplesPerHectare: summary.samplesPerHectare,
      summary,
      sampledBlocks,
      blockNames: summary.blocks.map((b) => b.blockName ?? "Unnamed block"),
      totalEstimatedTonnes: summary.totalEstTonnes,
      totalBaseTonnes: summary.totalBaseTonnes,
    } satisfies BunchCountTrip;
  });

  // Newest first; ties fall back to the session id so ordering is stable.
  return trips.sort(
    (a, b) => (b.sortDate ?? "").localeCompare(a.sortDate ?? "") || a.id.localeCompare(b.id),
  );
}

export interface CurrentBlockEstimate {
  blockId: string;
  blockName: string | null;
  variety: string | null;
  areaHa: number | null;
  /** The figure to display: adjusted when the trip applies damage, else base. */
  tonnes: number | null;
  /** The recorded observation, never mutated. */
  baseTonnes: number | null;
  /** Base × the live damage factor. */
  adjustedTonnes: number | null;
  damageApplied: boolean;
  damageFactor: number;
  applyDamage: boolean;
  tripId: string;
  tripCompletedAt: string | null;
  recordedSites: number;
}

/**
 * Latest-completed-per-block estimate for one vintage.
 *
 * `vintage === null` means "any vintage" — still latest-wins, never summed.
 */
export function currentEstimatesByBlock(
  trips: BunchCountTrip[],
  vintage: number | null,
): Map<string, CurrentBlockEstimate> {
  const out = new Map<string, CurrentBlockEstimate>();
  // Trips arrive newest-first, so the FIRST completed trip that sampled a
  // block wins and later (older) trips are skipped for that block.
  for (const trip of trips) {
    if (!trip.isCompleted) continue;
    if (vintage != null && trip.vintage !== vintage) continue;
    for (const b of trip.sampledBlocks) {
      if (!b.blockId) continue;
      const key = b.blockId.toLowerCase();
      if (out.has(key)) continue;
      out.set(key, {
        blockId: b.blockId,
        blockName: b.blockName,
        variety: b.variety,
        areaHa: b.areaHa,
        tonnes: b.estimatedYieldTonnes,
        baseTonnes: b.baseEstimatedYieldTonnes,
        adjustedTonnes: b.adjustedEstimatedYieldTonnes,
        damageApplied: b.damageApplied,
        damageFactor: b.damageFactor,
        applyDamage: trip.applyDamage,
        tripId: trip.id,
        tripCompletedAt: trip.completedAt,
        recordedSites: b.recordedCount,
      });
    }
  }
  return out;
}

/** Trip ids that currently provide at least one block's estimate. */
export function currentTripIds(estimates: Map<string, CurrentBlockEstimate>): Set<string> {
  return new Set(Array.from(estimates.values()).map((e) => e.tripId));
}

/** Neutral estimate-vs-actual variance. Null when either side is unknown. */
export interface YieldVariance {
  difference: number;
  percent: number | null;
}

export function yieldVariance(
  estimated: number | null | undefined,
  actual: number | null | undefined,
): YieldVariance | null {
  if (estimated == null || actual == null || !Number.isFinite(estimated) || !Number.isFinite(actual)) {
    return null;
  }
  const difference = actual - estimated;
  return {
    difference,
    percent: estimated !== 0 ? (difference / Math.abs(estimated)) * 100 : null,
  };
}
