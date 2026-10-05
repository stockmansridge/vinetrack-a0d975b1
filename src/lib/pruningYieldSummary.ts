// Shared summary helper for the "Block Pruned Yield" tiles.
// Uses the same mobile-parity formula as the calculator — no second maths.
import { calculatePruningYield } from "@/lib/pruningYieldFormula";
import type { PruningYieldSettings } from "@/lib/pruningYieldSettingsQuery";

/**
 * Effective Vines / ha for pruning Yield (iOS/Android/SQL 263 parity).
 * A physical override (block or complete row total) supersedes the saved
 * value as count ÷ area; otherwise the saved value (or, when unset, the
 * block's count ÷ area) is used. The saved value is never modified.
 */
export function effectivePruningVinesPerHa(i: {
  savedVinesPerHa: number | null | undefined;
  physicalVineCount: number | null;
  areaHa: number | null;
  blockVineCount?: number | null;
}): { vinesPerHa: number; source: "physical_override" | "saved" | "derived" | "none" } {
  const area = i.areaHa != null && i.areaHa > 0 ? i.areaHa : null;
  if (i.physicalVineCount != null && i.physicalVineCount > 0 && area) {
    return { vinesPerHa: i.physicalVineCount / area, source: "physical_override" };
  }
  if (i.savedVinesPerHa != null && i.savedVinesPerHa > 0) return { vinesPerHa: i.savedVinesPerHa, source: "saved" };
  if (i.blockVineCount && area) return { vinesPerHa: i.blockVineCount / area, source: "derived" };
  return { vinesPerHa: 0, source: "none" };
}

export interface BlockPrunedYieldTile {
  blockId: string;
  blockName: string;
  hasSettings: boolean;
  tonnesPerHa: number | null;
  totalTonnes: number | null;
}

export function buildBlockPrunedYieldTiles(
  blocks: { id: string; name?: string | null; areaHa?: number | null; vineCount?: number | null; physicalVineCount?: number | null }[],
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
    // Physical override → saved vines_per_ha → block count ÷ area (when unset).
    const vinesPerHa = effectivePruningVinesPerHa({
      savedVinesPerHa: s.vinesPerHa,
      physicalVineCount: b.physicalVineCount ?? null,
      areaHa: b.areaHa ?? null,
      blockVineCount: b.vineCount ?? null,
    }).vinesPerHa;
    const r = calculatePruningYield({
      method: s.pruneMethod,
      bunchesPerBud: s.bunchesPerBud,
      budsPerSpur: s.budsPerSpur,
      spursPerVine: s.spursPerVine,
      budsPerCane: s.budsPerCane,
      canesPerVine: s.canesPerVine,
      vinesPerHa,
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
