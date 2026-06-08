// Vineyard Region & Units settings.
//
// Mirrors the iOS/Rork contract exactly. Reads/writes go through the
// shared Supabase RPCs `get_vineyard_region_settings` and
// `set_vineyard_region_settings` on the iOS Supabase project. The
// underlying columns live on `public.vineyards`. These settings only
// affect display and exports — they never rewrite stored historical
// records.
import { supabase } from "@/integrations/ios-supabase/client";

export type CountryCode = "AU" | "NZ" | "US" | "CA" | "GB" | "ZA";
export type AreaUnit = "hectares" | "acres";
export type VolumeUnit = "litres" | "gallons";
export type DistanceUnit = "metric" | "imperial";
export type FuelUnit = "litres" | "gallons";
export type SprayRateAreaUnit = "hectare" | "acre";
export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type TerminologyRegion = "AU_NZ" | "US_CA" | "UK_ZA";

export interface RegionSettings {
  country_code: CountryCode;
  currency_code: string;
  area_unit: AreaUnit;
  volume_unit: VolumeUnit;
  distance_unit: DistanceUnit;
  fuel_unit: FuelUnit;
  spray_rate_area_unit: SprayRateAreaUnit;
  date_format: DateFormat;
  terminology_region: TerminologyRegion;
}

export const AU_DEFAULTS: RegionSettings = {
  country_code: "AU",
  currency_code: "AUD",
  area_unit: "hectares",
  volume_unit: "litres",
  distance_unit: "metric",
  fuel_unit: "litres",
  spray_rate_area_unit: "hectare",
  date_format: "DD/MM/YYYY",
  terminology_region: "AU_NZ",
};

export const COUNTRY_OPTIONS: { code: CountryCode; name: string }[] = [
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "ZA", name: "South Africa" },
];

export const COUNTRY_PRESETS: Record<CountryCode, RegionSettings> = {
  AU: AU_DEFAULTS,
  NZ: {
    country_code: "NZ",
    currency_code: "NZD",
    area_unit: "hectares",
    volume_unit: "litres",
    distance_unit: "metric",
    fuel_unit: "litres",
    spray_rate_area_unit: "hectare",
    date_format: "DD/MM/YYYY",
    terminology_region: "AU_NZ",
  },
  US: {
    country_code: "US",
    currency_code: "USD",
    area_unit: "acres",
    volume_unit: "gallons",
    distance_unit: "imperial",
    fuel_unit: "gallons",
    spray_rate_area_unit: "acre",
    date_format: "MM/DD/YYYY",
    terminology_region: "US_CA",
  },
  CA: {
    country_code: "CA",
    currency_code: "CAD",
    area_unit: "hectares",
    volume_unit: "litres",
    distance_unit: "metric",
    fuel_unit: "litres",
    spray_rate_area_unit: "hectare",
    date_format: "YYYY-MM-DD",
    terminology_region: "US_CA",
  },
  GB: {
    country_code: "GB",
    currency_code: "GBP",
    area_unit: "hectares",
    volume_unit: "litres",
    distance_unit: "metric",
    fuel_unit: "litres",
    spray_rate_area_unit: "hectare",
    date_format: "DD/MM/YYYY",
    terminology_region: "UK_ZA",
  },
  ZA: {
    country_code: "ZA",
    currency_code: "ZAR",
    area_unit: "hectares",
    volume_unit: "litres",
    distance_unit: "metric",
    fuel_unit: "litres",
    spray_rate_area_unit: "hectare",
    date_format: "DD/MM/YYYY",
    terminology_region: "UK_ZA",
  },
};

export const CURRENCY_OPTIONS = ["AUD", "NZD", "USD", "CAD", "GBP", "ZAR", "EUR"];

function applyAuDefaults(raw: Partial<RegionSettings> | null | undefined): RegionSettings {
  const r = (raw ?? {}) as Partial<RegionSettings>;
  return {
    country_code: (r.country_code as CountryCode) ?? AU_DEFAULTS.country_code,
    currency_code: r.currency_code ?? AU_DEFAULTS.currency_code,
    area_unit: (r.area_unit as AreaUnit) ?? AU_DEFAULTS.area_unit,
    volume_unit: (r.volume_unit as VolumeUnit) ?? AU_DEFAULTS.volume_unit,
    distance_unit: (r.distance_unit as DistanceUnit) ?? AU_DEFAULTS.distance_unit,
    fuel_unit: (r.fuel_unit as FuelUnit) ?? AU_DEFAULTS.fuel_unit,
    spray_rate_area_unit:
      (r.spray_rate_area_unit as SprayRateAreaUnit) ?? AU_DEFAULTS.spray_rate_area_unit,
    date_format: (r.date_format as DateFormat) ?? AU_DEFAULTS.date_format,
    terminology_region:
      (r.terminology_region as TerminologyRegion) ?? AU_DEFAULTS.terminology_region,
  };
}

export async function fetchVineyardRegionSettings(
  vineyardId: string,
): Promise<RegionSettings> {
  const { data, error } = await supabase.rpc("get_vineyard_region_settings", {
    p_vineyard_id: vineyardId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return applyAuDefaults(row as Partial<RegionSettings> | null);
}

export async function saveVineyardRegionSettings(
  vineyardId: string,
  settings: RegionSettings,
): Promise<void> {
  const { error } = await supabase.rpc("set_vineyard_region_settings", {
    p_vineyard_id: vineyardId,
    p_country_code: settings.country_code,
    p_currency_code: settings.currency_code,
    p_area_unit: settings.area_unit,
    p_volume_unit: settings.volume_unit,
    p_distance_unit: settings.distance_unit,
    p_fuel_unit: settings.fuel_unit,
    p_spray_rate_area_unit: settings.spray_rate_area_unit,
    p_date_format: settings.date_format,
    p_terminology_region: settings.terminology_region,
  });
  if (error) throw error;
}
