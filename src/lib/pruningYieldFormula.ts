// Pruning / yield determination maths — direct port of the iOS
// `YieldDeterminationFormula` enum (ios/VineTrack/.../YieldDeterminationFormula.swift).
// Pure functions only: no IO, no persistence, no schema changes.

export type PruneMethod = "spur" | "cane";

/** Buds per vine, derived from prune method.
 *  Spur: budsPerSpur × spursPerVine — Cane: budsPerCane × canesPerVine. */
export function budsPerVine(input: {
  method: PruneMethod;
  budsPerSpur: number;
  spursPerVine: number;
  budsPerCane: number;
  canesPerVine: number;
}): number {
  return input.method === "spur"
    ? input.budsPerSpur * input.spursPerVine
    : input.budsPerCane * input.canesPerVine;
}

/** Bunches per hectare = bunchesPerBud × budsPerVine × vinesPerHa. */
export function bunchesPerHectare(
  bunchesPerBud: number,
  budsPerVineValue: number,
  vinesPerHa: number,
): number {
  return bunchesPerBud * budsPerVineValue * vinesPerHa;
}

/** kg/ha = bunchesPerHa × bunchWeightGrams ÷ 1000. */
export function yieldKgPerHectare(bunchesPerHa: number, bunchWeightGrams: number): number {
  return (bunchesPerHa * bunchWeightGrams) / 1000;
}

/** t/ha = kg/ha ÷ 1000. */
export function yieldTonnesPerHectare(kgPerHa: number): number {
  return kgPerHa / 1000;
}

/** Block total tonnes = t/ha × area (null when area ≤ 0). */
export function totalYieldTonnes(tonnesPerHa: number, areaHectares: number): number | null {
  if (!(areaHectares > 0)) return null;
  return tonnesPerHa * areaHectares;
}

export interface PruningYieldInputs {
  method: PruneMethod;
  bunchesPerBud: number;
  budsPerSpur: number;
  spursPerVine: number;
  budsPerCane: number;
  canesPerVine: number;
  vinesPerHa: number;
  bunchWeightGrams: number;
  areaHectares?: number | null;
}

export interface PruningYieldResult {
  budsPerVine: number;
  bunchesPerHa: number;
  yieldKgPerHa: number;
  yieldTonnesPerHa: number;
  totalTonnes: number | null;
}

export function calculatePruningYield(i: PruningYieldInputs): PruningYieldResult {
  const bpv = budsPerVine(i);
  const bph = bunchesPerHectare(i.bunchesPerBud, bpv, i.vinesPerHa);
  const kgPerHa = yieldKgPerHectare(bph, i.bunchWeightGrams);
  const tPerHa = yieldTonnesPerHectare(kgPerHa);
  return {
    budsPerVine: bpv,
    bunchesPerHa: bph,
    yieldKgPerHa: kgPerHa,
    yieldTonnesPerHa: tPerHa,
    totalTonnes: i.areaHectares != null ? totalYieldTonnes(tPerHa, i.areaHectares) : null,
  };
}

export const PRUNING_YIELD_FORMULA_TEXT: Record<PruneMethod, string> = {
  spur: "Yield / ha = Bunches/Bud × Buds/Spur × Spurs/Vine × Vines/ha × Bunch Weight",
  cane: "Yield / ha = Bunches/Bud × Buds/Cane × Canes/Vine × Vines/ha × Bunch Weight",
};

// ---------------------------------------------------------------------------
// Sample-based block estimate — mirrors YieldEstimationViewModel.calculateYieldEstimates
// ---------------------------------------------------------------------------

export interface BlockEstimateInputs {
  totalVines: number;
  /** averaged across recorded sample sites, rounded to 2 dp upstream */
  averageBunchesPerVine: number;
  bunchWeightKg: number;
  /** 1.0 when no damage adjustment applies */
  damageFactor: number;
}

export interface BlockEstimateOutput {
  totalBunches: number;
  estimatedYieldKg: number;
  estimatedYieldTonnes: number;
}

export function blockEstimate(i: BlockEstimateInputs): BlockEstimateOutput {
  const totalBunches = i.totalVines * i.averageBunchesPerVine;
  const kg = totalBunches * i.bunchWeightKg * i.damageFactor;
  return { totalBunches, estimatedYieldKg: kg, estimatedYieldTonnes: kg / 1000 };
}

/** iOS default when a block has no recorded bunch weight. */
export const DEFAULT_BUNCH_WEIGHT_KG = 0.15;
