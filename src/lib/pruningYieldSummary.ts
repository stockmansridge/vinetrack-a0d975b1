// Shared summary helper for the "Block Pruned Yield" tiles.
// Uses the same mobile-parity formula as the calculator — no second maths.
import { calculatePruningYield } from "@/lib/pruningYieldFormula";
import type { PruningYieldSettings } from "@/lib/pruningYieldSettingsQuery";

export interface BlockPrunedYieldTile {
  blockId: string;
  blockName: string;
  hasSettings: boolean;
  tonnesPerHa: number | null;
  totalTonnes: number | null;
}

export function buildBlockPrunedYieldTiles(
  blocks: { id: string; name?: string | null; areaHa?: number | null }[],
  settingsByBlock: Record<string, PruningYieldSettings>,
): BlockPrunedYieldTile[] {
  return blocks.map((b) => {
    const s = settingsByBlock[b.id];
    if (!s) {
      return {
        blockId: b.id,
        blockName: b.name ?? "Unnamed block",
        hasSettings: false,
        tonnesPerHa: null,
        totalTonnes: null,
      };
    }
    const r = calculatePruningYield({
      method: s.pruneMethod,
      bunchesPerBud: s.bunchesPerBud,
      budsPerSpur: s.budsPerSpur,
      spursPerVine: s.spursPerVine,
      budsPerCane: s.budsPerCane,
      canesPerVine: s.canesPerVine,
      vinesPerHa: s.vinesPerHa,
      bunchWeightGrams: s.bunchWeightGrams,
      areaHectares: b.areaHa ?? null,
    });
    return {
      blockId: b.id,
      blockName: b.name ?? "Unnamed block",
      hasSettings: true,
      tonnesPerHa: r.yieldTonnesPerHa,
      totalTonnes: r.totalTonnes,
    };
  });
}
