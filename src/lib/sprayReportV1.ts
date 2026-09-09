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

export type SprayRowStatus = "Complete" | "Partial" | "Skipped/Not complete" | "Not recorded";
export type SprayChemicalUnit = "Litres" | "mL" | "Kg" | "g";
export type SprayUsageKind = "planned" | "substitution" | "additional";
export type SprayMatchSource =
  | "plannedChemicalId"
  | "savedChemicalId"
  | "nameUnit"
  | "notRecorded"
  | "ambiguous"
  | "actualOnly";
export type SprayWeatherSourceKind = "observed" | "modelled" | "manual" | "unavailable";
export type SprayWeatherRetrievalMode =
  | "live"
  | "historical_archive"
  | "legacy_snapshot"
  | "unavailable";

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
  elapsedDurationSeconds?: number | null;
  pausedDurationSeconds?: number | null;
  distanceMetres: number | null;
  operatorId?: string | null;
  operatorName: string | null;
  operatorSource?: string;
  pinCount: number;
}

export interface SprayReportBlock {
  blockId: string;
  name: string;
  grossAreaHa?: number | null;
  treatedAreaHa?: number | null;
}

export interface SprayReportEquipment {
  machineId?: string | null;
  tractorId?: string | null;
  tractorName: string | null;
  sprayEquipmentId?: string | null;
  sprayUnitName: string | null;
  equipmentSource?: string;
  startEngineHours: number | null;
  endEngineHours: number | null;
  engineHoursUsed: number | null;
  tractorGear?: string | null;
  numberOfFansJets?: string | null;
  averageSpeedKmh?: number | null;
  fuelConsumptionLPerHour?: number | null;
  fuelConsumptionSource?: string;
  fuelHours?: number | null;
  fuelHoursSource?: string;
}

/** Canonical application facts (schema 1.1). */
export interface SprayReportApplication {
  operationType: string | null;
  applicationMode: string | null;
  grossAreaHa: number | null;
  treatedAreaHa: number | null;
  treatedAreaMethod: string | null;
  geometrySource: string | null;
  geometryQuality: string | null;
  carrierVolumeBasis: string | null;
  totalCarrierLitres: number | null;
  carrierLitresPerHectare: number | null;
  diluteLitresPer100m: number | null;
  appliedLitresPer100m: number | null;
  concentrationFactor: number | null;
  notes: string | null;
  /** Schema 1.2: "manually_recorded_actual_use" for a manual entry. */
  actualUseBasis?: string | null;
}

export const MANUAL_ACTUAL_USE_BASIS = "manually_recorded_actual_use";

export interface SprayReportProgramStep {
  linkState: "program_linked" | "linked_step_unavailable" | "not_recorded";
  sprayJobId: string | null;
  name: string | null;
  status: string | null;
  plannedDate: string | null;
  operationType: string | null;
  target: string | null;
  notes: string | null;
}

export interface SprayReportRow {
  rowIdentity?: string | null;
  rowNumber: number | null;
  blockId?: string | null;
  blockName: string | null;
  status: SprayRowStatus;
  source: string;
  confidence?: number | null;
  isDerived?: boolean;
  tank: number | "Multiple" | null;
  tankSessionId?: string | null;
  originalEvidence?: Record<string, unknown> | null;
}

export interface SprayReportTankChemical {
  actualChemicalId?: string | null;
  plannedChemicalId: string | null;
  savedChemicalId: string | null;
  replacesPlannedChemicalId?: string | null;
  usageKind?: SprayUsageKind;
  name: string;
  unit: SprayChemicalUnit;
  plannedAmountBase: number | null;
  actualAmountBase: number | null;
  matchSource: SprayMatchSource;
}

export interface SprayReportTank {
  tankNumber: number;
  /** Existing actual row id, or null when no actual has been recorded yet. */
  actualId?: string | null;
  /** Optimistic-concurrency version; 0 means no actual row exists. */
  actualVersion?: number;
  /** Null for a manual entry: there is no plan, and null must never become 0. */
  plannedWaterLitres: number | null;
  actualWaterLitres: number | null;
  chemicals: SprayReportTankChemical[];
}

export interface SprayReportTankSession {
  tankSessionId: string | null;
  tankNumber: number;
  startedAt: string | null;
  endedAt: string | null;
  startRow: number | null;
  endRow: number | null;
  pathsCovered: number[];
  status: "Complete" | "End not recorded" | "In progress";
  assignmentSource: string;
}

export interface SprayReportChemicalTotal {
  identityKey: string;
  name: string;
  unit: "Litres" | "Kg";
  actualAmountBase: number;
}

export interface SprayReportWeather {
  sampleSlot: string;
  observedAt: string | null;
  source: string;
  sourceKind: SprayWeatherSourceKind;
  stationId?: string | null;
  isStale: boolean;
  temperatureC: number | null;
  humidityPct: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  windDirectionText?: string | null;
  rainMm: number | null;
  retrievalMode?: SprayWeatherRetrievalMode;
  providerRecordId?: string | null;
  retrievedAt?: string | null;
}

export interface SprayReportRoute {
  bucket: string;
  objectPath: string;
  sha256: string;
  routeHash: string;
  styleVersion: string;
}

/** Server-authored audit entry for a corrected actual quantity. */
export interface SprayReportActualAmendment {
  id: string;
  operationId: string;
  tankNumber: number;
  chemicalActualId?: string | null;
  plannedChemicalId?: string | null;
  savedChemicalId?: string | null;
  field: string;
  changeKind: string;
  previousValue?: unknown;
  newValue?: unknown;
  previousUnit?: string | null;
  newUnit?: string | null;
  revision: number;
  editedBy: string;
  editorName: string;
  editedAt: string;
}

/** Server-authored audit entry for a trip metadata correction. */
export interface SprayReportMetadataAmendment {
  id: string;
  operationId: string;
  revision: number;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  editedBy: string;
  editorName: string;
  editedAt: string;
}

/**
 * Explicit application provenance (schema 1.2). Origin is NEVER inferred:
 * a manual application is exactly `source === "manual"`.
 */
export interface SprayReportProvenance {
  source: "manual" | "tracked" | null;
  manualEntryId: string | null;
  isManualEntry: boolean;
  label: string;
}

/** Manual applications carry explicit absence labels instead of a sync error. */
export interface SprayReportRecordingEvidence {
  route: string | null;
  rows: string | null;
}

export interface SprayReportPayloadV1 {
  schemaVersion: SprayReportSchemaVersion;
  identity: SprayReportIdentity;
  trip: SprayReportTrip;
  blocks: SprayReportBlock[] | null;
  equipment: SprayReportEquipment;
  application?: SprayReportApplication | null;
  programStep?: SprayReportProgramStep | null;
  rows: SprayReportRow[];
  tanks: SprayReportTank[];
  tankSessions?: SprayReportTankSession[];
  plannedChemicalTotals?: SprayReportChemicalTotal[];
  actualChemicalTotals?: SprayReportChemicalTotal[];
  weather: SprayReportWeather[];
  route: SprayReportRoute | null;
  cost?: Record<string, unknown> | null;
  amendments?: SprayReportActualAmendment[];
  metadataCorrectionVersion?: number;
  metadataAmendments?: SprayReportMetadataAmendment[];
  /** Present from schema 1.2 onwards. */
  provenance?: SprayReportProvenance | null;
  recordingEvidence?: SprayReportRecordingEvidence | null;
  warnings: string[];
}

/** Explicitly recognised canonical schema versions. Never disable validation. */
export const SUPPORTED_SPRAY_REPORT_SCHEMA_VERSIONS = ["1.1", "1.2"] as const;
export type SprayReportSchemaVersion =
  (typeof SUPPORTED_SPRAY_REPORT_SCHEMA_VERSIONS)[number];

const PROVENANCE_SOURCES = ["manual", "tracked"];

/** Canonical manual test — never inferred from missing GPS, rows or chemicals. */
export function isManualEntryReport(
  payload: Pick<SprayReportPayloadV1, "provenance"> | null | undefined,
): boolean {
  return payload?.provenance?.isManualEntry === true;
}

export const MANUAL_ACTUAL_USE_LABEL = "Manually recorded actual use";
export const MANUAL_NOT_RECORDED_LABEL = "Not recorded — manual application";

/** CSV / mixed-export source column value. */
export function sprayReportSourceLabel(
  payload: Pick<SprayReportPayloadV1, "provenance"> | null | undefined,
): string {
  const source = payload?.provenance?.source ?? null;
  if (source === "manual") return "Manual entry";
  if (source === "tracked") return "Tracked application";
  return "Origin not recorded";
}


export interface SprayReportParseResult {
  payload: SprayReportPayloadV1 | null;
  errors: string[];
}

const ROW_STATUSES: SprayRowStatus[] = [
  "Complete",
  "Partial",
  "Skipped/Not complete",
  "Not recorded",
];
const UNITS: SprayChemicalUnit[] = ["Litres", "mL", "Kg", "g"];
const MATCH_SOURCES: SprayMatchSource[] = [
  "plannedChemicalId",
  "savedChemicalId",
  "nameUnit",
  "notRecorded",
  "ambiguous",
  "actualOnly",
];
const USAGE_KINDS: SprayUsageKind[] = ["planned", "substitution", "additional"];
const SOURCE_KINDS: SprayWeatherSourceKind[] = [
  "observed",
  "modelled",
  "manual",
  "unavailable",
];
const SESSION_STATUSES = ["Complete", "End not recorded", "In progress"];

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
  if (!SUPPORTED_SPRAY_REPORT_SCHEMA_VERSIONS.includes(raw.schemaVersion)) {
    errors.push("Unsupported schemaVersion");
  }

  // Schema 1.2 provenance. Validated, never defaulted: an unreadable
  // provenance block must block the export rather than be guessed at.
  if (raw.provenance != null) {
    if (!isObj(raw.provenance)) errors.push("provenance must be an object or null");
    else {
      const p = raw.provenance;
      if (!(p.source === null || PROVENANCE_SOURCES.includes(p.source)))
        errors.push("provenance.source is invalid");
      if (typeof p.isManualEntry !== "boolean")
        errors.push("provenance.isManualEntry must be a boolean");
      if (typeof p.label !== "string" || !p.label) errors.push("provenance.label is required");
      if (!(p.manualEntryId === null || typeof p.manualEntryId === "string"))
        errors.push("provenance.manualEntryId is invalid");
      if (p.isManualEntry === true && !p.manualEntryId)
        errors.push("provenance.manualEntryId is required for a manual entry");
      if (p.isManualEntry === true && p.source !== "manual")
        errors.push("provenance.source must be manual for a manual entry");
    }
  }
  if (raw.recordingEvidence != null) {
    if (!isObj(raw.recordingEvidence)) errors.push("recordingEvidence must be an object or null");
    else
      for (const k of ["route", "rows"]) {
        const v = raw.recordingEvidence[k];
        if (!(v === null || typeof v === "string")) errors.push(`recordingEvidence.${k} is invalid`);
      }
  }

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

  if (raw.application != null && !isObj(raw.application))
    errors.push("application must be an object or null");
  if (raw.programStep != null && !isObj(raw.programStep))
    errors.push("programStep must be an object or null");

  if (raw.blocks != null && !Array.isArray(raw.blocks)) errors.push("blocks must be an array or null");
  if (!Array.isArray(raw.rows)) errors.push("rows must be an array");
  else
    raw.rows.forEach((r: any, i: number) => {
      if (!isObj(r)) return errors.push(`rows[${i}] is not an object`);
      if (!(r.rowNumber == null || typeof r.rowNumber === "number"))
        errors.push(`rows[${i}].rowNumber must be a number`);
      if (!ROW_STATUSES.includes(r.status)) errors.push(`rows[${i}].status is invalid`);
      if (typeof r.source !== "string") errors.push(`rows[${i}].source must be a string`);
      if (r.confidence != null && (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1))
        errors.push(`rows[${i}].confidence is invalid`);
      if (!(r.tank == null || r.tank === "Multiple" || typeof r.tank === "number"))
        errors.push(`rows[${i}].tank is invalid`);
    });

  if (!Array.isArray(raw.tanks)) errors.push("tanks must be an array");
  else
    raw.tanks.forEach((t: any, i: number) => {
      if (!isObj(t)) return errors.push(`tanks[${i}] is not an object`);
      if (typeof t.tankNumber !== "number") errors.push(`tanks[${i}].tankNumber must be a number`);
      if (t.actualVersion != null && typeof t.actualVersion !== "number")
        errors.push(`tanks[${i}].actualVersion must be a number`);
      // Manual entries have no plan: null stays null and is never read as zero.
      if (!(t.plannedWaterLitres === null || typeof t.plannedWaterLitres === "number"))
        errors.push(`tanks[${i}].plannedWaterLitres is invalid`);
      if (!Array.isArray(t.chemicals)) return errors.push(`tanks[${i}].chemicals must be an array`);
      t.chemicals.forEach((c: any, ci: number) => {
        if (!isObj(c)) return errors.push(`tanks[${i}].chemicals[${ci}] is not an object`);
        if (!UNITS.includes(c.unit)) errors.push(`tanks[${i}].chemicals[${ci}].unit is invalid`);
        if (!MATCH_SOURCES.includes(c.matchSource))
          errors.push(`tanks[${i}].chemicals[${ci}].matchSource is invalid`);
        if (c.usageKind != null && !USAGE_KINDS.includes(c.usageKind))
          errors.push(`tanks[${i}].chemicals[${ci}].usageKind is invalid`);
        for (const k of ["plannedAmountBase", "actualAmountBase"]) {
          if (!(c[k] === null || typeof c[k] === "number"))
            errors.push(`tanks[${i}].chemicals[${ci}].${k} is invalid`);
        }
      });
    });

  if (raw.tankSessions != null) {
    if (!Array.isArray(raw.tankSessions)) errors.push("tankSessions must be an array");
    else
      raw.tankSessions.forEach((s: any, i: number) => {
        if (!isObj(s)) return errors.push(`tankSessions[${i}] is not an object`);
        if (typeof s.tankNumber !== "number")
          errors.push(`tankSessions[${i}].tankNumber must be a number`);
        if (!SESSION_STATUSES.includes(s.status))
          errors.push(`tankSessions[${i}].status is invalid`);
      });
  }

  for (const key of ["plannedChemicalTotals", "actualChemicalTotals"] as const) {
    const list = (raw as any)[key];
    if (list == null) continue;
    if (!Array.isArray(list)) {
      errors.push(`${key} must be an array`);
      continue;
    }
    list.forEach((t: any, i: number) => {
      if (!isObj(t)) return errors.push(`${key}[${i}] is not an object`);
      if (typeof t.identityKey !== "string" || !t.identityKey)
        errors.push(`${key}[${i}].identityKey is required`);
      if (t.unit !== "Litres" && t.unit !== "Kg") errors.push(`${key}[${i}].unit is invalid`);
      if (typeof t.actualAmountBase !== "number")
        errors.push(`${key}[${i}].actualAmountBase must be a number`);
    });
  }

  if (raw.amendments != null && !Array.isArray(raw.amendments))
    errors.push("amendments must be an array");
  if (raw.metadataAmendments != null && !Array.isArray(raw.metadataAmendments))
    errors.push("metadataAmendments must be an array");
  if (raw.metadataCorrectionVersion != null && typeof raw.metadataCorrectionVersion !== "number")
    errors.push("metadataCorrectionVersion must be a number");

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
