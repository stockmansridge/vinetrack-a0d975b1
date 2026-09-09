// Manual spray — edit hydration and coordinated deletion.
//
// These exercise the production loader and delete adapter; only the network
// boundary (the shared client) is mocked.
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

import { loadManualSprayDraft, MANUAL_NOT_MANUAL_MESSAGE } from "@/lib/manualSpray/load";
import { removeTank } from "@/lib/manualSpray/domain";
import { deleteManualSpray, freezeManualSprayAttempt } from "@/lib/manualSpray/contract";

const RECORD_ID = "rec-1";
const TRIP_ID = "trip-1";

const record = {
  id: RECORD_ID,
  vineyard_id: "vin-1",
  trip_id: TRIP_ID,
  entry_source: "manual",
  manual_entry_id: "man-1",
  sync_version: 4,
  spray_reference: "Block 3 fungicide",
  tanks: [
    {
      id: "tank-client-1",
      tankNumber: 1,
      actualId: "actual-1",
      chemicals: [{ id: "line-1", savedChemicalId: "chem-1", physicalForm: "liquid" }],
    },
    { id: "tank-client-2", tankNumber: 2, actualId: "actual-2", chemicals: [] },
  ],
};

const report = {
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
  application: { operationType: "manual_spray", applicationMode: null, grossAreaHa: null, treatedAreaHa: null, treatedAreaMethod: null, geometrySource: null, geometryQuality: null, carrierVolumeBasis: null, totalCarrierLitres: null, carrierLitresPerHectare: null, diluteLitresPer100m: null, appliedLitresPer100m: null, concentrationFactor: null, notes: "Windy but fine", actualUseBasis: "manually_recorded_actual_use" },
  rows: [],
  tanks: [
    {
      tankNumber: 1,
      actualId: "actual-1",
      plannedWaterLitres: null,
      actualWaterLitres: 800,
      chemicals: [
        {
          actualChemicalId: "ac-1",
          plannedChemicalId: null,
          savedChemicalId: "chem-1",
          name: "Sulphur",
          unit: "Kg",
          plannedAmountBase: null,
          actualAmountBase: 2000,
          matchSource: "actualOnly",
        },
      ],
    },
    {
      tankNumber: 2,
      actualId: "actual-2",
      plannedWaterLitres: null,
      actualWaterLitres: 400,
      chemicals: [],
    },
  ],
  weather: [
    {
      sampleSlot: "start",
      observedAt: "2026-03-01T00:00:00.000Z",
      source: "Operator observation",
      sourceKind: "manual",
      isStale: false,
      temperatureC: 21,
      humidityPct: 55,
      windSpeedKmh: 8,
      windGustKmh: null,
      windDirectionDeg: 180,
      rainMm: null,
    },
  ],
  route: null,
  provenance: { source: "manual", manualEntryId: "man-1", isManualEntry: true, label: "Manual entry" },
  recordingEvidence: { route: "Not recorded — manual application", rows: "Not recorded — manual application" },
  warnings: [],
};

beforeEach(() => {
  rpc.mockReset();
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: record, error: null });
  rpc.mockResolvedValue({ data: report, error: null });
});

describe("loadManualSprayDraft", () => {
  it("reuses the saved identities and current version", async () => {
    const { draft, error } = await loadManualSprayDraft(RECORD_ID);
    expect(error).toBeNull();
    expect(draft).toBeTruthy();
    expect(draft!.sprayRecordId).toBe(RECORD_ID);
    expect(draft!.manualEntryId).toBe("man-1");
    expect(draft!.tripId).toBe(TRIP_ID);
    expect(draft!.syncVersion).toBe(4);
    expect(draft!.tanks[0].id).toBe("tank-client-1");
    expect(draft!.tanks[0].actualId).toBe("actual-1");
    expect(draft!.tanks[0].chemicals[0].id).toBe("line-1");
  });

  it("restores quantities, equipment, blocks, notes and manual weather", async () => {
    const { draft } = await loadManualSprayDraft(RECORD_ID);
    expect(draft!.tanks[0].waterLitres).toBe(800);
    // 2000 g displayed in the recorded unit, Kg.
    expect(draft!.tanks[0].chemicals[0].amount).toBe(2);
    expect(draft!.tanks[0].chemicals[0].unit).toBe("Kg");
    expect(draft!.tractorId).toBe("tr-1");
    expect(draft!.operatorUserId).toBe("user-1");
    expect(draft!.sprayEquipmentId).toBe("sp-1");
    expect(draft!.startEngineHours).toBe(10);
    expect(draft!.blockIds).toEqual(["blk-1"]);
    expect(draft!.notes).toBe("Windy but fine");
    expect(draft!.weather[0]).toMatchObject({ temperature: 21, humidity: 55, windSpeed: 8 });
  });

  it("refuses a record that is not a manual entry", async () => {
    maybeSingle.mockResolvedValue({ data: { ...record, entry_source: "tracked" }, error: null });
    const { draft, error } = await loadManualSprayDraft(RECORD_ID);
    expect(draft).toBeNull();
    expect(error).toBe(MANUAL_NOT_MANUAL_MESSAGE);
  });

  it("removing Tank 1 keeps Tank 2's identities and renumbers it", async () => {
    const { draft } = await loadManualSprayDraft(RECORD_ID);
    const tanks = removeTank(draft!.tanks, "tank-client-1");
    expect(tanks).toHaveLength(1);
    expect(tanks[0].id).toBe("tank-client-2");
    expect(tanks[0].actualId).toBe("actual-2");
    expect(tanks[0].displayNumber).toBe(1);
  });

  it("an edit save keeps the loaded identities and expected version", async () => {
    const { draft } = await loadManualSprayDraft(RECORD_ID);
    const attempt = freezeManualSprayAttempt(draft!, "op-edit-1");
    expect(attempt.expectedVersion).toBe(4);
    expect(attempt.payload.manualEntryId).toBe("man-1");
    expect(attempt.payload.sprayRecordId).toBe(RECORD_ID);
    expect(attempt.payload.tripId).toBe(TRIP_ID);
    expect(attempt.payload.tanks[0].actualId).toBe("actual-1");
  });
});

describe("coordinated delete", () => {
  const req = {
    operationId: "op-del-1",
    vineyardId: "vin-1",
    manualEntryId: "man-1",
    sprayRecordId: RECORD_ID,
    tripId: TRIP_ID,
  };

  it("sends every identity through the shared function", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const out = await deleteManualSpray(req);
    expect(out.kind).toBe("saved");
    expect(rpc).toHaveBeenCalledWith("delete_manual_spray_v1", {
      p_operation_id: "op-del-1",
      p_vineyard_id: "vin-1",
      p_manual_entry_id: "man-1",
      p_spray_record_id: RECORD_ID,
      p_trip_id: TRIP_ID,
    });
  });

  it("repeating the same deletion resolves as deleted, not as an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "tombstone" } });
    const out = await deleteManualSpray(req);
    expect(out.kind).toBe("saved");
  });

  it("a dropped connection is reported as uncertain, never as failed", async () => {
    rpc.mockRejectedValue(new Error("Failed to fetch"));
    const out = await deleteManualSpray(req);
    expect(out.kind).toBe("uncertain");
  });
});
