// Worksheet save orchestration: the whole draft is validated and frozen before
// any write, the write is ONE transaction, and a retry re-issues the identical
// request instead of creating a second amendment.
//
// Only the network boundary (the shared client's `rpc`) is mocked — the
// production plan/attempt/save functions run for real.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "../../docs/fixtures/spray-report-v1-stockmans-ridge.json";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } },
}));

import { parseSprayReportPayload, type SprayReportPayloadV1 } from "@/lib/sprayReportV1";
import { draftFromPayload, type ActualsDraft } from "@/lib/sprayActuals";
import {
  buildSavePlan,
  createSaveAttempt,
  planIsEmpty,
  runSaveAttempt,
  isUncertainFailure,
  type MetadataFormValues,
} from "@/lib/spraySaveOrchestration";
import { WorksheetSaveUnavailableError } from "@/lib/sprayWorksheetTransaction";

beforeEach(() => vi.clearAllMocks());

function basePayload(): SprayReportPayloadV1 {
  const parsed = parseSprayReportPayload(JSON.parse(JSON.stringify(fixture)));
  if (!parsed.payload) throw new Error("fixture did not parse");
  const p = parsed.payload;
  if (p.tanks.length === 1) {
    const second = JSON.parse(JSON.stringify(p.tanks[0]));
    second.tankNumber = 2;
    p.tanks.push(second);
  }
  return p;
}

function form(p: SprayReportPayloadV1, over: Partial<MetadataFormValues> = {}): MetadataFormValues {
  return {
    machineId: p.equipment.machineId ?? null,
    sprayEquipmentId: p.equipment.sprayEquipmentId ?? null,
    operatorUserId: p.trip.operatorId ?? null,
    fuelRateText:
      p.equipment.fuelConsumptionSource === "explicit_correction" &&
      p.equipment.fuelConsumptionLPerHour != null
        ? String(p.equipment.fuelConsumptionLPerHour)
        : "",
    startHoursText: p.equipment.startEngineHours != null ? String(p.equipment.startEngineHours) : "",
    endHoursText: p.equipment.endEngineHours != null ? String(p.equipment.endEngineHours) : "",
    ...over,
  };
}

function editWater(p: SprayReportPayloadV1, values: Record<number, string>): ActualsDraft {
  const d = draftFromPayload(p);
  for (const [tank, v] of Object.entries(values)) d.water[Number(tank)] = v;
  return d;
}

const ok = { data: { metadata: { correction: { version: 3 }, report: null }, tankCount: 1 }, error: null };
const netFail = { data: null, error: { message: "TypeError: Failed to fetch" } };
const staleTank = {
  data: null,
  error: { message: "WORKSHEET_VERSION_CONFLICT: this trip was changed by someone else.", code: "PT409" },
};
const notDeployed = {
  data: null,
  error: { message: "Could not find the function public.save_spray_trip_worksheet_v1", code: "PGRST202" },
};
const denied = { data: null, error: { message: "Not authorised for this vineyard", code: "42501" } };

const call = (i = 0) => rpc.mock.calls[i] as [string, any];

describe("plan construction", () => {
  it("skips unchanged metadata and unchanged tanks", () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p));
    expect(plan.errors).toEqual([]);
    expect(plan.metadata).toBeNull();
    expect(plan.tanks.map((t) => t.tankNumber)).toEqual([1]);
    expect(planIsEmpty(buildSavePlan(p, draftFromPayload(p), form(p)))).toBe(true);
  });

  it("validates the whole draft before any write is issued", () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "abc", 2: "1400" }), form(p, { fuelRateText: "0" }));
    expect(plan.errors.length).toBeGreaterThan(1);
    expect(plan.metadata).toBeNull();
    expect(plan.tanks).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives every tank its own stable correction operation id", () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400", 2: "1300" }), form(p));
    const ids = plan.tanks.map((t) => t.operationId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(plan.worksheetOperationId);
  });
});

describe("one transaction per Save", () => {
  it("sends metadata and every tank in a single request", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400", 2: "1300" }), form(p, { startHoursText: "120" }));
    rpc.mockResolvedValue(ok);
    const s = await runSaveAttempt(createSaveAttempt(plan));

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = call();
    expect(fn).toBe("save_spray_trip_worksheet_v1");
    expect(args.p_trip_id).toBe(p.identity.tripId);
    expect(args.p_metadata.operationId).toBe(plan.metadata!.operationId);
    expect(args.p_tanks.map((t: any) => t.tankNumber)).toEqual([1, 2]);
    // Existing identities are preserved, never regenerated.
    expect(args.p_tanks[0].actualId).toBe(plan.tanks[0].snapshot.actualId);
    expect(args.p_tanks[0].expectedVersion).toBe(plan.tanks[0].snapshot.expectedVersion);
    expect(s.allSaved).toBe(true);
    expect(s.message).toBe("Your changes have been saved.");
    expect(s.metadataVersion).toBe(3);
  });

  it("saves metadata only, without any tank correction", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, draftFromPayload(p), form(p, { startHoursText: "120", endHoursText: "124" }));
    rpc.mockResolvedValue(ok);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(call()[1].p_tanks).toEqual([]);
    expect(s.allSaved).toBe(true);
  });

  it("saves actuals only, without any metadata correction", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p));
    rpc.mockResolvedValue(ok);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(call()[1].p_metadata).toBeNull();
    expect(s.allSaved).toBe(true);
  });

  it("never calls the per-operation correction RPCs directly (regression: stale saver wiring)", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400", 2: "1300" }), form(p, { startHoursText: "120" }));
    rpc.mockResolvedValue(ok);
    await runSaveAttempt(createSaveAttempt(plan));
    const fns = rpc.mock.calls.map(([fn]) => fn);
    expect(fns).toEqual(["save_spray_trip_worksheet_v1"]);
    expect(fns).not.toContain("correct_spray_tank_actual_v1");
    expect(fns).not.toContain("correct_spray_trip_metadata_v1");
  });
});

describe("nothing half-commits", () => {
  it("a stale tank version leaves metadata and every other tank untouched", async () => {
    const p = basePayload();
    const plan = buildSavePlan(
      p,
      editWater(p, { 1: "1400", 2: "1300" }),
      form(p, { startHoursText: "120" }),
    );
    rpc.mockResolvedValue(staleTank);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(s.anySaved).toBe(false);
    expect(s.saved).toEqual([]);
    expect(s.conflicts).toEqual(["Trip details", "Tank 1", "Tank 2"]);
    expect(s.message.toLowerCase()).toContain("changed by someone else");
  });

  it("an authorisation failure writes nothing", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p, { startHoursText: "120" }));
    rpc.mockResolvedValue(denied);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(s.anySaved).toBe(false);
    expect(s.unresolved).toEqual(["Trip details", "Tank 1"]);
  });

  it("reports unavailability instead of writing anything", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p, { startHoursText: "120" }));
    rpc.mockResolvedValue(notDeployed);
    await expect(runSaveAttempt(createSaveAttempt(plan))).rejects.toBeInstanceOf(
      WorksheetSaveUnavailableError,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("committed-but-response-lost", () => {
  it("treats a dropped connection as uncertain, not unsaved", async () => {
    expect(isUncertainFailure(new Error("Failed to fetch"))).toBe(true);
    expect(isUncertainFailure(new Error("duplicate key"))).toBe(false);
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p));
    rpc.mockResolvedValue(netFail);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(s.uncertain).toEqual(["Tank 1"]);
    expect(s.message).toContain("may already be saved");
    expect(s.message).not.toContain("Your changes have not been saved");
  });

  it("retries with the identical payload and the same operation ids", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400", 2: "1300" }), form(p, { startHoursText: "120" }));
    const attempt = createSaveAttempt(plan);
    rpc.mockResolvedValueOnce(netFail);
    await runSaveAttempt(attempt);
    const first = call(0)[1];

    rpc.mockResolvedValue(ok);
    const second = await runSaveAttempt(attempt);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(call(1)[1]).toEqual(first);
    expect(second.allSaved).toBe(true);

    // A third press after confirmation issues no further correction at all.
    await runSaveAttempt(attempt);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
