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
  MANUAL_SPRAY_CONTRACT_GAPS,
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

describe("backend contract", () => {
  it("maps the draft to base units in the agreed payload", () => {
    const p = toManualSprayPayload(completeDraft());
    expect(p.source).toBe("manual_entry");
    expect(p.tanks[0].water_litres).toBe(1400);
    expect(p.tanks[0].chemicals[0]).toMatchObject({ base_amount: 750, base_unit: "g", entered_unit: "Kg" });
    expect(p.tanks[0].chemicals[1]).toMatchObject({ base_amount: 2500, base_unit: "mL", entered_unit: "Litres" });
  });

  it("reports the contract as unavailable and never writes when the function is absent", async () => {
    rpc.mockResolvedValue(missingFn);
    const status = await probeManualSprayContract();
    expect(status.available).toBe(false);
    expect(status.gaps).toEqual(MANUAL_SPRAY_CONTRACT_GAPS);

    const out = await saveManualSpray(toManualSprayPayload(completeDraft()));
    expect(out.kind).toBe("unavailable");
    // Only the probe call was made — no write was attempted.
    expect(rpc).toHaveBeenCalledTimes(2);
    expect((rpc.mock.calls[1] as [string, unknown])[0]).toBe("save_manual_spray_v1");
    expect((rpc.mock.calls[1] as [string, unknown])[1]).toEqual({});
  });

  it("retries with the identical frozen payload after an uncertain response", async () => {
    const payload = toManualSprayPayload(completeDraft());
    rpc.mockResolvedValueOnce(deployed)
      .mockResolvedValueOnce({ data: null, error: { message: "TypeError: Failed to fetch" } });
    const first = await saveManualSpray(payload);
    expect(first.kind).toBe("uncertain");

    rpc.mockResolvedValue(deployed);
    const second = await saveManualSpray(payload);
    expect(second).toEqual({ kind: "saved", applicationId: payload.application_id });
    const sent = rpc.mock.calls.filter((c) => (c[1] as any)?.p_payload).map((c) => (c[1] as any).p_payload);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[0].application_id).toBe(payload.application_id);
  });

  it("surfaces a version conflict instead of overwriting", async () => {
    rpc.mockResolvedValueOnce(deployed)
      .mockResolvedValueOnce({ data: null, error: { code: "40001", message: "version conflict" } });
    const out = await saveManualSpray(toManualSprayPayload(completeDraft()));
    expect(out.kind).toBe("conflict");
  });

  it("refuses deletion while the coordinated delete function is missing", async () => {
    rpc.mockResolvedValue(missingFn);
    expect((await deleteManualSpray("app-1")).kind).toBe("unavailable");
  });
});

describe("manual identification", () => {
  it("comes from the source field only", () => {
    expect(isManualSpraySource("manual_entry")).toBe(true);
    expect(isManualSpraySource("gps_tracked")).toBe(false);
    expect(isManualSpraySource(null)).toBe(false);
  });
});
