// Manual spray entry — units, draft model, validation, permissions, contract.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } },
}));

import {
  toBaseAmount,
  fromBaseAmount,
  convertAmount,
  parseAmountText,
  sameDimension,
  unitsForForm,
} from "@/lib/manualSpray/units";
import {
  addTank,
  copyPreviousTank,
  removeTank,
  chemicalTotals,
  costingHours,
  emptyManualSprayDraft,
  newChemicalLine,
  totalWaterLitres,
} from "@/lib/manualSpray/domain";
import { validateManualSpray } from "@/lib/manualSpray/validate";
import {
  canEnterManualSpray,
  canDeleteManualSpray,
} from "@/lib/manualSpray/permissions";
import {
  toManualSprayPayload,
  saveManualSpray,
  deleteManualSpray,
  probeManualSprayContract,
  freezeManualSprayAttempt,
} from "@/lib/manualSpray/contract";
import { isManualSpraySource } from "@/components/spray/ManualEntryBadge";

beforeEach(() => vi.clearAllMocks());

const missingFn = { data: null, error: { code: "PGRST202", message: "not found" } };
const deployed = { data: null, error: null };

function completeDraft() {
  const d = emptyManualSprayDraft("vy-1");
  d.name = "Block 3 fungicide";
  d.startAt = "2026-09-08T22:30:00.000Z";
  d.endAt = "2026-09-09T01:15:00.000Z"; // crosses midnight
  d.tractorId = "tr-1";
  d.operatorUserId = "op-1";
  d.sprayEquipmentId = "sp-1";
  d.blockIds = ["b1", "b2"];
  d.tanks[0].waterLitres = 1400;
  d.tanks[0].chemicals = [
    newChemicalLine({ savedChemicalId: "c1", productName: "Sulphur", physicalForm: "solid", amount: 0.75, unit: "Kg" }),
    newChemicalLine({ savedChemicalId: "c2", productName: "Copper", physicalForm: "liquid", amount: 2.5, unit: "Litres" }),
  ];
  return d;
}

describe("units", () => {
  it("stores litres as mL and kilograms as g", () => {
    expect(toBaseAmount(2.5, "Litres")).toEqual({ base: 2500, baseUnit: "mL", dimension: "volume" });
    expect(toBaseAmount(0.75, "Kg")).toEqual({ base: 750, baseUnit: "g", dimension: "mass" });
    expect(fromBaseAmount(2500, "Litres")).toBe(2.5);
    expect(fromBaseAmount(750, "Kg")).toBe(0.75);
  });

  it("round-trips without converting twice", () => {
    const b = toBaseAmount(2.5, "Litres")!;
    expect(fromBaseAmount(b.base, "mL")).toBe(2500);
    expect(fromBaseAmount(b.base, "Litres")).toBe(2.5);
  });

  it("refuses incompatible dimensions and bad amounts", () => {
    expect(convertAmount(1, "Litres", "Kg")).toBeNull();
    expect(sameDimension("mL", "g")).toBe(false);
    expect(toBaseAmount(-1, "Litres")).toBeNull();
    expect(toBaseAmount(Number.NaN, "Litres")).toBeNull();
    expect(toBaseAmount(1, "gallons")).toBeNull();
    expect(unitsForForm("solid")).toEqual(["Kg", "g"]);
  });

  it("keeps blank distinct from zero", () => {
    expect(parseAmountText("")).toBeNull();
    expect(parseAmountText("0")).toBe(0);
    expect(parseAmountText("abc")).toBeUndefined();
    expect(toBaseAmount(0, "Litres")!.base).toBe(0);
    expect(toBaseAmount(null, "Litres")).toBeNull();
  });
});

describe("tanks", () => {
  it("adds, removes and renumbers", () => {
    let tanks = emptyManualSprayDraft("v").tanks;
    tanks = addTank(addTank(tanks));
    expect(tanks.map((t) => t.displayNumber)).toEqual([1, 2, 3]);
    tanks = removeTank(tanks, tanks[0].id);
    expect(tanks.map((t) => t.displayNumber)).toEqual([1, 2]);
  });

  it("copies the previous tank with new identities", () => {
    const d = completeDraft();
    const tanks = copyPreviousTank(d.tanks);
    expect(tanks).toHaveLength(2);
    expect(tanks[1].id).not.toBe(tanks[0].id);
    expect(tanks[1].chemicals[0].id).not.toBe(tanks[0].chemicals[0].id);
    expect(tanks[1].waterLitres).toBe(1400);
  });

  it("totals water and combines chemicals only by identity and dimension", () => {
    const d = completeDraft();
    d.tanks = copyPreviousTank(d.tanks);
    d.tanks[1].waterLitres = 1300;
    expect(totalWaterLitres(d.tanks)).toBe(2700);
    const totals = chemicalTotals(d.tanks);
    expect(totals).toHaveLength(2);
    expect(totals.find((t) => t.productName === "Sulphur")).toMatchObject({ base: 1500, baseUnit: "g" });
    expect(totals.find((t) => t.productName === "Copper")).toMatchObject({ base: 5000, baseUnit: "mL" });
  });
});

describe("validation", () => {
  it("accepts a complete draft that crosses midnight", () => {
    expect(validateManualSpray(completeDraft()).ok).toBe(true);
  });

  it("requires one tractor, one operator and one spray unit", () => {
    const d = completeDraft();
    d.tractorId = null;
    d.operatorUserId = null;
    d.sprayEquipmentId = null;
    const fields = validateManualSpray(d).violations.map((v) => v.field);
    expect(fields).toEqual(expect.arrayContaining(["tractor", "operator", "sprayUnit"]));
  });

  it("rejects end before start and an end engine reading below start", () => {
    const d = completeDraft();
    d.endAt = "2026-09-08T20:00:00.000Z";
    d.startEngineHours = 120;
    d.endEngineHours = 118;
    const fields = validateManualSpray(d).violations.map((v) => v.field);
    expect(fields).toContain("endAt");
    expect(fields).toContain("engineHours");
  });

  it("keeps engine readings optional", () => {
    const d = completeDraft();
    d.startEngineHours = null;
    d.endEngineHours = 130;
    expect(validateManualSpray(d).ok).toBe(true);
  });

  it("rejects a unit that contradicts the physical form and a missing amount", () => {
    const d = completeDraft();
    d.tanks[0].chemicals[0].unit = "Litres"; // solid product
    d.tanks[0].chemicals[1].amount = null;
    const msgs = validateManualSpray(d).violations.map((v) => v.message).join(" ");
    expect(msgs).toMatch(/is solid; use Kg or g/);
    expect(msgs).toMatch(/Enter the amount of Copper/);
  });

  it("requires water per tank and at least one block and tank", () => {
    const d = completeDraft();
    d.blockIds = [];
    d.tanks[0].waterLitres = null;
    const fields = validateManualSpray(d).violations.map((v) => v.field);
    expect(fields).toEqual(expect.arrayContaining(["blocks", "water"]));
  });
});

describe("costing hours", () => {
  it("uses the engine difference only when both are finite and end exceeds start", () => {
    expect(costingHours({ startEngineHours: 120, endEngineHours: 123.5, startAt: null, endAt: null }))
      .toEqual({ basis: "engine_hours", hours: 3.5 });
    expect(costingHours({
      startEngineHours: null, endEngineHours: 123,
      startAt: "2026-09-08T22:30:00.000Z", endAt: "2026-09-09T01:30:00.000Z",
    })).toEqual({ basis: "work_duration", hours: 3 });
    expect(costingHours({ startEngineHours: 120, endEngineHours: 120, startAt: null, endAt: null }).basis)
      .toBe("work_duration");
  });
});

describe("permissions", () => {
  it("allows owner, manager and supervisor; rejects operator", () => {
    expect(canEnterManualSpray("owner")).toBe(true);
    expect(canEnterManualSpray("manager")).toBe(true);
    expect(canEnterManualSpray("supervisor")).toBe(true);
    expect(canEnterManualSpray("operator")).toBe(false);
    expect(canDeleteManualSpray("operator")).toBe(false);
    expect(canEnterManualSpray(null)).toBe(false);
  });
});

describe("backend contract (SQL 232)", () => {
  const confirmed = (syncVersion = 1) => ({
    data: {
      operationId: "op-1",
      manualEntryId: "me-1",
      sprayRecordId: "sr-1",
      tripId: "tp-1",
      source: "manual",
      status: "completed",
      syncVersion,
      serverConfirmed: true,
    },
    error: null,
  });

  it("maps the draft to the documented camelCase payload in base units", () => {
    const d = completeDraft();
    d.blockNames = { b1: "Block 1", b2: "Block 2" };
    const p = toManualSprayPayload(d, "2026-09-09T02:00:00.000Z");
    expect(p.operationType).toBe("manual_spray");
    expect(p.manualEntryId).toBe(d.manualEntryId);
    expect(p.sprayRecordId).toBe(d.sprayRecordId);
    expect(p.tripId).toBe(d.tripId);
    expect(p.startUtc).toBe("2026-09-08T22:30:00.000Z");
    expect(p.blocks).toEqual([
      { blockId: "b1", blockName: "Block 1" },
      { blockId: "b2", blockName: "Block 2" },
    ]);
    expect(p.tanks[0].waterVolumeLitres).toBe(1400);
    expect(p.tanks[0].id).toBe(d.tanks[0].id);
    expect(p.tanks[0].actualId).toBe(d.tanks[0].actualId);
    expect(p.tanks[0].chemicals[0]).toMatchObject({
      actualAmountBase: 750, unit: "Kg", physicalForm: "solid", productCategory: null,
    });
    expect(p.tanks[0].chemicals[1]).toMatchObject({ actualAmountBase: 2500, unit: "Litres" });
    // The provisional shape must never be sent again.
    expect(p).not.toHaveProperty("application_id");
    expect(p).not.toHaveProperty("start_at");
  });

  it("sends the documented arguments and reads the returned identities", async () => {
    rpc.mockResolvedValue(confirmed(1));
    const attempt = freezeManualSprayAttempt(completeDraft(), "op-1", "2026-09-09T02:00:00.000Z");
    const out = await saveManualSpray(attempt);
    expect(out).toEqual({
      kind: "saved",
      identities: { manualEntryId: "me-1", sprayRecordId: "sr-1", tripId: "tp-1", syncVersion: 1 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as [string, any];
    expect(fn).toBe("save_manual_spray_v1");
    expect(Object.keys(args).sort()).toEqual(["p_expected_version", "p_operation_id", "p_payload"]);
    expect(args.p_operation_id).toBe("op-1");
    expect(args.p_expected_version).toBe(0);
  });

  it("never uses a mutation call as the availability check", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 405 });
    vi.stubGlobal("fetch", fetchMock);
    const status = await probeManualSprayContract();
    expect(status.available).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("retries with the identical frozen request after an uncertain response", async () => {
    const attempt = freezeManualSprayAttempt(completeDraft(), "op-9", "2026-09-09T02:00:00.000Z");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Failed to fetch" } });
    const first = await saveManualSpray(attempt);
    expect(first.kind).toBe("uncertain");

    rpc.mockResolvedValue(confirmed(1));
    const second = await saveManualSpray(attempt);
    expect(second.kind).toBe("saved");
    const sent = rpc.mock.calls.map((c) => c[1] as any);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[1].p_operation_id).toBe("op-9");
    expect(sent[1].p_payload.clientUpdatedAt).toBe("2026-09-09T02:00:00.000Z");
  });

  it("treats a response without server confirmation as uncertain, not saved", async () => {
    rpc.mockResolvedValue({ data: { manualEntryId: "me-1" }, error: null });
    const out = await saveManualSpray(freezeManualSprayAttempt(completeDraft(), "op-2"));
    expect(out.kind).toBe("uncertain");
  });

  it("distinguishes permission, missing deployment and version conflict", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });
    expect((await saveManualSpray(freezeManualSprayAttempt(completeDraft(), "o1"))).kind).toBe("denied");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } });
    expect((await saveManualSpray(freezeManualSprayAttempt(completeDraft(), "o2"))).kind).toBe("unavailable");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "stale" } });
    expect((await saveManualSpray(freezeManualSprayAttempt(completeDraft(), "o3"))).kind).toBe("conflict");
  });

  it("deletes through the coordinated function with the documented parameters", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const out = await deleteManualSpray({
      operationId: "op-del", vineyardId: "vy-1",
      manualEntryId: "me-1", sprayRecordId: "sr-1", tripId: "tp-1",
    });
    expect(out.kind).toBe("saved");
    const [fn, args] = rpc.mock.calls[0] as [string, any];
    expect(fn).toBe("delete_manual_spray_v1");
    expect(Object.keys(args).sort()).toEqual([
      "p_manual_entry_id", "p_operation_id", "p_spray_record_id", "p_trip_id", "p_vineyard_id",
    ]);
    expect(args).not.toHaveProperty("p_application_id");
  });
});

describe("manual identification", () => {
  it("comes from the source field only", () => {
    expect(isManualSpraySource("manual_entry")).toBe(true);
    expect(isManualSpraySource("gps_tracked")).toBe(false);
    expect(isManualSpraySource(null)).toBe(false);
  });
});
