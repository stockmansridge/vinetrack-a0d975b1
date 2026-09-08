// Trip metadata corrections, weather recovery and row-assignment recovery all
// go through the shared authorised paths, with honest outcomes and no invented
// data.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "../../docs/fixtures/spray-report-v1-actual-corrections.json";

const rpc = vi.fn();
const invoke = vi.fn();

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

import {
  correctSprayTripMetadata,
  TripMetadataConflictError,
  validateFuelRate,
} from "@/lib/sprayTripMetadata";
import { recoverSprayWeather } from "@/lib/sprayWeatherRecovery";
import {
  isSubmittableAssignment,
  recoverSprayRowAssignments,
  rowProvenanceLabel,
  ROW_RECOVERY_NO_EVIDENCE,
  type RowAssignmentEvidence,
} from "@/lib/sprayRowRecovery";
import { chemicalTotals, toDisplayAmount } from "@/lib/sprayReportQuantities";

beforeEach(() => vi.clearAllMocks());

const CORRECTION = {
  machineId: "m1",
  tractorId: null,
  sprayEquipmentId: "s1",
  operatorUserId: "u1",
  fuelConsumptionLPerHour: 12.5,
  startEngineHours: 100,
  endEngineHours: 104,
};

describe("trip metadata corrections", () => {
  it("rejects a zero or negative fuel rate before writing anything", async () => {
    expect(validateFuelRate(0)).toBeTruthy();
    expect(validateFuelRate(-1)).toBeTruthy();
    expect(validateFuelRate(null)).toBeNull();
    await expect(
      correctSprayTripMetadata({
        tripId: "t1",
        expectedVersion: 2,
        correction: { ...CORRECTION, fuelConsumptionLPerHour: 0 },
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a complete snapshot with the expected version", async () => {
    rpc.mockResolvedValue({ data: { correction: { version: 3 }, report: null }, error: null });
    const res = await correctSprayTripMetadata({
      tripId: "t1",
      expectedVersion: 2,
      correction: CORRECTION,
      operationId: "op-1",
    });
    const [fn, args] = rpc.mock.calls[0] as [string, any];
    expect(fn).toBe("correct_spray_trip_metadata_v1");
    expect(args.p_operation_id).toBe("op-1");
    expect(args.p_expected_version).toBe(2);
    expect(args.p_tractor_id).toBeNull();
    expect(args.p_fuel_consumption_l_per_hour).toBe(12.5);
    expect(res.version).toBe(3);
  });

  it("reports a version conflict rather than overwriting", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "conflict" } });
    await expect(
      correctSprayTripMetadata({ tripId: "t1", expectedVersion: 1, correction: CORRECTION }),
    ).rejects.toBeInstanceOf(TripMetadataConflictError);
  });
});

describe("weather recovery", () => {
  it("reports how many past hours were retrieved", async () => {
    invoke.mockResolvedValue({ data: { filled: 2 }, error: null });
    const out = await recoverSprayWeather("t1");
    expect(out.kind).toBe("recovered");
    expect(out.message).toContain("2 past hours");
  });

  it("leaves missing hours pending on an unsupported source or a failure", async () => {
    invoke.mockResolvedValue({ data: { supported: false }, error: null });
    expect((await recoverSprayWeather("t1")).kind).toBe("unsupported");

    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    const failed = await recoverSprayWeather("t1");
    expect(failed.kind).toBe("failed");
    expect(failed.message).toContain("Recorded observations are unchanged");
  });
});

describe("row assignment recovery", () => {
  const evidence: RowAssignmentEvidence = {
    blockId: "b1",
    blockName: "Block A",
    rowIdentity: "b1:24.5",
    rowNumber: 24.5,
    tankSessionId: "ts1",
    tankNumber: 1,
    status: "Complete",
    assignmentSource: "gps_geometry_intersection",
    confidence: 0.95,
    originalEvidence: { points: 12 },
  };

  it("never submits low-confidence location evidence", async () => {
    expect(isSubmittableAssignment({ ...evidence, confidence: 0.8 })).toBe(false);
    await expect(
      recoverSprayRowAssignments({ tripId: "t1", assignments: [{ ...evidence, confidence: 0.8 }] }),
    ).rejects.toThrow(ROW_RECOVERY_NO_EVIDENCE);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("submits evidence exactly as supplied", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await recoverSprayRowAssignments({ tripId: "t1", assignments: [evidence] });
    const [, args] = rpc.mock.calls[0] as [string, any];
    expect(args.p_assignments[0].originalEvidence).toEqual({ points: 12 });
    expect(args.p_assignments[0].confidence).toBe(0.95);
  });

  it("labels calculated attribution plainly", () => {
    const label = rowProvenanceLabel({
      rowNumber: 24.5,
      blockName: "Block A",
      status: "Complete",
      source: "saved_plan_identity",
      tank: 1,
      isDerived: true,
      confidence: 0.9,
    } as any);
    expect(label).toContain("From the saved plan");
    expect(label).toContain("calculated");
    expect(label).toContain("90% confidence");
  });
});

describe("actual corrections fixture", () => {
  it("keeps zero distinct from not recorded and totals substitutions and additions", () => {
    const tank = (fixture as any).tanks[0];
    const oil = tank.chemicals.find((c: any) => /Oil/i.test(c.name));
    expect(oil.actualAmountBase).toBe(0);
    expect(toDisplayAmount(0, oil.unit)).toBe(0);

    const kinds = tank.chemicals.map((c: any) => c.usageKind);
    expect(kinds).toContain("substitution");
    expect(kinds).toContain("additional");

    const totals = chemicalTotals([tank] as any);
    const names = totals.map((t: any) => t.name);
    expect(names).toContain("Sulphur");
    expect(tank.actualVersion).toBe(4);
  });
});
