// Ported from iOS IrrigationCalculator.swift — keep behaviour in sync.

export interface ForecastDay {
  date: string; // ISO or label
  forecastEToMm: number;
  forecastRainMm: number;
}

export interface IrrigationSettings {
  irrigationApplicationRateMmPerHour: number;
  cropCoefficientKc: number;
  irrigationEfficiencyPercent: number;
  rainfallEffectivenessPercent: number;
  replacementPercent: number;
  soilMoistureBufferMm: number;
}

export const DEFAULT_IRRIGATION_SETTINGS: IrrigationSettings = {
  irrigationApplicationRateMmPerHour: 0,
  cropCoefficientKc: 0.65,
  irrigationEfficiencyPercent: 90,
  rainfallEffectivenessPercent: 80,
  replacementPercent: 100,
  soilMoistureBufferMm: 0,
};

export interface DailyIrrigationBreakdown {
  date: string;
  forecastEToMm: number;
  forecastRainMm: number;
  cropUseMm: number;
  effectiveRainMm: number;
  dailyDeficitMm: number;
}

export interface IrrigationRecommendationResult {
  dailyBreakdown: DailyIrrigationBreakdown[];
  forecastCropUseMm: number;
  forecastEffectiveRainMm: number;
  recentActualRainMm: number;
  netDeficitMm: number;
  grossIrrigationMm: number;
  recommendedIrrigationHours: number;
  recommendedIrrigationMinutes: number;
}

export function calculateIrrigation(
  forecastDays: ForecastDay[],
  settings: IrrigationSettings,
  recentActualRainMm: number = 0,
): IrrigationRecommendationResult | null {
  if (!forecastDays.length) return null;
  if (settings.irrigationApplicationRateMmPerHour <= 0) return null;

  const kc = settings.cropCoefficientKc;
  const rainEff = settings.rainfallEffectivenessPercent / 100;
  const irrEff = Math.max(settings.irrigationEfficiencyPercent / 100, 0.0001);
  const replacement = settings.replacementPercent / 100;

  const breakdown: DailyIrrigationBreakdown[] = [];
  let totalCropUse = 0;
  let totalEffectiveRain = 0;
  let totalDeficit = 0;

  for (const day of forecastDays) {
    const cropUseMm = day.forecastEToMm * kc;
    const rawEffectiveRain = day.forecastRainMm * rainEff;
    const effectiveRainMm = day.forecastRainMm < 2.0 ? 0 : rawEffectiveRain;
    const dailyDeficitMm = Math.max(0, cropUseMm - effectiveRainMm);

    breakdown.push({
      date: day.date,
      forecastEToMm: day.forecastEToMm,
      forecastRainMm: day.forecastRainMm,
      cropUseMm,
      effectiveRainMm,
      dailyDeficitMm,
    });

    totalCropUse += cropUseMm;
    totalEffectiveRain += effectiveRainMm;
    totalDeficit += dailyDeficitMm;
  }

  const actualRainOffset = Math.max(0, recentActualRainMm * rainEff);
  const adjustedNetDeficitMm = Math.max(
    0,
    totalDeficit - settings.soilMoistureBufferMm - actualRainOffset,
  );
  const targetNetIrrigationMm = adjustedNetDeficitMm * replacement;
  const grossIrrigationMm = targetNetIrrigationMm / irrEff;
  const hours = grossIrrigationMm / settings.irrigationApplicationRateMmPerHour;
  const minutes = Math.round(hours * 60);

  return {
    dailyBreakdown: breakdown,
    forecastCropUseMm: totalCropUse,
    forecastEffectiveRainMm: totalEffectiveRain,
    recentActualRainMm: actualRainOffset,
    netDeficitMm: adjustedNetDeficitMm,
    grossIrrigationMm,
    recommendedIrrigationHours: hours,
    recommendedIrrigationMinutes: minutes,
  };
}
