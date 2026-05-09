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
//   4. Block saved value remembered on this device
//   5. Vineyard saved value remembered on this device
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
}

export interface ResolvedRate {
  rate: number | null;
  source: IrrigationRateSource;
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
  // 4. Block device-saved rate
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
    case "paddock-device":
      return "Using value entered on this device for this block";
    case "vineyard-device":
      return "Using vineyard value entered on this device";
    case "manual":
      return "Using value entered on this device";
    case "none":
    default:
      return "No irrigation rate yet — enter mm/hr below.";
  }
}
