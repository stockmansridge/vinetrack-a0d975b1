import { describe, expect, it } from "vitest";
import {
  ALL_BLOCKS,
  ALL_STATUSES,
  filterScoutVisits,
  isPermissionError,
  locationLabel,
  measuredCoord,
  sortAssessmentsChronologically,
  stopChronology,
  stopCoord,
  stopLabel,
  stopOrder,
  visitStatuses,
  visitedBlockIds,
  type ScoutAssessment,
  type ScoutVisit,
} from "@/lib/scoutReports";
import { vintageScope } from "@/lib/vintageScope";

const visit = (over: Partial<ScoutVisit> = {}): ScoutVisit => ({
  id: "v1",
  vineyard_id: "vy1",
  vintage_year: 2026,
  scout_date: "2026-02-10",
  status: "completed",
  visit_summary: null,
  weather_snapshot: null,
  scout_user_id: null,
  scout_name_snapshot: "Jane",
  deleted_at: null,
  ...over,
});

const assessment = (over: Partial<ScoutAssessment> = {}): ScoutAssessment => ({
  id: "a1",
  scout_visit_id: "v1",
  vineyard_id: "vy1",
  paddock_id: "p1",
  status: "completed",
  stop_context: null,
  created_at: null,
  deleted_at: null,
  ...over,
});

describe("isPermissionError", () => {
  it("detects Postgres and PostgREST permission failures", () => {
    expect(isPermissionError({ code: "42501" })).toBe(true);
    expect(isPermissionError({ code: "PGRST301" })).toBe(true);
    expect(isPermissionError({ status: 401 })).toBe(true);
    expect(isPermissionError({ status: 403 })).toBe(true);
    expect(isPermissionError({ message: "permission denied for table scout_visits" })).toBe(true);
    expect(isPermissionError({ message: "new row violates row-level security policy" })).toBe(true);
  });

  it("does not classify ordinary errors as permission failures", () => {
    expect(isPermissionError({ message: "Network request failed" })).toBe(false);
    expect(isPermissionError(null)).toBe(false);
    expect(isPermissionError("nope")).toBe(false);
  });
});

describe("stop ordering", () => {
  it("orders by recorded stop index and labels stops", () => {
    const a = assessment({ id: "a", stop_context: { stop_index: 2 } });
    const b = assessment({ id: "b", stop_context: { stop_index: 1 } });
    const c = assessment({ id: "c", stop_context: null });
    expect(stopOrder(a)).toBe(2);
    expect(stopOrder(b)).toBe(1);
    expect(stopOrder(c)).toBe(Number.MAX_SAFE_INTEGER);
    expect(stopLabel(a, 0)).toBe("Stop 2");
    expect(stopLabel(c, 4)).toBe("Stop 5");
  });
});

describe("stop chronology", () => {
  it("orders stops by recorded capture time, not UUID", () => {
    // Deliberately unsorted UUIDs: alphabetical order would be wrong.
    const late = assessment({ id: "aaa", stop_context: { captured_at: "2026-02-10T10:30:00Z" } });
    const early = assessment({ id: "zzz", stop_context: { captured_at: "2026-02-10T09:05:00Z" } });
    const mid = assessment({ id: "mmm", created_at: "2026-02-10T09:45:00Z" });
    const sorted = sortAssessmentsChronologically([late, early, mid]);
    expect(sorted.map((a) => a.id)).toEqual(["zzz", "mmm", "aaa"]);
  });

  it("falls back to created_at, then recorded index, then id", () => {
    const noTime = assessment({ id: "b", stop_context: { stop_index: 1 } });
    const timed = assessment({ id: "a", created_at: "2026-02-10T09:00:00Z" });
    // A stop with time evidence precedes one with neither time nor index.
    const bare = assessment({ id: "c" });
    const sorted = sortAssessmentsChronologically([bare, noTime, timed]);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps repeated stops in the same block as separate identities", () => {
    const first = assessment({ id: "s1", paddock_id: "p1", stop_context: { captured_at: "2026-02-10T09:00:00Z" } });
    const second = assessment({ id: "s2", paddock_id: "p1", stop_context: { captured_at: "2026-02-10T11:00:00Z" } });
    const sorted = sortAssessmentsChronologically([second, first]);
    expect(sorted.map((a) => a.id)).toEqual(["s1", "s2"]);
    expect(sorted).toHaveLength(2);
  });

  it("reads stop capture time and GPS from stop_context", () => {
    const a = assessment({
      stop_context: { captured_at: "2026-02-10T09:00:00Z", latitude: -33.5, longitude: 149.7 },
    });
    expect(stopChronology(a)).toBe(Date.parse("2026-02-10T09:00:00Z"));
    expect(stopCoord(a)).toEqual({ lat: -33.5, lng: 149.7 });
    expect(stopCoord(assessment({ stop_context: null }))).toBeNull();
  });
});

describe("filterScoutVisits", () => {
  const scope2026 = vintageScope(2026, 7, 1); // 2025-07-01 .. 2026-07-01

  it("scopes by scout_date within the canonical season window", () => {
    const inSeason = visit({ id: "in", scout_date: "2026-02-10" });
    const outSeason = visit({ id: "out", scout_date: "2026-08-01" });
    const result = filterScoutVisits([inSeason, outSeason], {
      scope: scope2026,
      search: "",
      status: ALL_STATUSES,
      blockId: ALL_BLOCKS,
    });
    expect(result.map((v) => v.id)).toEqual(["in"]);
  });

  it("returns everything when scope is null (All vintages)", () => {
    const a = visit({ id: "a", scout_date: "2024-01-01" });
    const b = visit({ id: "b", scout_date: "2026-02-10" });
    expect(
      filterScoutVisits([a, b], { scope: null, search: "", status: ALL_STATUSES, blockId: ALL_BLOCKS }),
    ).toHaveLength(2);
  });

  it("filters by status verbatim", () => {
    const d = visit({ id: "d", status: "draft" });
    const c = visit({ id: "c", status: "completed" });
    expect(
      filterScoutVisits([d, c], { scope: null, search: "", status: "draft", blockId: ALL_BLOCKS }),
    ).toEqual([d]);
  });

  it("filters by block using assessment identity, keeping repeated stops", () => {
    const v = visit({ id: "v1" });
    const stops = [
      assessment({ id: "s1", scout_visit_id: "v1", paddock_id: "p1" }),
      assessment({ id: "s2", scout_visit_id: "v1", paddock_id: "p1" }), // same block again
      assessment({ id: "s3", scout_visit_id: "v1", paddock_id: "p2" }),
    ];
    const map = new Map([["v1", stops]]);
    expect(
      filterScoutVisits([v], { scope: null, search: "", status: ALL_STATUSES, blockId: "p1" }, map),
    ).toHaveLength(1);
    expect(
      filterScoutVisits([v], { scope: null, search: "", status: ALL_STATUSES, blockId: "p9" }, map),
    ).toHaveLength(0);
    // The stop list itself is never flattened:
    expect(map.get("v1")).toHaveLength(3);
  });

  it("searches scout name and summary case-insensitively", () => {
    const v = visit({ scout_name_snapshot: "Jane Hambrook", visit_summary: "Powdery check" });
    expect(
      filterScoutVisits([v], { scope: null, search: "hambrook", status: ALL_STATUSES, blockId: ALL_BLOCKS }),
    ).toHaveLength(1);
    expect(
      filterScoutVisits([v], { scope: null, search: "downy", status: ALL_STATUSES, blockId: ALL_BLOCKS }),
    ).toHaveLength(0);
  });
});

describe("list helpers", () => {
  it("collects distinct statuses and visited blocks", () => {
    expect(visitStatuses([visit({ status: "draft" }), visit({ status: "completed" }), visit({ status: "draft" })])).toEqual([
      "completed",
      "draft",
    ]);
    expect(
      visitedBlockIds([
        assessment({ paddock_id: "p1" }),
        assessment({ paddock_id: "p1" }),
        assessment({ paddock_id: null }),
      ]),
    ).toEqual(["p1"]);
  });
});

describe("location honesty", () => {
  it("returns null coordinates and an unavailable label when GPS is missing", () => {
    const row = { latitude: null, longitude: null, horizontal_accuracy: null, location_status: null };
    expect(measuredCoord(row)).toBeNull();
    expect(locationLabel(row)).toBe("Location unavailable");
  });

  it("formats measured coordinates with accuracy", () => {
    const row = { latitude: -33.1234567, longitude: 149.7654321, horizontal_accuracy: 4.6, location_status: "ok" };
    expect(measuredCoord(row)).toEqual({ lat: -33.1234567, lng: 149.7654321 });
    expect(locationLabel(row)).toBe("-33.123457, 149.765432 (±5 m)");
  });
});
