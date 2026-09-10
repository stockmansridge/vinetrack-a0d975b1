// Manual spray — correction-only edits must not rewrite recorded evidence.
//
// Loading a saved application and saving it again preserves the observation
// exactly: station observations keep their provenance, every manual field
// (including gust, rain, observed time and source) survives, and editing only
// the notes leaves the weather and the saved operation type untouched.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: () => maybeSingle() }) }),
      }),
    }),
  },
}));

import { loadManualSprayDraft } from "@/lib/manualSpray/load";
import { toManualSprayPayload } from "@/lib/manualSpray/contract";

const RECORD_ID = "rec-1";
const TRIP_ID = "trip-1";

const record = {
  id: RECORD_ID,
  vineyard_id: "vin-1",
  trip_id: TRIP_ID,
  entry_source: "manual",
  manual_entry_id: "man-1",
  sync_version: 4,
  tanks: [{ id: "tank-client-1", tankNumber: 1, actualId: "actual-1", chemicals: [] }],
};

const baseReport = {
  schemaVersion: "1.2",
  identity: {
    tripId: TRIP_ID,
    sprayRecordId: RECORD_ID,
    vineyardId: "vin-1",
    vineyardName: "Test",
    reference: "Block 3 fungicide",
    vineyardTimeZone: "Australia/Adelaide",
  },
  trip: {
    startUtc: "2026-03-01T00:00:00.000Z",
    endUtc: "2026-03-01T03:00:00.000Z",
    activeDurationSeconds: null,
    distanceMetres: null,
    operatorId: "user-1",
    operatorName: "Sam",
    pinCount: 0,
  },
  blocks: [{ blockId: "blk-1", name: "Block 3" }],
  equipment: {
    tractorId: "tr-1",
    tractorName: "Deere",
    sprayEquipmentId: "sp-1",
    sprayUnitName: "Sprayer",
    startEngineHours: 10,
    endEngineHours: 12,
    engineHoursUsed: 2,
  },
  application: {
    operationType: "foliar",
    applicationMode: null,
    grossAreaHa: null,
    treatedAreaHa: null,
    treatedAreaMethod: null,
    geometrySource: null,
    geometryQuality: null,
    carrierVolumeBasis: null,
    totalCarrierLitres: null,
    carrierLitresPerHectare: null,
    diluteLitresPer100m: null,
    appliedLitresPer100m: null,
    concentrationFactor: null,
    notes: "Original note",
    actualUseBasis: "manually_recorded_actual_use",
  },
  rows: [],
  tanks: [
    {
      tankNumber: 1,
      actualId: "actual-1",
      plannedWaterLitres: null,
      actualWaterLitres: 800,
      chemicals: [],
    },
  ],
  weather: [] as unknown[],
  route: null,
  provenance: { source: "manual", manualEntryId: "man-1", isManualEntry: true, label: "Manual entry" },
  recordingEvidence: { route: "Not recorded — manual application", rows: "Not recorded — manual application" },
  warnings: [],
};

const stationObservation = {
  sampleSlot: "start",
  observedAt: "2026-03-01T00:05:00.000Z",
  source: "Davis station — North shed",
  sourceKind: "station",
  stationId: "stn-9",
  isStale: false,
  temperatureC: 19,
  humidityPct: 62,
  windSpeedKmh: 11,
  windGustKmh: 18,
  windDirectionDeg: 90,
  rainMm: 0,
};

const manualObservation = {
  sampleSlot: "start",
  observedAt: "2026-03-01T00:10:00.000Z",
  source: "Operator observation",
  sourceKind: "manual",
  isStale: false,
  temperatureC: 21,
  humidityPct: 55,
  windSpeedKmh: 0,
  windGustKmh: 0,
  windDirectionDeg: 180,
  rainMm: 0,
};

const withWeather = (weather: unknown[]) => ({ ...baseReport, weather });

beforeEach(() => {
  rpc.mockReset();
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: record, error: null });
});

describe("manual spray weather round trip", () => {
  it("keeps a station-only observation as station evidence, never as a manual one", async () => {
    rpc.mockResolvedValue({ data: withWeather([stationObservation]), error: null });
    const { draft } = await loadManualSprayDraft(RECORD_ID);
    expect(draft!.weather).toHaveLength(1);
    expect(draft!.weather[0].provenance).toBe("station");
    expect(draft!.weather[0].stationId).toBe("stn-9");
    expect(draft!.weather[0].source).toBe("Davis station — North shed");

    // A station reading is not resubmitted as the operator's own observation.
    const payload = toManualSprayPayload(draft!, "2026-03-02T00:00:00.000Z");
    expect(payload.manualWeather).toBeNull();
  });

  it("preserves every manual field, including zero gust and zero rain", async () => {
    rpc.mockResolvedValue({ data: withWeather([manualObservation]), error: null });
    const { draft } = await loadManualSprayDraft(RECORD_ID);
    expect(draft!.weather[0]).toMatchObject({
      provenance: "manual",
      observedAt: "2026-03-01T00:10:00.000Z",
      source: "Operator observation",
      temperature: 21,
      humidity: 55,
      windSpeed: 0,
      windGust: 0,
      windDirection: "180",
      rain: 0,
    });

    const payload = toManualSprayPayload(draft!, "2026-03-02T00:00:00.000Z");
    expect(payload.manualWeather).toEqual({
      observedAt: "2026-03-01T00:10:00.000Z",
      source: "Operator observation",
      temperatureC: 21,
      humidityPct: 55,
      windSpeedKmh: 0,
      windGustKmh: 0,
      windDirectionDeg: 180,
      rainMm: 0,
    });
  });

  it("an unrelated notes edit changes nothing but the notes", async () => {
    rpc.mockResolvedValue({
      data: withWeather([stationObservation, manualObservation]),
      error: null,
    });
    const { draft } = await loadManualSprayDraft(RECORD_ID);
    const before = toManualSprayPayload(draft!, "2026-03-02T00:00:00.000Z");
    const after = toManualSprayPayload(
      { ...draft!, notes: "Finished after the wind dropped" },
      "2026-03-02T00:00:00.000Z",
    );

    expect(after.notes).toBe("Finished after the wind dropped");
    expect(after.manualWeather).toEqual(before.manualWeather);
    expect(after.manualWeather).toMatchObject({ windGustKmh: 0, rainMm: 0 });
    // The saved operation type is preserved, not replaced with "manual_spray".
    expect(after.operationType).toBe("foliar");
    expect({ ...after, notes: null }).toEqual({ ...before, notes: null });
  });
});
