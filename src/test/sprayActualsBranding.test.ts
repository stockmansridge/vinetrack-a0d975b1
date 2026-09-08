import { describe, expect, it, beforeEach } from "vitest";
import {
  amendmentValueLabel,
  configureSprayActualsSaver,
  diffActualsDraft,
  draftFromPayload,
  formatAmendmentMarker,
  overPlanNotes,
  parseActualAmount,
  parseActualWater,
  payloadAmendments,
  saveSprayActuals,
  sprayActualsSaveAvailable,
  SPRAY_ACTUALS_SAVE_UNAVAILABLE,
} from "@/lib/sprayActuals";
import { fitWithin, dataUrlImageFormat, imageSizeFromBytes } from "@/lib/imageDimensions";
import type { SprayReportPayloadV1 } from "@/lib/sprayReportV1";

function payload(): SprayReportPayloadV1 {
  return {
    identity: {
      tripId: "t1",
      sprayRecordId: "s1",
      vineyardId: "v1",
      vineyardName: "Test Vineyard",
      vineyardTimeZone: "Australia/Adelaide",
      reference: "Program 1 / Step 2",
    },
    trip: {
      startUtc: null,
      endUtc: null,
      activeDurationSeconds: null,
      distanceMetres: null,
      operatorName: "Sam",
      pinCount: 0,
    },
    equipment: {
      tractorName: null,
      sprayUnitName: null,
      startEngineHours: null,
      endEngineHours: null,
      engineHoursUsed: null,
    },
    blocks: [],
    rows: [],
    tanks: [
      {
        tankNumber: 1,
        plannedWaterLitres: 1000,
        actualWaterLitres: null,
        chemicals: [
          {
            name: "Copper",
            unit: "Litres",
            plannedAmountBase: 2000,
            actualAmountBase: null,
            plannedChemicalId: "c1",
            savedChemicalId: null,
            matchSource: "planned",
          },
        ],
      },
    ],
    weather: [],
    warnings: [],
    cost: null,
  } as unknown as SprayReportPayloadV1;
}

describe("actual amount entry", () => {
  it("treats blank as not recorded and zero as not added", () => {
    expect(parseActualAmount("", "Litres")).toEqual({ kind: "blank" });
    expect(parseActualAmount("0", "Litres")).toEqual({ kind: "value", base: 0 });
    expect(parseActualWater("")).toEqual({ kind: "blank" });
    expect(parseActualWater("0")).toEqual({ kind: "value", base: 0 });
  });

  it("rejects negative and non-numeric entries", () => {
    expect(parseActualAmount("-1", "Litres").kind).toBe("invalid");
    expect(parseActualAmount("abc", "Litres").kind).toBe("invalid");
    expect(parseActualWater("-5").kind).toBe("invalid");
  });

  it("converts display units to base units", () => {
    expect(parseActualAmount("1.5", "Litres")).toEqual({ kind: "value", base: 1500 });
    expect(parseActualAmount("250", "g")).toEqual({ kind: "value", base: 250 });
  });
});

describe("draft diffing", () => {
  it("produces no changes for an untouched draft", () => {
    const p = payload();
    expect(diffActualsDraft(p, draftFromPayload(p)).changes).toEqual([]);
  });

  it("records an initial actual and keeps zero distinct from blank", () => {
    const p = payload();
    const d = draftFromPayload(p);
    d.water[1] = "0";
    d.chemicals[Object.keys(d.chemicals)[0]] = "1";
    const diff = diffActualsDraft(p, d);
    expect(diff.errors).toEqual([]);
    expect(diff.changes).toHaveLength(2);
    expect(diff.changes[0]).toMatchObject({ newBase: 0, kind: "initial", unit: "L" });
    expect(diff.changes[1]).toMatchObject({ newBase: 1000, kind: "initial" });
  });

  it("collects validation errors instead of changes", () => {
    const p = payload();
    const d = draftFromPayload(p);
    d.water[1] = "-3";
    expect(diffActualsDraft(p, d).errors[0]).toContain("Tank 1 water");
  });

  it("allows an actual above the plan but notes it", () => {
    const p = payload();
    const d = draftFromPayload(p);
    d.chemicals[Object.keys(d.chemicals)[0]] = "5";
    expect(diffActualsDraft(p, d).errors).toEqual([]);
    expect(overPlanNotes(p, d)[0]).toContain("above the planned amount");
  });
});

describe("saving actuals", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcError = null;
  });

  it("does nothing when there is nothing to save", async () => {
    const p = payload();
    await saveSprayActuals({ payload: p, draft: draftFromPayload(p) });
    expect(rpcCalls).toHaveLength(0);
  });

  it("sends one complete audited snapshot per edited tank", async () => {
    const p = payload();
    const d = draftFromPayload(p);
    d.water[1] = "900";
    d.chemicals[Object.keys(d.chemicals)[0]] = "0";
    await saveSprayActuals({ payload: p, draft: d, operationIds: { 1: "op-1" } });
    expect(rpcCalls).toHaveLength(1);
    const [name, args] = rpcCalls[0];
    expect(name).toBe("correct_spray_tank_actual_v1");
    expect(args.p_operation_id).toBe("op-1");
    expect(args.p_expected_version).toBe(0);
    expect(args.p_water_volume_l).toBe(900);
    // A typed zero is an explicit observation, not a removed line.
    expect(args.p_chemicals).toHaveLength(1);
    expect(args.p_chemicals[0]).toMatchObject({ actualAmountBase: 0, usageKind: "planned" });
  });

  it("omits a blanked chemical line and reports a version conflict", async () => {
    const p = payload();
    p.tanks[0].chemicals[0].actualAmountBase = 1000;
    const d = draftFromPayload(p);
    d.chemicals[Object.keys(d.chemicals)[0]] = "";
    rpcError = { code: "40001", message: "could not serialize access" };
    await expect(saveSprayActuals({ payload: p, draft: d })).rejects.toBeInstanceOf(
      SprayActualsConflictError,
    );
    expect(rpcCalls[0][1].p_chemicals).toEqual([]);
  });
});


describe("amendment history", () => {
  it("ignores malformed entries and sorts by time", () => {
    const p = payload() as unknown as Record<string, unknown>;
    p.amendments = [
      { changedAtUtc: "2026-02-02T01:00:00Z", editorName: "Bo", tankNumber: 1, newValue: 2 },
      { editorName: "no timestamp" },
      { changedAtUtc: "2026-02-01T01:00:00Z", editorName: "Al", tankNumber: 1, newValue: 1 },
    ];
    const list = payloadAmendments(p as unknown as SprayReportPayloadV1);
    expect(list.map((a) => a.editorName)).toEqual(["Al", "Bo"]);
    expect(formatAmendmentMarker(list[0], "Australia/Adelaide")).toContain("Al");
  });

  it("labels missing and zero values honestly", () => {
    expect(amendmentValueLabel(null, "L")).toBe("Not recorded");
    expect(amendmentValueLabel(0, "L")).toContain("Not added");
    expect(amendmentValueLabel(1000, "Litres")).toBe("1 Litres".replace("Litres", "L"));
  });
});

describe("image sizing for branding", () => {
  it("preserves aspect ratio when fitting", () => {
    expect(fitWithin({ width: 200, height: 100 }, 100, 100)).toEqual({ width: 100, height: 50 });
    expect(fitWithin({ width: 100, height: 400 }, 100, 100)).toEqual({ width: 25, height: 100 });
  });

  it("reads PNG dimensions and detects the format", () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(png.buffer).setUint32(16, 120);
    new DataView(png.buffer).setUint32(20, 60);
    expect(imageSizeFromBytes(png)).toEqual({ width: 120, height: 60 });
    expect(dataUrlImageFormat("data:image/png;base64,AAA")).toBe("PNG");
    expect(dataUrlImageFormat("data:image/jpeg;base64,AAA")).toBe("JPEG");
  });
});
