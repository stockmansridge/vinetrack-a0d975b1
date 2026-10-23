// Estimated Yield scenario maths for the Vineyard Costings "Estimated Yield" tab.
//
// The DEFAULT tonnes per block come from the canonical seasonal base estimate
// (SQL 221 via buildSeasonYieldEstimates) — the Portal never re-derives them.
// Users may type their own tonnes per block to run a cost-per-tonne scenario;
// overrides live only in memory (nothing is written back), and clearing them
// returns every block to the estimate.
//
// Costs come from the same filtered Cost Reports groups the other tabs use, so
// the scenario always reconciles with the rest of the page. Unknown is never
// zero: a block without an estimate shows "—" until the user enters tonnes.
import {
  splitBlockEstimateToGroups,
  type SeasonYieldBlockEstimate,
} from "@/lib/seasonYieldContract";

export interface BlockScenarioRow {
  paddockId: string;
  blockName: string;
  areaHa: number | null;
  /** Canonical seasonal estimate — the default and reset value. */
  estimateTonnes: number | null;
  /** Effective tonnes used for the scenario (override ?? estimate). */
  tonnes: number | null;
  isOverridden: boolean;
  totalCost: number | null;
  costPerTonne: number | null;
  warnings: string[];
}

export interface VarietyScenarioRow {
  varietyKey: string;
  varietyName: string;
  /** Null while any contributing planting has no tonnes. */
  tonnes: number | null;
  /** Sum of the plantings that DO have tonnes. */
  knownTonnes: number;
  totalCost: number | null;
  costPerTonne: number | null;
}

export interface ScenarioTotals {
  totalCost: number;
  /** Sum of blocks with a known tonnes value. */
  totalTonnes: number;
  blocksWithTonnes: number;
  blocksTotal: number;
  costPerTonne: number | null;
}

const divide = (cost: number | null, tonnes: number | null): number | null =>
  cost != null && tonnes != null && tonnes > 0 ? cost / tonnes : null;

/** Effective scenario tonnes for one block: a valid override wins, else the estimate. */
export function effectiveBlockTonnes(
  block: Pick<SeasonYieldBlockEstimate, "paddockId" | "tonnes">,
  overrides: ReadonlyMap<string, number>,
): { tonnes: number | null; isOverridden: boolean } {
  const o = overrides.get(block.paddockId);
  if (o != null && Number.isFinite(o) && o >= 0) {
    return { tonnes: o, isOverridden: true };
  }
  return { tonnes: block.tonnes, isOverridden: false };
}

export function buildBlockScenarioRows(
  blocks: SeasonYieldBlockEstimate[],
  costByBlockId: ReadonlyMap<string, number>,
  overrides: ReadonlyMap<string, number>,
): BlockScenarioRow[] {
  return blocks.map((b) => {
    const { tonnes, isOverridden } = effectiveBlockTonnes(b, overrides);
    const totalCost = costByBlockId.get(b.paddockId) ?? null;
    return {
      paddockId: b.paddockId,
      blockName: b.blockName ?? "Block",
      areaHa: b.areaHa,
      estimateTonnes: b.tonnes,
      tonnes,
      isOverridden,
      totalCost,
      costPerTonne: divide(totalCost, tonnes),
      warnings: b.warnings,
    };
  });
}

/**
 * Aggregate the scenario to varieties. Edited block tonnes flow through the
 * canonical splitBlockEstimateToGroups so variety rows always reconcile to the
 * block rows. A variety is incomplete while any contributing planting lacks
 * tonnes — it then reports knownTonnes and a null costPerTonne.
 */
export function buildVarietyScenarioRows(
  blocks: SeasonYieldBlockEstimate[],
  costByVariety: ReadonlyMap<string, number>,
  overrides: ReadonlyMap<string, number>,
): VarietyScenarioRow[] {
  const map = new Map<string, VarietyScenarioRow & { complete: boolean }>();
  for (const b of blocks) {
    const { tonnes } = effectiveBlockTonnes(b, overrides);
    const shares = splitBlockEstimateToGroups(b, tonnes);
    b.groups.forEach((g, i) => {
      const key = (g.varietyKey ?? g.varietyName ?? "").trim().toLowerCase();
      if (!key) return;
      let row = map.get(key);
      if (!row) {
        row = {
          varietyKey: key,
          varietyName: g.varietyName ?? key,
          tonnes: 0,
          knownTonnes: 0,
          totalCost: costByVariety.get(key) ?? null,
          costPerTonne: null,
          complete: true,
        };
        map.set(key, row);
      }
      const share = shares[i] ?? null;
      if (share != null) {
        row.knownTonnes += share;
      } else {
        row.complete = false;
      }
      if (!row.varietyName && g.varietyName) row.varietyName = g.varietyName;
    });
  }
  return Array.from(map.values())
    .map((r) => {
      const tonnes = r.complete ? r.knownTonnes : null;
      return {
        varietyKey: r.varietyKey,
        varietyName: r.varietyName,
        tonnes,
        knownTonnes: r.knownTonnes,
        totalCost: r.totalCost,
        costPerTonne: divide(r.totalCost, tonnes),
      };
    })
    .sort((a, b) => a.varietyName.localeCompare(b.varietyName));
}

export function scenarioTotals(rows: BlockScenarioRow[]): ScenarioTotals {
  let totalCost = 0;
  let totalTonnes = 0;
  let blocksWithTonnes = 0;
  for (const r of rows) {
    totalCost += r.totalCost ?? 0;
    if (r.tonnes != null) {
      totalTonnes += r.tonnes;
      blocksWithTonnes += 1;
    }
  }
  return {
    totalCost,
    totalTonnes,
    blocksWithTonnes,
    blocksTotal: rows.length,
    costPerTonne: totalTonnes > 0 ? totalCost / totalTonnes : null,
  };
}
