/** Raw panel observations only: these ratios are not block yield estimates. */
export interface PanelMeasurement {
  totalBunches: number | null;
  plantedPositions: number | null;
  fruitingVines: number | null;
  missingPositions: number | null;
  nonproductiveVines: number | null;
  panelLengthMetres: number | null;
  calculationVersion: string | number | null;
}
export function parsePanelMeasurement(entry: unknown): PanelMeasurement | null {
  if (!entry || typeof entry !== 'object') return null;
  const measurement = (entry as Record<string, unknown>).measurement;
  if (!measurement || typeof measurement !== 'object') return null;
  const m = measurement as Record<string, unknown>;
  const value = (key: string, integer = true) => {
    const v = m[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && (!integer || Number.isInteger(v)) ? v : null;
  };
  return {
    totalBunches: value('totalBunches'), plantedPositions: value('plantedPositions'),
    fruitingVines: value('fruitingVines'), missingPositions: value('missingPositions'),
    nonproductiveVines: value('nonproductiveVines'), panelLengthMetres: value('panelLengthMetres', false),
    calculationVersion: typeof m.calculationVersion === 'string' || typeof m.calculationVersion === 'number' ? m.calculationVersion : null,
  };
}
export function summarisePanelMeasurements(measurements: (PanelMeasurement | null)[]) {
  const recorded = measurements.filter((m): m is PanelMeasurement => m?.totalBunches != null);
  const sum = (key: Exclude<keyof PanelMeasurement, 'calculationVersion'>) =>
    recorded.length && recorded.every(m => m[key] != null) ? recorded.reduce((n, m) => n + (m[key] ?? 0), 0) : null;
  const totalBunches = sum('totalBunches');
  const plantedPositions = sum('plantedPositions');
  const fruitingVines = sum('fruitingVines');
  const missingPositions = sum('missingPositions');
  const nonproductiveVines = sum('nonproductiveVines');
  const ratio = (n: number | null, d: number | null) => n != null && d != null && d > 0 ? n / d : null;
  return {
    recordedCount: recorded.length, totalBunches, plantedPositions, fruitingVines, missingPositions, nonproductiveVines,
    panelLengthMetres: sum('panelLengthMetres'),
    bunchesPerPlantedPosition: ratio(totalBunches, plantedPositions), bunchesPerFruitingVine: ratio(totalBunches, fruitingVines),
    fruitingRatio: ratio(fruitingVines, plantedPositions), missingRatio: ratio(missingPositions, plantedPositions),
    nonproductiveRatio: ratio(nonproductiveVines, plantedPositions),
  };
}