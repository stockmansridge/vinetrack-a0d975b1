import { describe, it, expect } from "vitest";
import {
  aisleGeometry, pairVineRow, assessPin, isMissingRowPin, validateKnownPins, recoveryCsv,
  countValidObservations, auditSummary, latestEvidenceByPin, trackAnchor, travelFromTrack,
} from "@/lib/pinRowRecovery";
import { SYSTEM_ADMIN_GROUPS, searchDestinations } from "@/lib/navigationConfig";

const M_LNG = 1 / (111320 * Math.cos((-34 * Math.PI) / 180));
const rows = [1, 2, 3, 4, 5].map((n) => ({
  number: n,
  startPoint: { latitude: -34, longitude: 150 + (n - 1) * 2.8 * M_LNG },
  endPoint: { latitude: -33.999, longitude: 150 + (n - 1) * 2.8 * M_LNG },
}));
const poly = [
  { latitude: -34.0001, longitude: 150 - M_LNG }, { latitude: -34.0001, longitude: 150 + 12 * M_LNG },
  { latitude: -33.9989, longitude: 150 + 12 * M_LNG }, { latitude: -33.9989, longitude: 150 - M_LNG },
];
const pad = { id: "b1", name: "Blackberries", rows, polygon_points: poly };
const at = (m: number) => ({ lat: -33.9995, lng: 150 + m * M_LNG });
const pt = at(7);
const goodEvidence = {
  pin_id: "p", captured_at: "2026-10-14T01:00:05Z", heading_observed_at: "2026-10-14T01:00:03Z",
  horizontal_accuracy_m: 0.8, heading_degrees: 291.84, pressed_side: "Right",
  observations: [
    { latitude: pt.lat - 0.00002, longitude: pt.lng, observedAt: "2026-10-14T01:00:02Z", courseDegrees: 1, speedMps: 1.2, horizontalAccuracyM: 1 },
    { latitude: pt.lat + 0.00001, longitude: pt.lng, observedAt: "2026-10-14T01:00:05Z", courseDegrees: 359, speedMps: 1.2, horizontalAccuracyM: 1 },
    { bad: 1 }, null,
  ],
};
const trackNorth = () => [-30, -20, -10, 0, 10, 20, 30].map((d) => ({ lat: pt.lat + d * 1e-5 * (d === 0 ? 0 : 1), lng: pt.lng }));
const corroborated = () => ({
  paddocks: [pad],
  evidence: new Map([["p", goodEvidence]]),
  segments: new Map(),
  trips: new Map([["t1", trackNorth()]]),
});
const pinP = { id: "p", latitude: pt.lat, longitude: pt.lng, paddock_id: "b1", heading: 291.84, pin_side: "Right", trip_id: "t1" };

describe("geometry", () => {
  it("bounding rows and aisle are distinct from nearest physical row", () => {
    const g = aisleGeometry(at(6.2), rows); // between row 3 (5.6 m) and 4 (8.4 m)
    expect(g.boundingRows).toEqual([3, 4]);
    expect(g.aisle).toBe(3.5);
    expect(g.nearestPhysicalRow).toBe(3);
  });
  it("heading + side pairing, refuses cross-row or missing heading", () => {
    const g = aisleGeometry(at(6.2), rows);
    expect(pairVineRow(g, 0, "left").row).toBe(3);
    expect(pairVineRow(g, 0, "right").row).toBe(4);
    expect(pairVineRow(g, 180, "left").row).toBe(4);
    expect(pairVineRow(g, 90, "left").row).toBeNull();
    expect(pairVineRow(g, null, "left").row).toBeNull();
  });
  it("track anchor distinguishes unique, repeated and none", () => {
    expect(trackAnchor(pt, [pt, at(1)])).toBe("unique");
    expect(trackAnchor(pt, [pt, pt])).toBe("multiple");
    expect(trackAnchor(pt, [at(1)])).toBe("none");
  });
});

describe("evidence", () => {
  it("counts valid JSONB observations, not evidence rows", () => {
    expect(countValidObservations(goodEvidence.observations)).toBe(2);
    expect(countValidObservations(null)).toBe(0);
  });
  it("uses latest evidence row per pin", () => {
    const m = latestEvidenceByPin([{ pin_id: "a", captured_at: "2026-01-01" }, { pin_id: "a", captured_at: "2026-02-01", horizontal_accuracy_m: 3 }]);
    expect(m.get("a")?.horizontal_accuracy_m).toBe(3);
  });
  it("labels no-evidence and unavailable separately with no default accuracy", () => {
    const none = assessPin(pinP, { ...corroborated(), evidence: new Map() });
    expect(none.evidenceState).toBe("none");
    expect(none.accuracy).toBeNull();
    const un = assessPin(pinP, { ...corroborated(), evidence: null });
    expect(un.evidenceState).toBe("unavailable");
    expect(un.observationCount).toBeNull();
  });
});

describe("status", () => {
  it("device heading ≠ travel (6f1c2656-style 291.84° vs ~0°): candidate row from GPS travel, conflict flagged, not supported", () => {
    const r = assessPin(pinP, corroborated());
    expect(r.travel.source).toBe("gps_observations");
    expect(r.headingVsTravelDeg!).toBeGreaterThan(60);
    expect(r.directionConflict).toMatch(/device heading differs/);
    expect(r.status).toBe("requires_review");
    // Travelling north, Right → east bounding row 4. Compass 291.84° would be rejected as cross-row.
    expect(r.suggestedVineRow).toBe(4);
    expect(r.observationCount).toBe(2);
  });
  it("supported only when device heading agrees with corroborated GPS travel", () => {
    const ev = corroborated();
    ev.evidence.set("p", { ...goodEvidence, heading_degrees: 5 });
    const r = assessPin({ ...pinP, heading: 5 }, ev);
    expect(r.status).toBe("supported_candidate");
    expect(r.suggestedVineRow).toBe(4);
  });
  it("compass heading alone never yields a vine row; low-speed course fails closed", () => {
    const ev = corroborated();
    ev.trips = new Map();
    ev.evidence.set("p", { ...goodEvidence, heading_degrees: 0, observations: [
      { latitude: pt.lat, longitude: pt.lng, observedAt: "2026-10-14T01:00:02Z", courseDegrees: 11, speedMps: 0.35, horizontalAccuracyM: 1 },
      { latitude: pt.lat + 1e-5, longitude: pt.lng, observedAt: "2026-10-14T01:00:04Z", courseDegrees: 12, speedMps: 0.35, horizontalAccuracyM: 1 },
    ] });
    const r = assessPin({ ...pinP, heading: 0 }, ev);
    expect(r.travel.courseDeg).toBeNull();
    expect(r.suggestedVineRow).toBeNull();
    expect(r.geometry?.boundingRows).toEqual([3, 4]);
    expect(r.status).toBe("requires_review");
  });
  it("observations and track disagreeing → direction conflict, no row", () => {
    const ev = corroborated();
    ev.trips.set("t1", trackNorth().reverse().map((q, i, a) => a[a.length - 1 - i]).map((q) => ({ lat: 2 * pt.lat - q.lat, lng: q.lng })));
    const r = assessPin(pinP, ev);
    expect(r.directionConflict).toMatch(/disagree/);
    expect(r.suggestedVineRow).toBeNull();
  });
  it("turning track around anchor is not straight → no track travel", () => {
    const turn = [{ lat: pt.lat - 6e-5, lng: pt.lng }, pt, { lat: pt.lat, lng: pt.lng + 8 * M_LNG }];
    expect(travelFromTrack(pt, turn).courseDeg).toBeNull();
    expect(travelFromTrack(pt, trackNorth()).courseDeg! < 5 || travelFromTrack(pt, trackNorth()).courseDeg! > 355).toBe(true);
  });
  it("headland / beyond row end and off-block saved pins are not resolvable", () => {
    const head = { ...pinP, latitude: -34.00005, longitude: pt.lng }; // inside polygon, before row start
    expect(assessPin(head, corroborated()).status).toBe("not_resolvable");
    const nearEnd = { ...pinP, latitude: -34 + 1e-5, longitude: pt.lng }; // ~1 m from row start
    expect(assessPin(nearEnd, corroborated()).geometry?.withinRowExtents).toBe(false);
    const offPad = { ...pad, polygon_points: poly.map((q) => ({ ...q, longitude: q.longitude + 1 })) };
    const r = assessPin(pinP, { ...corroborated(), paddocks: [offPad] });
    expect(r.geometry?.insidePolygon).toBe(false);
    expect(r.status).toBe("not_resolvable");
  });
  it("divergent rows are never a supported candidate", () => {
    const bent = rows.map((r) => r.number === 4 ? { ...r, endPoint: { latitude: -33.999, longitude: r.endPoint.longitude + 20 * M_LNG } } : r);
    const ev = corroborated(); ev.evidence.set("p", { ...goodEvidence, heading_degrees: 5 });
    const r = assessPin({ ...pinP, heading: 5 }, { ...ev, paddocks: [{ ...pad, rows: bent }] });
    expect(r.status).not.toBe("supported_candidate");
  });
  it("geometry-only (no evidence, no trips) requires review", () => {
    const r = assessPin(pinP, { paddocks: [pad], evidence: new Map(), segments: new Map(), trips: "not_loaded" });
    expect(r.status).toBe("requires_review");
  });
  it("accuracy larger than aisle clearance requires review", () => {
    const ev = corroborated();
    ev.evidence.set("p", { ...goodEvidence, horizontal_accuracy_m: 3 });
    expect(assessPin(pinP, ev).status).toBe("requires_review");
  });
  it("stale heading, repeated anchor and suggested block require review", () => {
    const ev = corroborated();
    ev.evidence.set("p", { ...goodEvidence, heading_observed_at: "2026-10-14T00:50:00Z" });
    expect(assessPin(pinP, ev).status).toBe("requires_review");
    const ev2 = corroborated(); ev2.trips.set("t1", [pt, pt]);
    expect(assessPin(pinP, ev2).status).toBe("requires_review");
    expect(assessPin({ ...pinP, paddock_id: null }, corroborated()).status).toBe("requires_review");
  });
  it("preserves saved segments (Row 108), driving row and location_scope=row", () => {
    const ev = corroborated();
    ev.segments.set("331286a7-1e1a-4bd4-a0f0-22f17b9504cf", [{ row_number: 108, segment_number: 1 }]);
    const s = assessPin({ ...pinP, id: "331286a7-1e1a-4bd4-a0f0-22f17b9504cf" }, ev);
    expect(s.status).toBe("preserve_existing");
    expect(s.segmentsLabel).toContain("Row 108");
    expect(assessPin({ ...pinP, id: "6ef803a9-0391-43fc-a4e9-0315411456d2", driving_row_number: 3.5 }, ev).status).toBe("preserve_existing");
    expect(assessPin({ ...pinP, location_scope: "row" }, ev).status).toBe("preserve_existing");
  });
  it("fails closed when segments are unreadable", () => {
    const r = assessPin(pinP, { ...corroborated(), segments: null });
    expect(r.segmentsState).toBe("unavailable");
    expect(r.status).toBe("requires_review");
    expect(r.suggestedVineRow).toBeNull();
  });
  it("excludes Row 35 / aisle 34.5 pin from the missing queue", () => {
    expect(isMissingRowPin({ latitude: 1, longitude: 1, pin_row_number: 35, driving_row_number: 34.5 })).toBe(false);
  });
});

describe("schema-snapshot fixture (counts from independent read-only SQL audit, not browser results)", () => {
  // Build 380 active GPS pins reproducing the audit's category counts.
  const pins: any[] = [];
  const evidence = new Map<string, any>();
  const segments = new Map<string, any[]>();
  const trips = new Map<string, any[]>([["t1", []], ["t2", []], ["t3", []], ["t4", []], ["t5", []]]);
  for (let i = 0; i < 261; i++) pins.push({ id: `k${i}`, latitude: pt.lat, longitude: pt.lng, paddock_id: "b1", pin_row_number: 3, row_number: 3 });
  for (let i = 0; i < 119; i++) {
    const p: any = { id: `m${i}`, latitude: pt.lat + i * 1e-6, longitude: pt.lng };
    if (i < 84) p.paddock_id = "b1";
    else if (i < 86) { p.latitude = at(6).lat; p.longitude = at(6).lng + (i - 84) * 1e-7; } // inside polygon
    else { p.latitude = -30; p.longitude = 140; } // outside
    if (i < 77) { p.trip_id = i < 57 ? `t${(i % 4) + 1}` : "t5"; p.heading = 0; }
    if (i < 75) p.pin_side = "left";
    if (i < 56) evidence.set(p.id, { pin_id: p.id, observations: [] });
    if (i === 0 || i === 1) segments.set(p.id, [{ row_number: 108, segment_number: 1 }]);
    if (i === 2 || i === 3) p.driving_row_number = 3.5;
    if (i < 57) trips.get(p.trip_id)!.push({ lat: p.latitude, lng: p.longitude });
    pins.push(p);
  }
  const s = auditSummary(pins, { paddocks: [pad], evidence, segments, trips });
  it("reproduces 380 / 119 / 84 / 35 / 2 / 33 / 77 / 56 / 4 / 77 / 75 / 57 across 4 trips", () => {
    expect(s).toEqual({
      activeGps: 380, missing: 119, withPaddock: 84, withoutPaddock: 35, noBlockInsideOne: 2,
      noBlockOutside: 33, tripLinks: 77, withEvidence: 56, existingMeta: 4, withHeading: 77,
      withSide: 75, uniqueAnchors: 57, anchorTrips: 4,
    });
  });
});

describe("validation and export", () => {
  it("counts nearest-row ≠ saved-row cases and adjacency", () => {
    const known = [{ id: "k", paddock_id: "b1", latitude: at(6.2).lat, longitude: at(6.2).lng, pin_row_number: 4, driving_row_number: 3.5, heading: 0, pin_side: "right" }];
    const v = validateKnownPins(known, [pad]);
    expect(v).toMatchObject({ total: 1, adjacencyValid: 1, aisleMatch: 1, nearestDiffersFromSaved: 1, vineRowMatch: 1, falsePositives: 0 });
  });
  it("saved aisle adjacency holds while compass-derived row is WRONG (fa0201e1-style 292° compass, ~8° travel)", () => {
    // Saved Row 4 / aisle 3.5, travelling north with side Right → row 4. Compass 200° (south-ish) pairs to row 3.
    const known = [{ id: "fa", paddock_id: "b1", latitude: at(7).lat, longitude: at(7).lng, pin_row_number: 4, driving_row_number: 3.5, heading: 200, pin_side: "right" }];
    const v = validateKnownPins(known, [pad]);
    expect(v.adjacencyValid).toBe(1);
    expect(v.vineRowMatch).toBe(0);
    expect(v.falsePositives).toBe(1);
    expect(v.withSavedBlock).toBe(1);
  });
  it("CSV marks rows non-authoritative and never says confirmed", () => {
    const csv = recoveryCsv([assessPin(pinP, corroborated())], { p: "check" });
    expect(csv.split("\n")[0]).toContain("NON_AUTHORITATIVE_CANDIDATE");
    expect(csv.split("\n")[1].startsWith("yes,")).toBe(true);
    expect(csv).not.toMatch(/confirmed/i);
  });
});

describe("navigation", () => {
  it("Pin Row Recovery sits under Operations right after Pins", () => {
    const ops = SYSTEM_ADMIN_GROUPS.find((g) => g.label === "Operations")!;
    const labels = ops.items.map((i) => i.label);
    expect(labels[labels.indexOf("Pins") + 1]).toBe("Pin Row Recovery");
    expect(ops.items.find((i) => i.label === "Pin Row Recovery")!.path).toBe("/admin/pin-row-recovery");
  });
  it("is not offered to a normal operator in search", () => {
    const viewer: any = { role: "operator", isSystemAdmin: false, irrigation: { records: false, reports: false, setup: false }, hasAccountBilling: false };
    expect(searchDestinations(viewer).some((d) => d.path === "/admin/pin-row-recovery")).toBe(false);
    expect(searchDestinations({ ...viewer, isSystemAdmin: true }).some((d) => d.path === "/admin/pin-row-recovery")).toBe(true);
  });
});

import { diffKey, trackSummary } from "@/lib/pinRowRecovery";
describe("diagnostics", () => {
  it("diffKey buckets signed differences", () => {
    expect([diffKey(-2), diffKey(-1), diffKey(0), diffKey(1), diffKey(2), diffKey(3), diffKey(0.5)]).toEqual(["-2", "-1", "0", "+1", "+2", "other", "other"]);
  });
  it("per-block distribution, era and snapped vs raw comparison without changing pins", () => {
    const known = [
      { id: "a", paddock_id: "b1", latitude: at(6.2).lat, longitude: at(6.2).lng, pin_row_number: 4, driving_row_number: 3.5, created_at: "2026-05-02" },
      { id: "b", paddock_id: "b1", latitude: at(6.2).lat, longitude: at(6.2).lng, pin_row_number: 5, driving_row_number: 4.5, created_at: "2026-05-03",
        snapped_latitude: at(9.8).lat, snapped_longitude: at(9.8).lng },
    ];
    const copy = JSON.stringify(known);
    const v = validateKnownPins(known, [pad]);
    expect(JSON.stringify(known)).toBe(copy);
    const b = v.perBlock[0];
    expect(b.diffs).toEqual({ "0": 1, "-1": 1 });
    expect(b.eras["2026-05"]).toEqual({ evaluated: 2, matched: 1 });
    expect(v.withSnapped).toBe(1);
    expect(v.snappedMatch).toBe(1); // snapped position sits in saved aisle 4.5
    expect(v.localMatch).toBe(1);
  });
  it("local segment aisle flags where midpoint projection is invalid (shorter, offset row)", () => {
    // Row 3 shortened to the north half: point in south half has no local row 3.
    const short = rows.map((r) => r.number === 3 ? { ...r, startPoint: { latitude: -33.9995, longitude: r.startPoint.longitude } } : r);
    const g = aisleGeometry(at(6.2) && { lat: -33.9998, lng: at(6.2).lng }, short, poly);
    expect(g.aisle).toBe(3.5);
    expect(g.localAisle).toBeNull();
    expect(g.methodDisagree).toBe(true);
  });
  it("failure categories distinguish missing block, outside polygon and headland", () => {
    expect(assessPin({ id: "n", latitude: -30, longitude: 140 }, corroborated()).category).toBe("missing_block");
    expect(assessPin({ ...pinP, latitude: -34.00005 }, corroborated()).category).toBe("headland_or_row_end");
    const offPad = { ...pad, polygon_points: poly.map((q) => ({ ...q, longitude: q.longitude + 1 })) };
    expect(assessPin(pinP, { ...corroborated(), paddocks: [offPad] }).category).toBe("outside_polygon");
  });
  it("track summary counts anchors and status transitions after loading tracks", () => {
    const ev = corroborated(); ev.evidence.set("p", { ...goodEvidence, heading_degrees: 5, observations: [] });
    const p = { ...pinP, heading: 5 };
    const before = [assessPin(p, { ...ev, trips: "not_loaded" })];
    const after = [assessPin(p, ev)];
    const s = trackSummary(before, after);
    expect(s.notLoaded).toBe(0);
    expect(s.unique).toBe(1);
    expect(s.travelFromTrack).toBe(1);
    expect(s.transitions["requires_review→supported_candidate"]).toBe(1);
    expect(trackSummary(before, before).notLoaded).toBe(1);
  });
});
