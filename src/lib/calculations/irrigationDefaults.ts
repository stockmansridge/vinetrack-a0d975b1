// Saved Irrigation Advisor defaults.
//
// Storage strategy: this portal reads the operations database in read-only
// mode (it does not own that schema), so saved irrigation application rates
// are persisted in the browser per vineyard and per paddock. Values entered
// here populate automatically the next time the Irrigation Advisor opens on
// this browser. A future iOS-side schema update can sync these across
// devices using the same field names.

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
 * Resolve the effective irrigation application rate to use.
 *
 * Current (device-only) order:
 *   1. paddock saved rate (when a paddock is selected)
 *   2. vineyard saved rate
 *   3. null (user must enter manually)
 *
 * Future order once shared database fields exist
 * (vineyards.irrigation_application_rate_mm_per_hour,
 *  paddocks.irrigation_application_rate_mm_per_hour):
 *   1. paddock shared rate
 *   2. vineyard shared rate
 *   3. paddock device-saved rate
 *   4. vineyard device-saved rate
 *   5. null (manual entry)
 */
export function resolveIrrigationRate(
  vineyardId: string | null,
  paddockId: string | null,
): { rate: number | null; source: "paddock" | "vineyard" | "none" } {
  if (paddockId) {
    const p = getPaddockIrrigationRate(paddockId);
    if (p !== null) return { rate: p, source: "paddock" };
  }
  if (vineyardId) {
    const v = getVineyardIrrigationRate(vineyardId);
    if (v !== null) return { rate: v, source: "vineyard" };
  }
  return { rate: null, source: "none" };
}

/**
 * Calculate irrigation application rate (mm/hr) from drip-irrigation
 * infrastructure values. Mirrors the iOS block calculation:
 *   emittersPerHa = 10000 / (rowSpacing * emitterSpacing)
 *   L/ha/hr       = emittersPerHa * flowPerEmitter
 *   ML/ha/hr      = L/ha/hr / 1_000_000
 *   mm/hr         = ML/ha/hr * 100
 *
 * Not yet wired into the UI; exported for future use.
 */
export function calculateIrrigationRateFromInfrastructure(args: {
  emitterFlowLitresPerHour: number;
  emitterSpacingMetres: number;
  rowSpacingMetres: number;
}): number | null {
  const { emitterFlowLitresPerHour, emitterSpacingMetres, rowSpacingMetres } = args;
  if (
    !(emitterFlowLitresPerHour > 0) ||
    !(emitterSpacingMetres > 0) ||
    !(rowSpacingMetres > 0)
  ) {
    return null;
  }
  const emittersPerHa = 10000 / (rowSpacingMetres * emitterSpacingMetres);
  const litresPerHaPerHour = emittersPerHa * emitterFlowLitresPerHour;
  const mlPerHaPerHour = litresPerHaPerHour / 1_000_000;
  return mlPerHaPerHour * 100;
}
