// Linked spray record → canonical Trip drawer, report geometry, legacy blank
// reference, tank fact separation and display formatting.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "../../docs/fixtures/spray-report-v1-stockmans-ridge.json";

const rpc = vi.fn();
const fromMock = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpc(...a), from: (...a: any[]) => fromMock(...a), storage: { from: vi.fn() } },
}));
const resolveSprayRoute = vi.fn();
vi.mock("@/lib/sprayReportRoute", () => ({
  resolveSprayRoute: (...a: any[]) => resolveSprayRoute(...a),
  ROUTE_RENDER_FAILED_MESSAGE: "failed",
}));
vi.mock("@/lib/sprayReportPdf", () => ({ saveSprayReportPdf: () => "file.pdf" }));
vi.mock("@/lib/sprayReportBranding", () => ({
  EMPTY_BRANDING: {},
  loadSprayReportBranding: async () => ({}),
}));

import { parseSprayReportPayload, REFERENCE_NOT_RECORDED, sprayReportFilename } from "@/lib/sprayReportV1";
import { summarizeTankRecords, TANK_ATTRIBUTION_NOT_RECORDED } from "@/lib/sprayTankRecords";
import { costValueKind, formatCostValue, formatEngineHours } from "@/lib/sprayReportQuantities";
import { linkedSprayEntrypoint } from "@/lib/sprayRecordTripLink";
import { downloadSprayReport } from "@/lib/sprayReportExport";

const clone = () => JSON.parse(JSON.stringify(fixture));
const fmt = { currency: (n: number) => `$${n.toFixed(2)}`, area: (n: number) => `${n} ha` };

describe("legacy blank reference (23 Sep)", () => {
  it("accepts an empty reference and labels it truthfully", () => {
    const raw = clone();
    raw.identity.reference = "";
    const { payload, errors } = parseSprayReportPayload(raw);
    expect(errors).toEqual([]);
    expect(payload!.identity.reference).toBe(REFERENCE_NOT_RECORDED);
    expect(payload!.identity.referenceRecorded).toBe(false);
    expect(sprayReportFilename(payload!)).toContain("_Reference_not_recorded_");
  });
  it("accepts a null reference", () => {
    const raw = clone();
    raw.identity.reference = null;
    expect(parseSprayReportPayload(raw).payload!.identity.reference).toBe(REFERENCE_NOT_RECORDED);
  });
  it("keeps a recorded reference unchanged", () => {
    const { payload } = parseSprayReportPayload(clone());
    expect(payload!.identity.reference).toBe("Late Woolly Bud E-L Stage 2-3");
    expect(payload!.identity.referenceRecorded).toBe(true);
  });
  it("still rejects a missing reference key or a non-string", () => {
    const a = clone();
    delete a.identity.reference;
    expect(parseSprayReportPayload(a).errors).toContain("identity.reference is required");
    const b = clone();
    b.identity.reference = 42;
    expect(parseSprayReportPayload(b).payload).toBeNull();
  });
  it("still rejects other blank required identity fields", () => {
    for (const k of ["tripId", "sprayRecordId", "vineyardId", "vineyardName", "vineyardTimeZone"]) {
      const raw = clone();
      raw.identity[k] = "";
      expect(parseSprayReportPayload(raw).errors).toContain(`identity.${k} is required`);
    }
  });
});

describe("tank facts are kept separate", () => {
  it("4 Sep: Tank 2 planned only, one Tank 1 session, nothing confirmed, no row links", () => {
    const raw = clone();
    raw.tanks = [raw.tanks[0], { ...raw.tanks[0], tankNumber: 2 }];
    raw.tankSessions = [raw.tankSessions[0]];
    raw.rows = raw.rows.map((r: any) => ({ ...r, tank: null }));
    const s = summarizeTankRecords(parseSprayReportPayload(raw).payload!);
    expect(s.tanks).toEqual([
      { tankNumber: 1, planned: true, sessions: 1, actualConfirmed: false, attributedRows: 0 },
      { tankNumber: 2, planned: true, sessions: 0, actualConfirmed: false, attributedRows: 0 },
    ]);
    expect(s.attributionNote).toContain(TANK_ATTRIBUTION_NOT_RECORDED);
  });
  it("14 Oct: Tank 1 and 2 actuals confirmed without inventing row links", () => {
    const raw = clone();
    raw.tanks = [
      { ...raw.tanks[0], tankNumber: 1, actualId: "a1", actualVersion: 1, actualWaterLitres: 1500 },
      { ...raw.tanks[0], tankNumber: 2, actualId: "a2", actualVersion: 1, actualWaterLitres: 344.742 },
    ];
    raw.tankSessions = raw.tankSessions.map((x: any) => ({ ...x, pathsCovered: [] }));
    raw.rows = raw.rows.map((r: any) => ({ ...r, tank: null }));
    const s = summarizeTankRecords(parseSprayReportPayload(raw).payload!);
    expect(s.tanks.map((t) => [t.tankNumber, t.sessions, t.actualConfirmed, t.attributedRows])).toEqual([
      [1, 1, true, 0],
      [2, 1, true, 0],
    ]);
    expect(s.rowsWithTank).toBe(0);
  });
  it("no note when every row carries a recorded tank", () => {
    expect(summarizeTankRecords(parseSprayReportPayload(clone()).payload!).attributionNote).toBeNull();
  });
});

describe("display formatting", () => {
  it("engine hours never show float noise", () => {
    expect(formatEngineHours(1234.5000000001)).toBe("1234.5");
    expect(formatEngineHours(null)).toBe("Not recorded");
  });
  it("fuel L/hr is a rate, not a duration", () => {
    expect(costValueKind("fuelLitresPerHour")).toBe("litresPerHour");
    expect(formatCostValue("fuelLitresPerHour", 6.8, fmt)).toBe("6.8 L/hr");
    expect(formatCostValue("fuelHours", 6.8, fmt)).toBe("6.80 h");
  });
  it("reason objects never render as [object Object]", () => {
    expect(formatCostValue("chemicalIncompleteReasons", [{ name: "Oil", reason: "No season purchase cost" }], fmt))
      .toBe("Oil: No season purchase cost");
    expect(formatCostValue("status", { code: "partial" }, fmt)).not.toContain("[object");
  });
});

describe("Spray Records entrypoint routing", () => {
  it("linked non-manual record with a valid trip opens the Trip drawer", () => {
    expect(linkedSprayEntrypoint({ record: { trip_id: "t1" }, tripLoading: false, trip: { id: "t1" } })).toBe("trip");
  });
  it("waits while the trip loads, then falls back if missing", () => {
    expect(linkedSprayEntrypoint({ record: { trip_id: "t1" }, tripLoading: true, trip: null })).toBe("pending");
    expect(linkedSprayEntrypoint({ record: { trip_id: "t1" }, tripLoading: false, trip: null })).toBe("record");
  });
  it("manual and unlinked records keep the dedicated drawer", () => {
    expect(linkedSprayEntrypoint({ record: { trip_id: "t1", entry_source: "manual" }, tripLoading: false, trip: { id: "t1" } })).toBe("record");
    expect(linkedSprayEntrypoint({ record: { trip_id: null }, tripLoading: false, trip: null })).toBe("record");
  });
  it("never opens a different trip than the record's", () => {
    expect(linkedSprayEntrypoint({ record: { trip_id: "t1" }, tripLoading: false, trip: { id: "t2" } })).toBe("record");
  });
});

describe("report geometry comes from the saved Trip", () => {
  beforeEach(() => {
    rpc.mockReset();
    fromMock.mockReset();
    resolveSprayRoute.mockReset();
    rpc.mockResolvedValue({ data: clone(), error: null });
    resolveSprayRoute.mockResolvedValue({ image: null, warning: null });
  });
  const tripQuery = (path_points: unknown) => {
    const eqs: any[] = [];
    const q: any = {
      select: () => q,
      eq: (k: string, v: string) => (eqs.push([k, v]), q),
      maybeSingle: async () => ({ data: { path_points }, error: null }),
    };
    fromMock.mockReturnValue(q);
    return eqs;
  };

  it("fetches trip path points by exact trip + vineyard when none are passed (14 Oct)", async () => {
    const pts = Array.from({ length: 4584 }, (_, i) => ({ latitude: -33 + i * 1e-5, longitude: 149 }));
    const eqs = tripQuery(pts);
    const res = await downloadSprayReport({ tripId: fixture.identity.tripId });
    expect(res.ok).toBe(true);
    expect(eqs).toEqual([
      ["id", fixture.identity.tripId],
      ["vineyard_id", fixture.identity.vineyardId],
    ]);
    expect(resolveSprayRoute.mock.calls[0][1]).toHaveLength(4584);
  });
  it("genuinely absent geometry stays absent", async () => {
    tripQuery(null);
    await downloadSprayReport({ tripId: fixture.identity.tripId });
    expect(resolveSprayRoute.mock.calls[0][1]).toEqual([]);
  });
  it("uses caller points without a second read", async () => {
    const pts = [{ lat: -33, lng: 149 }, { lat: -33.1, lng: 149.1 }];
    await downloadSprayReport({ tripId: fixture.identity.tripId, pathPoints: pts });
    expect(fromMock).not.toHaveBeenCalled();
  });
  it("23 Sep blank reference report downloads", async () => {
    const raw = clone();
    raw.identity.reference = "";
    rpc.mockResolvedValue({ data: raw, error: null });
    tripQuery(null);
    expect((await downloadSprayReport({ tripId: raw.identity.tripId })).ok).toBe(true);
  });
});
