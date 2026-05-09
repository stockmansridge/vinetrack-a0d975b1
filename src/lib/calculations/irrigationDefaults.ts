// Irrigation Advisor — saved defaults and rate resolution.
//
// This helper centralises how the Irrigation Advisor decides which
// irrigation application rate (mm/hr) to use for the selected scope
// (whole vineyard or a specific block).
//
// The intended full fallback order is:
//
//   1. Selected block saved shared rate
//      (paddocks.irrigation_application_rate_mm_per_hour)
//   2. Vineyard saved shared rate
//      (vineyards.irrigation_application_rate_mm_per_hour)
//   3. Computed block rate from irrigation infrastructure
//      (row spacing × emitter spacing × flow per emitter)
//   4. Computed whole-vineyard rate from blocks with valid
//      irrigation infrastructure
//   5. Value remembered on this device
//   6. None — user enters mm/hr manually
//
// The shared rate fields above do not yet exist in the operations
// database. Until they do, callers pass `null` for the shared rates
// and the helper transparently falls through to the computed and
// device-saved values. When the shared columns are added, the page
// will simply start passing them in and the rest of the logic — and
// the customer-facing wording — will continue to work unchanged.

const VINEYARD_PREFIX = "vt_irrigation_rate_v_";
const PADDOCK_PREFIX = "vt_irrigation_rate_p_";

function read(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function write(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore quota / privacy errors
  }
}

function clear(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getVineyardIrrigationRate(vineyardId: string): number | null {
  return read(VINEYARD_PREFIX + vineyardId);
}

export function getPaddockIrrigationRate(paddockId: string): number | null {
  return read(PADDOCK_PREFIX + paddockId);
}

export function saveVineyardIrrigationRate(vineyardId: string, rate: number) {
  write(VINEYARD_PREFIX + vineyardId, rate);
}

export function savePaddockIrrigationRate(paddockId: string, rate: number) {
  write(PADDOCK_PREFIX + paddockId, rate);
}

export function clearVineyardIrrigationRate(vineyardId: string) {
  clear(VINEYARD_PREFIX + vineyardId);
}

export function clearPaddockIrrigationRate(paddockId: string) {
  clear(PADDOCK_PREFIX + paddockId);
}

/**
 * Calculate irrigation application rate (mm/hr) from drip-irrigation
 * infrastructure values. Mirrors the iOS block calculation:
 *   emittersPerHa = 10000 / (rowSpacing * emitterSpacing)
 *   L/ha/hr       = emittersPerHa * flowPerEmitter
 *   ML/ha/hr      = L/ha/hr / 1_000_000
 *   mm/hr         = ML/ha/hr * 100
 *
 * Returns null when any required value is missing or non-positive.
 */
export interface PaddockInfrastructure {
  emitterFlowLitresPerHour?: number | null;
  emitterSpacingMetres?: number | null;
  rowSpacingMetres?: number | null;
}

export interface VineyardRateCandidate {
  paddockId: string;
  areaHectares?: number | null;
  infrastructure?: PaddockInfrastructure | null;
}

export function calculateIrrigationRateFromInfrastructure(
  args: PaddockInfrastructure,
): number | null {
  const flow = Number(args.emitterFlowLitresPerHour);
  const eSpacing = Number(args.emitterSpacingMetres);
  const rSpacing = Number(args.rowSpacingMetres);
  if (!(flow > 0) || !(eSpacing > 0) || !(rSpacing > 0)) return null;
  const emittersPerHa = 10000 / (rSpacing * eSpacing);
  const litresPerHaPerHour = emittersPerHa * flow;
  const mlPerHaPerHour = litresPerHaPerHour / 1_000_000;
  return mlPerHaPerHour * 100;
}

export type IrrigationRateSource =
  | "paddock-shared"
  | "vineyard-shared"
  | "paddock-computed"
  | "vineyard-computed"
  | "vineyard-computed-average"
  | "paddock-device"
  | "vineyard-device"
  | "manual"
  | "none";

export interface ResolveRateInput {
  vineyardId: string | null;
  paddockId: string | null;
  /** Future: paddocks.irrigation_application_rate_mm_per_hour */
  paddockSharedRate?: number | null;
  /** Future: vineyards.irrigation_application_rate_mm_per_hour */
  vineyardSharedRate?: number | null;
  /** Selected block's drip-irrigation infrastructure (for computed fallback). */
  paddockInfrastructure?: PaddockInfrastructure | null;
  /** Available blocks for whole-vineyard calculated fallback. */
  vineyardPaddocks?: VineyardRateCandidate[];
}

export interface ResolvedRate {
  rate: number | null;
  source: IrrigationRateSource;
}

function getWeightedAverage(values: Array<{ rate: number; areaHectares: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + item.areaHectares, 0);
  if (totalWeight <= 0) return values.reduce((sum, item) => sum + item.rate, 0) / values.length;
  return values.reduce((sum, item) => sum + item.rate * item.areaHectares, 0) / totalWeight;
}

function areRatesNearSame(rates: number[]): boolean {
  if (rates.length <= 1) return true;
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const spread = max - min;
  const average = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  return spread <= Math.max(0.1, average * 0.05);
}

export function calculateVineyardIrrigationRateFromBlocks(
  paddocks: VineyardRateCandidate[],
): ResolvedRate | null {
  const valid = paddocks
    .map((paddock) => {
      const rate = paddock.infrastructure
        ? calculateIrrigationRateFromInfrastructure(paddock.infrastructure)
        : null;
      if (rate === null || rate <= 0) return null;
      const areaHectares = paddock.areaHectares && paddock.areaHectares > 0 ? paddock.areaHectares : 1;
      return { rate, areaHectares };
    })
    .filter((value): value is { rate: number; areaHectares: number } => value !== null);

  if (!valid.length) return null;

  const weightedAverage = getWeightedAverage(valid);
  return {
    rate: weightedAverage,
    source: areRatesNearSame(valid.map((item) => item.rate))
      ? "vineyard-computed"
      : "vineyard-computed-average",
  };
}

/**
 * Resolve the effective irrigation application rate to use, applying the
 * full intended fallback order documented at the top of this file.
 *
 * The page can call this with whatever data it currently has. Today the
 * shared-rate inputs are always `null`; once the database fields exist
 * the page will fetch and pass them in, and this resolver will pick
 * them up automatically — no UI changes required.
 */
export function resolveIrrigationRate(input: ResolveRateInput): ResolvedRate {
  const {
    vineyardId,
    paddockId,
    paddockSharedRate,
    vineyardSharedRate,
    paddockInfrastructure,
    vineyardPaddocks = [],
  } = input;

  // 1. Block shared rate
  if (paddockId && typeof paddockSharedRate === "number" && paddockSharedRate > 0) {
    return { rate: paddockSharedRate, source: "paddock-shared" };
  }
  // 2. Vineyard shared rate
  if (typeof vineyardSharedRate === "number" && vineyardSharedRate > 0) {
    return { rate: vineyardSharedRate, source: "vineyard-shared" };
  }
  // 3. Computed block rate from infrastructure
  if (paddockId && paddockInfrastructure) {
    const computed = calculateIrrigationRateFromInfrastructure(paddockInfrastructure);
    if (computed !== null && computed > 0) {
      return { rate: computed, source: "paddock-computed" };
    }
  }
  // 4. Whole-vineyard calculated rate from valid block infrastructure
  if (!paddockId) {
    const vineyardComputed = calculateVineyardIrrigationRateFromBlocks(vineyardPaddocks);
    if (vineyardComputed?.rate !== null && vineyardComputed.rate > 0) {
      return vineyardComputed;
    }
  }
  // 5. Block device-saved rate
  if (paddockId) {
    const p = getPaddockIrrigationRate(paddockId);
    if (p !== null) return { rate: p, source: "paddock-device" };
  }
  // 5. Vineyard device-saved rate
  if (vineyardId) {
    const v = getVineyardIrrigationRate(vineyardId);
    if (v !== null) return { rate: v, source: "vineyard-device" };
  }
  // 6. Nothing yet — user enters manually.
  return { rate: null, source: "none" };
}

/** Customer-facing label for the active rate source. */
export function describeRateSource(source: IrrigationRateSource): string {
  switch (source) {
    case "paddock-shared":
      return "Using saved block irrigation rate";
    case "vineyard-shared":
      return "Using vineyard default irrigation rate";
    case "paddock-computed":
      return "Using calculated block irrigation rate";
    case "vineyard-computed":
      return "Using calculated vineyard irrigation rate";
    case "vineyard-computed-average":
      return "Using calculated vineyard average irrigation rate";
    case "paddock-device":
      return "Using value entered on this device for this block";
    case "vineyard-device":
      return "Using vineyard value entered on this device";
    case "manual":
      return "Using value entered on this device";
    case "none":
    default:
      return "No saved or calculated irrigation rate yet — enter mm/hr below.";
  }
}
