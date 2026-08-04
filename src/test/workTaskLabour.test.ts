// Work Task labour maths used by the Work Tasks page and the pruning wrapper.
import { describe, expect, it } from "vitest";
import {
  elapsedHoursBetween, labourTotals, type LabourFieldsValue,
} from "@/components/work-tasks/WorkTaskLabourFields";

const cats = [{ id: "c1", vineyard_id: "v", name: "Contract Labour", cost_per_hour: 35 }];

const v = (p: Partial<LabourFieldsValue>): LabourFieldsValue => ({
  workerTypeId: null, workerCount: "", hoursPerWorker: "", hourlyRate: "", ...p,
});

describe("work task labour", () => {
  it("computes elapsed hours per person, overnight aware", () => {
    expect(elapsedHoursBetween("07:30", "17:00")).toBe(9.5);
    expect(elapsedHoursBetween("22:00", "02:30")).toBe(4.5);
    expect(elapsedHoursBetween("", "17:00")).toBeNull();
  });

  it("total labour = people × hours each, cost uses the labour type rate", () => {
    const t = labourTotals(v({ workerTypeId: "c1", workerCount: "2", hoursPerWorker: "9.5" }), cats);
    expect(t.rate).toBe(35);
    expect(t.totalHours).toBe(19);
    expect(t.totalCost).toBe(665);
  });

  it("example summary: 2 people × 6.5 h @ $35 = 13 h / $455", () => {
    const t = labourTotals(v({ workerTypeId: "c1", workerCount: "2", hoursPerWorker: "6.5" }), cats);
    expect(t.totalHours).toBe(13);
    expect(t.totalCost).toBe(455);
  });

  it("falls back to a manual rate when no labour type is selected", () => {
    const t = labourTotals(v({ workerCount: "3", hoursPerWorker: "4", hourlyRate: "28" }), cats);
    expect(t.totalHours).toBe(12);
    expect(t.totalCost).toBe(336);
  });
});
