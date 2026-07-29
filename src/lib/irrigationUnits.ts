// Display-only unit handling for the Phase 2B irrigation reporting centre.
//
// Backend values stay canonical (litres, litres_per_hour, hectares, mm,
// minutes). Nothing here rounds before aggregation — conversion happens at
// render time on already-aggregated server values. Null means "cannot be
// calculated safely" and is always rendered as an em dash.
import { useRegionFormatters } from "@/lib/useRegionFormatters";
import type { RegionFormatters } from "@/lib/regionFormatters";

const L_PER_US_GAL = 3.785411784;
const L_PER_IMP_GAL = 4.54609;
const HA_PER_AC = 0.40468564224;
const MM_PER_INCH = 25.4;

export const EMPTY = "—";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: number, dp: number): string {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

export interface IrrigationUnits {
  region: RegionFormatters;
  volumeUnit: string;
  largeVolumeUnit: string;
  depthUnit: string;
  areaUnit: string;
  flowUnit: string;
  perHectareUnit: string;
  perVineUnit: string;

  /** Litres → L / kL / US gal / imperial gal. */
  volume: (litres: unknown, dp?: number) => string;
  /** Litres per hour. */
  flow: (lph: unknown, dp?: number) => string;
  /** Millimetres → mm / in. */
  depth: (mm: unknown, dp?: number) => string;
  /** Hectares → ha / ac. */
  area: (hectares: unknown, dp?: number) => string;
  /** Litres per hectare → L/ha or gal/ac. */
  perHectare: (lPerHa: unknown, dp?: number) => string;
  /** Litres per vine. */
  perVine: (litres: unknown, dp?: number) => string;
  /** Minutes → "3 hr 20 min". */
  duration: (minutes: unknown) => string;
  /** Plain count. */
  count: (v: unknown) => string;
  /** Percentage returned by the backend. */
  percent: (v: unknown, dp?: number) => string;
  /** Signed difference in litres. */
  signedVolume: (litres: unknown, dp?: number) => string;
  /** Signed percentage. */
  signedPercent: (v: unknown, dp?: number) => string;
  date: (v: unknown) => string;
  dateTime: (v: unknown) => string;
}

export function useIrrigationUnits(): IrrigationUnits {
  const region = useRegionFormatters();
  const s = region.settings;

  const imperialGallons = ["GB", "UK", "IE"].includes(s.country_code as string);
  const gallons = s.volume_unit === "gallons";
  const litresPerGallon = imperialGallons ? L_PER_IMP_GAL : L_PER_US_GAL;
  const acres = s.area_unit === "acres";
  const inches = s.distance_unit === "imperial";
  const rateAcre = s.spray_rate_area_unit === "acre";

  const volumeUnit = gallons ? "gal" : "L";
  const largeVolumeUnit = gallons ? "gal" : "kL";
  const depthUnit = inches ? "in" : "mm";
  const areaUnit = acres ? "ac" : "ha";
  const flowUnit = `${volumeUnit}/hr`;
  const perHectareUnit = `${volumeUnit}/${rateAcre ? "ac" : "ha"}`;
  const perVineUnit = `${volumeUnit}/vine`;

  const volume = (v: unknown, dp?: number) => {
    const x = num(v);
    if (x == null) return EMPTY;
    if (gallons) return `${fmt(x / litresPerGallon, dp ?? 1)} ${volumeUnit}`;
    if (Math.abs(x) >= 10000) return `${fmt(x / 1000, dp ?? 2)} kL`;
    return `${fmt(x, dp ?? 0)} L`;
  };

  return {
    region,
    volumeUnit,
    largeVolumeUnit,
    depthUnit,
    areaUnit,
    flowUnit,
    perHectareUnit,
    perVineUnit,
    volume,
    flow: (v, dp = 1) => {
      const x = num(v);
      if (x == null) return EMPTY;
      return `${fmt(gallons ? x / litresPerGallon : x, dp)} ${flowUnit}`;
    },
    depth: (v, dp = 1) => {
      const x = num(v);
      if (x == null) return EMPTY;
      return inches
        ? `${fmt(x / MM_PER_INCH, Math.max(dp, 2))} in`
        : `${fmt(x, dp)} mm`;
    },
    area: (v, dp = 2) => {
      const x = num(v);
      if (x == null) return EMPTY;
      return `${fmt(acres ? x / HA_PER_AC : x, dp)} ${areaUnit}`;
    },
    perHectare: (v, dp = 0) => {
      const x = num(v);
      if (x == null) return EMPTY;
      let out = x;
      if (gallons) out = out / litresPerGallon;
      if (rateAcre) out = out * HA_PER_AC;
      return `${fmt(out, dp)} ${perHectareUnit}`;
    },
    perVine: (v, dp = 1) => {
      const x = num(v);
      if (x == null) return EMPTY;
      return `${fmt(gallons ? x / litresPerGallon : x, dp)} ${perVineUnit}`;
    },
    duration: (v) => {
      const x = num(v);
      if (x == null) return EMPTY;
      const total = Math.round(x);
      const h = Math.floor(total / 60);
      const m = total % 60;
      if (h === 0) return `${m} min`;
      if (m === 0) return `${h} hr`;
      return `${h} hr ${m} min`;
    },
    count: (v) => {
      const x = num(v);
      return x == null ? EMPTY : fmt(x, 0);
    },
    percent: (v, dp = 1) => {
      const x = num(v);
      return x == null ? EMPTY : `${fmt(x, dp)}%`;
    },
    signedVolume: (v, dp) => {
      const x = num(v);
      if (x == null) return EMPTY;
      const body = volume(Math.abs(x), dp);
      return `${x > 0 ? "+" : x < 0 ? "−" : ""}${body}`;
    },
    signedPercent: (v, dp = 1) => {
      const x = num(v);
      if (x == null) return EMPTY;
      return `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmt(Math.abs(x), dp)}%`;
    },
    date: (v) => (v ? region.date(v as string) : EMPTY),
    dateTime: (v) => (v ? region.dateTime(v as string) : EMPTY),
  };
}

/** Raw canonical unit metadata used in exports. */
export const CANONICAL_UNITS =
  "volume=litres; flow=litres_per_hour; area=hectares; depth=millimetres; rainfall=millimetres; duration=minutes";
