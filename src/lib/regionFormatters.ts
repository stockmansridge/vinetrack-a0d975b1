// Shared display/export formatters driven by the vineyard Region & Units
// settings (see vineyardRegionSettingsQuery.ts). These are DISPLAY-ONLY —
// they never mutate stored records. Storage stays in canonical units
// (hectares, litres, km, km/h, L/ha, AUD numbers) and is converted at
// render/export time.
//
// Missing settings fall back to AU defaults via applyAuDefaults() upstream.
import { AU_DEFAULTS, type RegionSettings } from "./vineyardRegionSettingsQuery";

// --- conversions ---
const L_PER_US_GAL = 3.785411784;
const KM_PER_MI = 1.609344;
const HA_PER_AC = 0.40468564224;

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const num = typeof v === "number" ? v : Number(v);
  return Number.isFinite(num) ? num : null;
}

function round(v: number, dp: number): string {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

// --- date parsing for the date_format token ---
function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function toDate(v: Date | string | number | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export interface RegionFormatters {
  settings: RegionSettings;

  // labels
  areaUnitLabel: string;          // "ha" | "ac"
  volumeUnitLabel: string;        // "L" | "gal"
  fuelUnitLabel: string;          // "L" | "gal"
  distanceUnitLabel: string;      // "km" | "mi"
  speedUnitLabel: string;         // "km/h" | "mph"
  sprayRateUnitLabel: string;     // "L/ha" | "gal/ac"
  currencySymbol: string;

  blockLabel: string;             // "Block" | "Block" | "Block"
  blocksLabel: string;

  // value formatters — input ALWAYS in canonical/storage units
  area: (haValue: unknown, dp?: number) => string;        // ha in → ha/ac
  volume: (litres: unknown, dp?: number) => string;       // L in → L/gal
  fuel: (litres: unknown, dp?: number) => string;
  distance: (km: unknown, dp?: number) => string;         // km in → km/mi
  speed: (kmh: unknown, dp?: number) => string;           // km/h in → km/h or mph
  sprayRate: (lPerHa: unknown, dp?: number) => string;    // L/ha in → L/ha or gal/ac
  currency: (amount: unknown, dp?: number) => string;     // raw number
  date: (value: Date | string | number | null | undefined) => string;
  dateTime: (value: Date | string | number | null | undefined) => string;
}

function localeFromDateFormat(fmt: RegionSettings["date_format"]): string {
  switch (fmt) {
    case "MM/DD/YYYY":
      return "en-US";
    case "YYYY-MM-DD":
      return "sv-SE"; // produces YYYY-MM-DD
    case "DD/MM/YYYY":
    default:
      return "en-GB";
  }
}

function currencySymbolFor(code: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    const sym = parts.find((p) => p.type === "currency")?.value;
    if (sym) return sym;
  } catch {
    /* ignore */
  }
  return code;
}

export function createRegionFormatters(
  raw?: Partial<RegionSettings> | null,
): RegionFormatters {
  const s: RegionSettings = { ...AU_DEFAULTS, ...(raw ?? {}) } as RegionSettings;

  const areaImperial = s.area_unit === "acres";
  const volImperial = s.volume_unit === "gallons";
  const fuelImperial = s.fuel_unit === "gallons";
  const distImperial = s.distance_unit === "imperial";
  const rateImperial = s.spray_rate_area_unit === "acre";

  const areaUnitLabel = areaImperial ? "ac" : "ha";
  const volumeUnitLabel = volImperial ? "gal" : "L";
  const fuelUnitLabel = fuelImperial ? "gal" : "L";
  const distanceUnitLabel = distImperial ? "mi" : "km";
  const speedUnitLabel = distImperial ? "mph" : "km/h";
  const sprayRateUnitLabel = `${volumeUnitLabel}/${rateImperial ? "ac" : "ha"}`;

  const blockLabel = "Block";
  const blocksLabel = "Blocks";

  const dateLocale = localeFromDateFormat(s.date_format);

  const fmtDate = (value: Date | string | number | null | undefined): string => {
    const d = toDate(value === undefined ? new Date() : value);
    if (!d) return "";
    if (s.date_format === "YYYY-MM-DD") {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return d.toLocaleDateString(dateLocale);
  };

  const fmtDateTime = (value: Date | string | number | null | undefined): string => {
    const d = toDate(value === undefined ? new Date() : value);
    if (!d) return "";
    return `${fmtDate(d)} ${d.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}`;
  };

  return {
    settings: s,
    areaUnitLabel,
    volumeUnitLabel,
    fuelUnitLabel,
    distanceUnitLabel,
    speedUnitLabel,
    sprayRateUnitLabel,
    currencySymbol: currencySymbolFor(s.currency_code),
    blockLabel,
    blocksLabel,

    area: (v, dp = 2) => {
      const x = n(v);
      if (x == null) return "";
      const out = areaImperial ? x / HA_PER_AC : x;
      return `${round(out, dp)} ${areaUnitLabel}`;
    },
    volume: (v, dp = 1) => {
      const x = n(v);
      if (x == null) return "";
      const out = volImperial ? x / L_PER_US_GAL : x;
      return `${round(out, dp)} ${volumeUnitLabel}`;
    },
    fuel: (v, dp = 1) => {
      const x = n(v);
      if (x == null) return "";
      const out = fuelImperial ? x / L_PER_US_GAL : x;
      return `${round(out, dp)} ${fuelUnitLabel}`;
    },
    distance: (v, dp = 1) => {
      const x = n(v);
      if (x == null) return "";
      const out = distImperial ? x / KM_PER_MI : x;
      return `${round(out, dp)} ${distanceUnitLabel}`;
    },
    speed: (v, dp = 1) => {
      const x = n(v);
      if (x == null) return "";
      const out = distImperial ? x / KM_PER_MI : x;
      return `${round(out, dp)} ${speedUnitLabel}`;
    },
    sprayRate: (v, dp = 2) => {
      const x = n(v);
      if (x == null) return "";
      // L/ha -> volume conversion AND area conversion
      let out = x;
      if (volImperial) out = out / L_PER_US_GAL; // -> gal/ha
      if (rateImperial) out = out * HA_PER_AC;   // -> per acre
      return `${round(out, dp)} ${sprayRateUnitLabel}`;
    },
    currency: (v, dp = 2) => {
      const x = n(v);
      if (x == null) return "";
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: s.currency_code,
          currencyDisplay: "narrowSymbol",
          minimumFractionDigits: dp,
          maximumFractionDigits: dp,
        }).format(x);
      } catch {
        return `${s.currency_code} ${round(x, dp)}`;
      }
    },
    date: fmtDate,
    dateTime: fmtDateTime,
  };
}

/** Convenience: AU-default formatters with no settings loaded. */
export const AU_FORMATTERS = createRegionFormatters(AU_DEFAULTS);
