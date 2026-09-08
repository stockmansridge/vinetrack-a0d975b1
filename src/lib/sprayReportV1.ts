// Spray Report v1 — canonical payload contract (docs: spray-report-v1-contract.md).
//
// `SprayReportPayloadV1` returned by `get_spray_report_v1(p_trip_id)` is the ONLY
// semantic input to a Spray Trip PDF. The portal must not infer report facts
// (tank matching, weather, row status, blocks, costs) independently, and must not
// build a competing payload, weather table, route style or tank matching rule.
import { supabase } from "@/integrations/ios-supabase/client";

export const SPRAY_ROUTE_STYLE_VERSION = "spray-route-red-green-v1";
export const SPRAY_REPORT_ASSET_BUCKET = "trip-report-assets";
export const SPRAY_RECORD_UNAVAILABLE_MESSAGE =
  "Spray record not available yet—sync and retry";

export type SprayRowStatus = "Complete" | "Partial" | "Skipped/Not complete";
export type SprayChemicalUnit = "Litres" | "mL" | "Kg" | "g";
export type SprayMatchSource =
  | "plannedChemicalId"
  | "savedChemicalId"
  | "nameUnit"
  | "notRecorded"
  | "ambiguous";
export type SprayWeatherSourceKind = "observed" | "modelled" | "manual" | "unavailable";

export interface SprayReportIdentity {
  tripId: string;
  sprayRecordId: string;
  vineyardId: string;
  vineyardName: string;
  reference: string;
  vineyardTimeZone: string;
}

export interface SprayReportTrip {
  startUtc: string | null;
  endUtc: string | null;
  activeDurationSeconds: number | null;
  distanceMetres: number | null;
  operatorName: string | null;
  pinCount: number;
}

export interface SprayReportBlock {
  blockId: string;
  name: string;
  grossAreaHa?: number | null;
  treatedAreaHa?: number | null;
}

export interface SprayReportEquipment {
  tractorName: string | null;
  startEngineHours: number | null;
  endEngineHours: number | null;
  engineHoursUsed: number | null;
  sprayUnitName: string | null;
}

export interface SprayReportRow {
  rowNumber: number;
  blockName: string | null;
  status: SprayRowStatus;
  source: string;
  tank: number | "Multiple" | null;
}

export interface SprayReportTankChemical {
  plannedChemicalId: string;
  savedChemicalId: string | null;
  name: string;
  unit: SprayChemicalUnit;
  plannedAmountBase: number;
  actualAmountBase: number | null;
  matchSource: SprayMatchSource;
}

export interface SprayReportTank {
  tankNumber: number;
  plannedWaterLitres: number;
  actualWaterLitres: number | null;
  chemicals: SprayReportTankChemical[];
}

export interface SprayReportWeather {
  sampleSlot: string;
  observedAt: string | null;
  source: string;
  sourceKind: SprayWeatherSourceKind;
  isStale: boolean;
  temperatureC: number | null;
  humidityPct: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  rainMm: number | null;
}

export interface SprayReportRoute {
  bucket: string;
  objectPath: string;
  sha256: string;
  routeHash: string;
  styleVersion: string;
}

export interface SprayReportPayloadV1 {
  schemaVersion: "1.0";
  identity: SprayReportIdentity;
  trip: SprayReportTrip;
  blocks: SprayReportBlock[] | null;
  equipment: SprayReportEquipment;
  rows: SprayReportRow[];
  tanks: SprayReportTank[];
  weather: SprayReportWeather[];
  route: SprayReportRoute | null;
  cost?: Record<string, unknown> | null;
  warnings: string[];
}

export interface SprayReportParseResult {
  payload: SprayReportPayloadV1 | null;
  errors: string[];
}

const ROW_STATUSES: SprayRowStatus[] = ["Complete", "Partial", "Skipped/Not complete"];
const UNITS: SprayChemicalUnit[] = ["Litres", "mL", "Kg", "g"];
const MATCH_SOURCES: SprayMatchSource[] = [
  "plannedChemicalId",
  "savedChemicalId",
  "nameUnit",
  "notRecorded",
  "ambiguous",
];
const SOURCE_KINDS: SprayWeatherSourceKind[] = [
  "observed",
  "modelled",
  "manual",
  "unavailable",
];

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Structural validation of the canonical payload. Only shape is checked — no
 * value is derived, defaulted or repaired here: a payload that fails validation
 * must block the export rather than be rendered from guessed data.
 */
export function parseSprayReportPayload(raw: unknown): SprayReportParseResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { payload: null, errors: ["Payload is not an object"] };
  if (raw.schemaVersion !== "1.0") errors.push("Unsupported schemaVersion");

  const id = raw.identity;
  if (!isObj(id)) errors.push("Missing identity");
  else {
    for (const k of [
      "tripId",
      "sprayRecordId",
      "vineyardId",
      "vineyardName",
      "reference",
      "vineyardTimeZone",
    ]) {
      if (typeof id[k] !== "string" || !id[k]) errors.push(`identity.${k} is required`);
    }
  }

  const trip = raw.trip;
  if (!isObj(trip)) errors.push("Missing trip");
  else if (typeof trip.pinCount !== "number") errors.push("trip.pinCount is required");

  const eq = raw.equipment;
  if (!isObj(eq)) errors.push("Missing equipment");

  if (raw.blocks != null && !Array.isArray(raw.blocks)) errors.push("blocks must be an array or null");
  if (!Array.isArray(raw.rows)) errors.push("rows must be an array");
  else
    raw.rows.forEach((r: any, i: number) => {
      if (!isObj(r)) return errors.push(`rows[${i}] is not an object`);
      if (typeof r.rowNumber !== "number") errors.push(`rows[${i}].rowNumber must be a number`);
      if (!ROW_STATUSES.includes(r.status)) errors.push(`rows[${i}].status is invalid`);
      if (typeof r.source !== "string") errors.push(`rows[${i}].source must be a string`);
      if (!(r.tank == null || r.tank === "Multiple" || typeof r.tank === "number"))
        errors.push(`rows[${i}].tank is invalid`);
    });

  if (!Array.isArray(raw.tanks)) errors.push("tanks must be an array");
  else
    raw.tanks.forEach((t: any, i: number) => {
      if (!isObj(t)) return errors.push(`tanks[${i}] is not an object`);
      if (typeof t.tankNumber !== "number") errors.push(`tanks[${i}].tankNumber must be a number`);
      if (!Array.isArray(t.chemicals)) return errors.push(`tanks[${i}].chemicals must be an array`);
      t.chemicals.forEach((c: any, ci: number) => {
        if (!isObj(c)) return errors.push(`tanks[${i}].chemicals[${ci}] is not an object`);
        if (!UNITS.includes(c.unit)) errors.push(`tanks[${i}].chemicals[${ci}].unit is invalid`);
        if (!MATCH_SOURCES.includes(c.matchSource))
          errors.push(`tanks[${i}].chemicals[${ci}].matchSource is invalid`);
      });
    });

  if (!Array.isArray(raw.weather)) errors.push("weather must be an array");
  else
    raw.weather.forEach((w: any, i: number) => {
      if (!isObj(w)) return errors.push(`weather[${i}] is not an object`);
      if (typeof w.sampleSlot !== "string") errors.push(`weather[${i}].sampleSlot is required`);
      if (!SOURCE_KINDS.includes(w.sourceKind)) errors.push(`weather[${i}].sourceKind is invalid`);
    });

  if (raw.route != null) {
    if (!isObj(raw.route)) errors.push("route must be an object or null");
    else {
      if (raw.route.bucket !== SPRAY_REPORT_ASSET_BUCKET) errors.push("route.bucket is invalid");
      if (typeof raw.route.objectPath !== "string" || !raw.route.objectPath)
        errors.push("route.objectPath is required");
      if (raw.route.styleVersion !== SPRAY_ROUTE_STYLE_VERSION)
        errors.push("route.styleVersion is invalid");
    }
  }

  if (!Array.isArray(raw.warnings)) errors.push("warnings must be an array");

  if (errors.length) return { payload: null, errors };

  const payload = raw as SprayReportPayloadV1;
  // Hourly weather is append-only and ordered by sampleSlot.
  payload.weather = [...payload.weather].sort((a, b) =>
    a.sampleSlot < b.sampleSlot ? -1 : a.sampleSlot > b.sampleSlot ? 1 : 0,
  );
  return { payload, errors: [] };
}

export interface FetchSprayReportResult {
  payload: SprayReportPayloadV1 | null;
  error: string | null;
}

/** Authenticated, membership-checked canonical report read. */
export async function fetchSprayReportV1(tripId: string): Promise<FetchSprayReportResult> {
  const { data, error } = await (supabase as any).rpc("get_spray_report_v1", {
    p_trip_id: tripId,
  });
  if (error) return { payload: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { payload: null, error: SPRAY_RECORD_UNAVAILABLE_MESSAGE };
  const parsed = parseSprayReportPayload(row);
  if (!parsed.payload) {
    return { payload: null, error: `Spray report payload rejected: ${parsed.errors[0]}` };
  }
  return { payload: parsed.payload, error: null };
}

/**
 * A trip is spraying when trip_function = 'spraying' OR a non-template,
 * non-deleted spray record links to it. Linked legacy spray records are
 * spraying trips and must never be exported through the generic Trip Report.
 */
export function isSprayingTrip(input: {
  tripFunction?: string | null;
  hasLinkedSprayRecord?: boolean | null;
}): boolean {
  return (
    (input.tripFunction ?? "").toLowerCase() === "spraying" ||
    input.hasLinkedSprayRecord === true
  );
}

/** Shared filename component sanitization (contract §Report and filename). */
export function sanitizeFilenameComponent(
  value: string | null | undefined,
  fallback: string,
): string {
  const base = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  return base || fallback;

}

/** Trip start date (YYYY-MM-DD) in the vineyard timezone. */
export function tripStartDateInVineyardTz(
  startUtc: string | null | undefined,
  timeZone: string,
): string {
  if (!startUtc) return "undated";
  const d = new Date(startUtc);
  if (isNaN(d.getTime())) return "undated";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function sprayReportFilename(
  payload: SprayReportPayloadV1,
  platform: "ios" | "android" | "portal" = "portal",
): string {
  const vineyard = sanitizeFilenameComponent(payload.identity.vineyardName, "Vineyard");
  const date = tripStartDateInVineyardTz(
    payload.trip.startUtc,
    payload.identity.vineyardTimeZone,
  );
  const reference = sanitizeFilenameComponent(payload.identity.reference, "Spray");
  const short = (payload.identity.tripId ?? "").slice(0, 8);
  return `SprayReport_${vineyard}_${date}_${reference}_${short}-${platform}.pdf`;
}
