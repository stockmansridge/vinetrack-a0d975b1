import { describe, it, expect } from "vitest";
import { aisleGeometry, pairVineRow, assessPin, isMissingRowPin, validateKnownPins, recoveryCsv } from "@/lib/pinRowRecovery";

// 5 north-running rows, 2.5 m apart, numbered 1..5 west→east.
const M_LNG = 1 / (111320 * Math.cos((-34 * Math.PI) / 180));
const rows = [1, 2, 3, 4, 5].map((n) => ({
  number: n,
  startPoint: { latitude: -34, longitude: 150 + (n - 1) * 2.5 * M_LNG },
  endPoint: { latitude: -33.999, longitude: 150 + (n - 1) * 2.5 * M_LNG },
}));
const poly = [
  { latitude: -34.0001, longitude: 150 - M_LNG }, { latitude: -34.0001, longitude: 150 + 12 * M_LNG },
  { latitude: -33.9989, longitude: 150 + 12 * M_LNG }, { latitude: -33.9989, longitude: 150 - M_LNG },
];
const pad = { id: "b1", name: "Blackberries", rows, polygon_points: poly };
const at = (m: number) => ({ lat: -33.9995, lng: 150 + m * M_LNG });
const ev = { paddocks: [pad], captureCounts: new Map([["p", 8]]), trips: null };

describe("pin row recovery (stage 1, read-only)", () => {
  it("finds aisle between two bounding rows, distinct from nearest row", () => {
    const g = aisleGeometry(at(5.6), rows); // between row 3 (5m) and 4 (7.5m), nearer 3
    expect(g.boundingRows).toEqual([3, 4]);
    expect(g.aisle).toBe(3.5);
    expect(g.nearestPhysicalRow).toBe(3);
  });
  it("pairs heading + side: north + left = west row, south + left = east row", () => {
    const g = aisleGeometry(at(5.6), rows);
    expect(pairVineRow(g, 0, "left").row).toBe(3);
    expect(pairVineRow(g, 0, "right").row).toBe(4);
    expect(pairVineRow(g, 180, "left").row).toBe(4);
  });
  it("refuses pairing when heading is across rows or missing", () => {
    const g = aisleGeometry(at(5.6), rows);
    expect(pairVineRow(g, 90, "left").row).toBeNull();
    expect(pairVineRow(g, null, "left").row).toBeNull();
  });
  it("supported candidate only with saved block, good accuracy, heading and side", () => {
    const p = { id: "p", latitude: at(6.2).lat, longitude: at(6.2).lng, paddock_id: "b1", heading: 2, pin_side: "Right", horizontal_accuracy: 2 };
    const r = assessPin(p, ev);
    expect(r.status).toBe("supported_candidate");
    expect(r.suggestedVineRow).toBe(4);
    expect(r.captureCount).toBe(8);
    expect(assessPin({ ...p, horizontal_accuracy: null }, ev).status).toBe("requires_review");
  });
  it("suggested block is marked and never supported", () => {
    const r = assessPin({ id: "q", latitude: at(6.2).lat, longitude: at(6.2).lng, heading: 0, pin_side: "left", horizontal_accuracy: 1 }, ev);
    expect(r.suggestedBlockName).toBe("Blackberries");
    expect(r.status).toBe("requires_review");
  });
  it("preserves existing segments / driving row", () => {
    expect(assessPin({ id: "s", latitude: at(6).lat, longitude: at(6).lng, paddock_id: "b1", pin_row_segments: [{ row_number: 108 }] }, ev).status).toBe("preserve_existing");
    expect(assessPin({ id: "d", latitude: at(6).lat, longitude: at(6).lng, paddock_id: "b1", driving_row_number: 3.5 }, ev).status).toBe("preserve_existing");
  });
  it("outside rows / no block is not resolvable", () => {
    expect(assessPin({ id: "o", latitude: at(11).lat, longitude: at(11).lng, paddock_id: "b1" }, ev).status).toBe("not_resolvable");
    expect(assessPin({ id: "n", latitude: -30, longitude: 140 }, ev).status).toBe("not_resolvable");
  });
  it("excludes pins with a saved row (e.g. Row 35 / aisle 34.5) from the missing queue", () => {
    expect(isMissingRowPin({ latitude: 1, longitude: 1, pin_row_number: 35, driving_row_number: 34.5 })).toBe(false);
    expect(isMissingRowPin({ latitude: 1, longitude: 1 })).toBe(true);
  });
  it("validation reports nearest-row ≠ saved row cases without false positives", () => {
    const known = [{ id: "k", paddock_id: "b1", latitude: at(5.6).lat, longitude: at(5.6).lng, pin_row_number: 4, driving_row_number: 3.5, heading: 0, pin_side: "right" }];
    const v = validateKnownPins(known, [pad]);
    expect(v.adjacencyValid).toBe(1);
    expect(v.aisleMatch).toBe(1);
    expect(v.nearestDiffersFromSaved).toBe(1);
    expect(v.vineRowMatch).toBe(1);
    expect(v.falsePositives).toBe(0);
  });
  it("CSV marks every row non-authoritative", () => {
    const r = assessPin({ id: "p", latitude: at(6.2).lat, longitude: at(6.2).lng, paddock_id: "b1" }, ev);
    const csv = recoveryCsv([r], { p: "check" });
    expect(csv.split("\n")[0]).toContain("NON_AUTHORITATIVE_CANDIDATE");
    expect(csv.split("\n")[1].startsWith("yes,")).toBe(true);
    expect(csv).not.toMatch(/confirmed/i);
  });
});
