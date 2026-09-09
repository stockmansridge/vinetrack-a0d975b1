// Canonical spray report — schema 1.2 compatibility (SQL 232).
//
// 1.1 and 1.2 are both explicitly recognised. Validation is never disabled:
// an unknown version is still rejected, and 1.2 provenance is checked.
import { describe, it, expect } from "vitest";
import tracked11 from "../../docs/fixtures/spray-report-v1-stockmans-ridge.json";
import tracked12 from "../../docs/fixtures/spray-report-v1-2-tracked.json";
import manual12 from "../../docs/fixtures/spray-report-v1-2-manual.json";
import {
  parseSprayReportPayload,
  isManualEntryReport,
  sprayReportSourceLabel,
  MANUAL_ACTUAL_USE_BASIS,
  MANUAL_NOT_RECORDED_LABEL,
} from "@/lib/sprayReportV1";

describe("schema versions", () => {
  it("accepts an existing tracked 1.1 report unchanged", () => {
    const { payload, errors } = parseSprayReportPayload(tracked11);
    expect(errors).toEqual([]);
    expect(payload!.schemaVersion).toBe("1.1");
    expect(isManualEntryReport(payload)).toBe(false);
  });

  it("accepts a tracked 1.2 report and preserves tracked semantics", () => {
    const { payload, errors } = parseSprayReportPayload(tracked12);
    expect(errors).toEqual([]);
    expect(payload!.schemaVersion).toBe("1.2");
    expect(payload!.provenance!.source).toBe("tracked");
    expect(isManualEntryReport(payload)).toBe(false);
    expect(sprayReportSourceLabel(payload)).toBe("Tracked application");
    // Tracked content is untouched by the version bump.
    expect(payload!.rows.length).toBe((tracked11 as any).rows.length);
    expect(payload!.tanks[0].plannedWaterLitres).toEqual((tracked11 as any).tanks[0].plannedWaterLitres);
  });

  it("still rejects an unrecognised version", () => {
    expect(parseSprayReportPayload({ ...tracked11, schemaVersion: "2.0" }).payload).toBeNull();
    expect(parseSprayReportPayload({ ...tracked11, schemaVersion: "1.0" }).payload).toBeNull();
  });
});

describe("manual 1.2 report", () => {
  it("is identified only by explicit provenance", () => {
    const { payload, errors } = parseSprayReportPayload(manual12);
    expect(errors).toEqual([]);
    expect(isManualEntryReport(payload)).toBe(true);
    expect(payload!.provenance!.manualEntryId).toBeTruthy();
    expect(sprayReportSourceLabel(payload)).toBe("Manual entry");
  });

  it("carries null planned quantities and actual-use basis, never zero", () => {
    const { payload } = parseSprayReportPayload(manual12);
    for (const tank of payload!.tanks) {
      expect(tank.plannedWaterLitres).toBeNull();
      expect(tank.actualWaterLitres).toBeGreaterThan(0);
      for (const c of tank.chemicals) expect(c.plannedAmountBase).toBeNull();
    }
    expect(payload!.plannedChemicalTotals).toEqual([]);
    expect((payload!.application as any).actualUseBasis).toBe(MANUAL_ACTUAL_USE_BASIS);
  });

  it("labels absent route and row evidence instead of reporting a sync fault", () => {
    const { payload } = parseSprayReportPayload(manual12);
    expect(payload!.route).toBeNull();
    expect(payload!.rows).toEqual([]);
    expect(payload!.recordingEvidence!.route).toBe(MANUAL_NOT_RECORDED_LABEL);
    expect(payload!.recordingEvidence!.rows).toBe(MANUAL_NOT_RECORDED_LABEL);
  });

  it("rejects a manual report whose provenance is incoherent", () => {
    const bad = JSON.parse(JSON.stringify(manual12));
    bad.provenance.manualEntryId = null;
    expect(parseSprayReportPayload(bad).payload).toBeNull();
    const bad2 = JSON.parse(JSON.stringify(manual12));
    bad2.provenance.source = "tracked";
    expect(parseSprayReportPayload(bad2).payload).toBeNull();
  });
});
