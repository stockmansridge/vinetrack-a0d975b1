// Fertiliser Calculator Region & Units boundary. Storage/calculation stays
// canonical (ha, kg, L, kg|L per ha, g|mL per vine); these helpers convert at
// the UI boundary using the vineyard Region & Units settings. No weight-unit
// setting exists yet, so solid quantities always stay kg / g.
import type { FertiliserCalculationMode, FertiliserForm } from "./fertiliserCalc";
import { HA_PER_AC, L_PER_US_GAL, type RegionFormatters } from "./regionFormatters";

type Units = Pick<RegionFormatters, "settings">;

const acres = (r: Units) => r.settings.area_unit === "acres";
const gallons = (r: Units) => r.settings.volume_unit === "gallons";

export function areaLabel(r: Units): string {
  return acres(r) ? "ac" : "ha";
}
export function areaToDisplay(ha: number, r: Units): number {
  return acres(r) ? ha / HA_PER_AC : ha;
}
export function areaToCanonical(display: number, r: Units): number {
  return acres(r) ? display * HA_PER_AC : display;
}

/** Product quantity unit shown to the user (liquid follows volume_unit). */
export function quantityLabel(form: FertiliserForm, r: Units): string {
  if (form === "solid") return "kg";
  return gallons(r) ? "gal" : "L";
}
export function quantityToDisplay(canonical: number, form: FertiliserForm, r: Units): number {
  return form === "liquid" && gallons(r) ? canonical / L_PER_US_GAL : canonical;
}

export function rateLabel(mode: FertiliserCalculationMode, form: FertiliserForm, r: Units): string {
  if (mode === "perVine") return form === "liquid" ? "mL/vine" : "g/vine";
  return `${quantityLabel(form, r)}/${areaLabel(r)}`;
}
/** Display per-area rate → canonical kg|L per ha. Per-vine is unchanged. */
export function rateToCanonical(display: number, mode: FertiliserCalculationMode, form: FertiliserForm, r: Units): number {
  if (mode === "perVine") return display;
  let v = display;
  if (form === "liquid" && gallons(r)) v *= L_PER_US_GAL;
  if (acres(r)) v /= HA_PER_AC;
  return v;
}
export function rateToDisplay(canonical: number, mode: FertiliserCalculationMode, form: FertiliserForm, r: Units): number {
  if (mode === "perVine") return canonical;
  let v = canonical;
  if (form === "liquid" && gallons(r)) v /= L_PER_US_GAL;
  if (acres(r)) v *= HA_PER_AC;
  return v;
}

/** Canonical cost-per-ha → cost per configured area unit. */
export function costPerAreaToDisplay(perHa: number, r: Units): number {
  return acres(r) ? perHa * HA_PER_AC : perHa;
}
export function costPerAreaLabel(r: Units): string {
  return acres(r) ? "Cost per acre" : "Cost per hectare";
}

/** Trim a converted number for an editable input. */
export function inputValue(v: number, dp = 3): string {
  if (!Number.isFinite(v)) return "";
  return String(Number(v.toFixed(dp)));
}
