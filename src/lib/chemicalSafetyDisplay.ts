// Conservative WHP / REI presentation rules shared by the Portal Chemical
// Store, matching the VineTrack chemical contract used by iOS and Android.
//
// Hard rules (safety, not cosmetics):
//   * A period is NEVER inferred and NEVER defaults to zero.
//   * A zero-day withholding period only reads as a statement when the label
//     wording that supports it ("not required when used as directed") is
//     present. Otherwise a zero is treated as unresolved.
//   * The re-entry interval is never copied from the withholding period.
//   * Missing information reads as the neutral state, never "0" and never
//     "No restrictions".
import { isNotRequiredWording } from "@/lib/chemicalLabelRates";
import type { RegisteredUse } from "@/lib/chemicalIntelligence";

export const NOT_RESOLVED_LABEL = "Not resolved";
export const NO_RESTRICTIONS_RECORDED_LABEL = "No restrictions recorded on this use";

const isPureNumber = (v: string): boolean => /^-?\d+(\.\d+)?$/.test(v.trim());

/** Verbatim label text is preserved; a bare number is not a legal statement. */
const verbatim = (value?: string | null): string | null => {
  const t = (value ?? "").trim();
  if (!t || isPureNumber(t)) return null;
  return t;
};

/**
 * Withholding period for one registered use. Returns the neutral state when
 * the label evidence does not support a period.
 */
export function withholdingDisplayForUse(
  use: Pick<RegisteredUse, "withholdingDays" | "withholdingText" | "withholdingPeriod" | "restrictions">,
): string {
  const days = use.withholdingDays;
  if (days != null && days > 0) {
    return use.withholdingText ?? `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (days === 0) {
    // Zero only means something when the label says so.
    const context = [use.withholdingText, use.withholdingPeriod, use.restrictions]
      .filter(Boolean)
      .join("\n");
    if (isNotRequiredWording(context)) return "Not required when used as directed";
    const text = verbatim(use.withholdingPeriod);
    return text ?? NOT_RESOLVED_LABEL;
  }
  return verbatim(use.withholdingText) ?? verbatim(use.withholdingPeriod) ?? NOT_RESOLVED_LABEL;
}

/**
 * Re-entry interval for one registered use. Never derived from the withholding
 * period and never defaulted to zero.
 */
export function reEntryDisplayForUse(
  use: Pick<RegisteredUse, "reEntryHours" | "reEntryPeriod">,
): string {
  const hours = use.reEntryHours;
  if (hours != null && hours > 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (hours === 0) {
    const text = verbatim(use.reEntryPeriod);
    return text ?? NOT_RESOLVED_LABEL;
  }
  return verbatim(use.reEntryPeriod) ?? NOT_RESOLVED_LABEL;
}

/** Verbatim per-use restrictions. Absence is never "No restrictions". */
export function restrictionsDisplayForUse(
  use: Pick<RegisteredUse, "restrictions">,
): string | null {
  return verbatim(use.restrictions);
}
