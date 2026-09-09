// Worksheet save orchestration: the whole draft is validated and frozen before
// any write, outcomes are tracked per operation, and a retry re-issues the
// identical request instead of creating a new correction.
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

const ok = { data: { correction: { version: 3 }, report: null }, error: null };
const netFail = { data: null, error: { message: "TypeError: Failed to fetch" } };
const hardFail = { data: null, error: { message: "boom", code: "P0001" } };
const conflict = { data: null, error: { message: "version conflict", code: "40001" } };

describe("plan construction", () => {
  it("skips unchanged metadata and unchanged tanks", () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p));
    expect(plan.errors).toEqual([]);
    expect(plan.metadata).toBeNull();
    expect(plan.tanks.map((t) => t.tankNumber)).toEqual([1]);
    expect(planIsEmpty(buildSavePlan(p, draftFromPayload(p), form(p)))).toBe(true);
  });

  it("validates the whole draft before any write is issued", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "abc", 2: "1400" }), form(p, { fuelRateText: "0" }));
    expect(plan.errors.length).toBeGreaterThan(1);
    expect(plan.metadata).toBeNull();
    expect(plan.tanks).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("partial outcomes", () => {
  it("reports metadata saved and a tank still to save, never 'not saved'", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p, { startHoursText: "120" }));
    rpc.mockResolvedValueOnce(ok).mockResolvedValueOnce(hardFail);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(s.saved).toEqual(["Trip details"]);
    expect(s.unresolved).toEqual(["Tank 1"]);
    expect(s.anySaved).toBe(true);
    expect(s.allSaved).toBe(false);
    expect(s.message).toContain("Saved: Trip details.");
    expect(s.message).toContain("Still to save: Tank 1");
    expect(s.message).not.toContain("Your changes have not been saved");
  });

  it("separates Tank 1 success from Tank 2 failure", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400", 2: "1300" }), form(p));
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce(hardFail);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(s.saved).toEqual(["Tank 1"]);
    expect(s.unresolved).toEqual(["Tank 2"]);
  });
});

describe("committed-but-response-lost", () => {
  it("treats a dropped connection as uncertain, not unsaved", async () => {
    expect(isUncertainFailure(new Error("Failed to fetch"))).toBe(true);
    expect(isUncertainFailure(new Error("duplicate key"))).toBe(false);
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p));
    rpc.mockResolvedValueOnce(netFail);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(s.uncertain).toEqual(["Tank 1"]);
    expect(s.message).toContain("may already be saved");
    expect(s.message).not.toContain("Your changes have not been saved");
  });

  it("retries with the identical request and operation id", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400", 2: "1300" }), form(p));
    const attempt = createSaveAttempt(plan);
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce(netFail);
    await runSaveAttempt(attempt);
    const firstTank2 = (rpc.mock.calls[1] as [string, any])[1];

    rpc.mockResolvedValue({ data: null, error: null });
    const second = await runSaveAttempt(attempt);
    // Tank 1 was confirmed: it is not resubmitted.
    expect(rpc.mock.calls.length).toBe(3);
    const retried = (rpc.mock.calls[2] as [string, any])[1];
    expect(retried).toEqual(firstTank2);
    expect(second.allSaved).toBe(true);
    expect(second.message).toBe("Your changes have been saved.");
  });
});

describe("version conflicts", () => {
  it("refuses to overwrite a newer record and says so", async () => {
    const p = basePayload();
    const plan = buildSavePlan(p, editWater(p, { 1: "1400" }), form(p));
    rpc.mockResolvedValueOnce(conflict);
    const s = await runSaveAttempt(createSaveAttempt(plan));
    expect(s.conflicts).toEqual(["Tank 1"]);
    expect(s.anySaved).toBe(false);
    expect(s.message.toLowerCase()).toContain("changed by someone else");
  });
});
