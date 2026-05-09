// Advisor-level interpretation on top of the pure irrigation calculation.
import type { IrrigationRecommendationResult } from "./irrigation";

export type AdvisorStatus = "none" | "light" | "recommended" | "high";

export interface AdvisorInterpretation {
  status: AdvisorStatus;
  label: string;
  headline: string;
  detail: string;
}

export function interpretRecommendation(
  result: IrrigationRecommendationResult | null,
): AdvisorInterpretation {
  if (!result) {
    return {
      status: "none",
      label: "No recommendation",
      headline: "Awaiting inputs",
      detail: "Enter forecast days and an irrigation application rate to get a recommendation.",
    };
  }
  const minutes = result.recommendedIrrigationMinutes;
  const deficit = result.netDeficitMm;
  if (minutes <= 0 || deficit <= 0) {
    return {
      status: "none",
      label: "No irrigation recommended",
      headline: "No irrigation recommended",
      detail: "Forecast effective rainfall and soil moisture buffer cover the expected crop use.",
    };
  }
  if (minutes < 60) {
    return {
      status: "light",
      label: "Light irrigation recommended",
      headline: formatHeadline(minutes),
      detail: "A short top-up should cover the expected crop water deficit.",
    };
  }
  if (deficit > 25) {
    return {
      status: "high",
      label: "High deficit warning",
      headline: formatHeadline(minutes),
      detail: "Forecast deficit is significant. Consider splitting the run or irrigating sooner.",
    };
  }
  return {
    status: "recommended",
    label: "Irrigation recommended",
    headline: formatHeadline(minutes),
    detail: "Run the recommended duration over the forecast period.",
  };
}

export function formatHoursMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0 min";
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes - h * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatHeadline(minutes: number): string {
  return `Recommended irrigation: ${formatHoursMinutes(minutes)} over the selected forecast period.`;
}
