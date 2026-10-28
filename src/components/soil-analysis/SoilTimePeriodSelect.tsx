import { SOIL_TIME_PRESETS } from "@/lib/soilAnalysis";

const selectClass = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

/** Shared Past year / 2–5 years / All time period picker for the soil tabs. */
export function SoilTimePeriodSelect({
  value,
  onChange,
  ariaLabel = "Time period",
  showCustom = false,
}: {
  value: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  /** Renders a "Custom" option so manually typed dates are not mislabelled. */
  showCustom?: boolean;
}) {
  return (
    <select
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    >
      {showCustom && <option value="">Custom</option>}
      {SOIL_TIME_PRESETS.map((p) => (
        <option key={p.key} value={p.key}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
