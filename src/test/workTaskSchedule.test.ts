import { describe, it, expect } from "vitest";
import { EL_TARGET_OPTIONS, elStageLabel, scheduleCell, schedulePayload, validateSchedule, workTaskDateBounds } from "@/lib/workTaskSchedule";
import { workDateOf } from "@/lib/workTaskCompletion";

const el = (o: any = {}) => ({ id: "t", vineyard_id: "v", schedule_basis: "el_stage", target_el_stage: 23, date: "2026-10-01T03:00:00Z", start_date: null, end_date: null, is_finalized: false, ...o });

describe("E-L scheduled work tasks", () => {
  it("uses canonical labels within 1..43 only", () => {
    expect(EL_TARGET_OPTIONS.every((o) => o.value >= 1 && o.value <= 43)).toBe(true);
    expect(EL_TARGET_OPTIONS.some((o) => o.value === 47)).toBe(false);
    expect(elStageLabel(1)).toBe("E-L 01 — Winter bud");
  });
  it("requires a target stage, not a work date", () => {
    expect(validateSchedule("el_stage", "", null)).toMatch(/E-L/);
    expect(validateSchedule("el_stage", "", 44)).toMatch(/E-L/);
    expect(validateSchedule("el_stage", "", 23)).toBeNull();
    expect(validateSchedule("date", "", null)).toMatch(/date is required/);
  });
  it("switching to E-L clears planned start, keeps legacy anchor, never touches end_date", () => {
    const p = schedulePayload("el_stage", "2026-09-01", 23, "2026-09-01");
    expect(p).toEqual({ schedule_basis: "el_stage", target_el_stage: 23, start_date: null, date: "2026-09-01" });
    expect("end_date" in p).toBe(false);
    expect(schedulePayload("el_stage", "", 23, null).date).toBeUndefined(); // create → DB default anchor
  });
  it("date mode payload is unchanged", () => {
    expect(schedulePayload("date", "2026-09-01", null, "x")).toEqual({ schedule_basis: "date", target_el_stage: null, start_date: "2026-09-01", date: "2026-09-01" });
  });
  it("pending E-L shows stage only and has no date for filters/sort", () => {
    const t = el() as any;
    expect(scheduleCell(t, "Australia/Sydney")).toEqual({ stage: "E-L 23 — " + elStageLabel(23)!.split(" — ")[1], date: null, endDate: null });
    expect(workTaskDateBounds(t)).toEqual({ start: null, end: null });
    expect(workDateOf(t)).toBeNull();
  });
  it("completed E-L shows actual vineyard-local completion date across UTC midnight", () => {
    const t = el({ is_finalized: true, completed_at: "2026-11-02T14:30:00Z" }) as any; // 01:30 3 Nov Sydney
    expect(scheduleCell(t, "Australia/Sydney").date).toBe("2026-11-03");
    expect(scheduleCell(t, "Australia/Sydney").stage).toMatch(/^E-L 23/);
    expect(workTaskDateBounds(t, "Australia/Sydney")).toEqual({ start: "2026-11-03", end: "2026-11-03" });
  });
  it("completed E-L prefers business end_date; reopened returns to stage only", () => {
    expect(scheduleCell(el({ is_finalized: true, end_date: "2026-11-01", completed_at: "2026-11-02T14:30:00Z" }) as any, "Australia/Sydney").date).toBe("2026-11-01");
    expect(scheduleCell(el({ is_finalized: false, end_date: null, completed_at: null }) as any).date).toBeNull();
  });
  it("old records without schedule_basis behave as date tasks", () => {
    const t = { id: "t", vineyard_id: "v", date: "2026-08-05T00:00:00Z", start_date: "2026-08-05", is_finalized: false } as any;
    expect(scheduleCell(t)).toEqual({ stage: null, date: "2026-08-05", endDate: null });
    expect(workTaskDateBounds(t).start).toBe("2026-08-05");
  });
});

import { matchesElRange as _mer } from "@/lib/workTaskSchedule";
describe("E-L range filter", () => {
  const el = (n: number) => ({ schedule_basis: "el_stage", target_el_stage: n } as any);
  it("no bounds passes everything", () => { expect(_mer({ schedule_basis: "date" } as any, null, null)).toBe(true); });
  it("inclusive bounds", () => {
    expect(_mer(el(19), 19, 27)).toBe(true);
    expect(_mer(el(27), 19, 27)).toBe(true);
    expect(_mer(el(18), 19, 27)).toBe(false);
    expect(_mer(el(31), 19, 27)).toBe(false);
  });
  it("excludes date-scheduled tasks even with a compatibility date", () => {
    expect(_mer({ schedule_basis: "date", target_el_stage: null, date: "2026-01-01" } as any, 1, 43)).toBe(false);
  });
  it("single bound works", () => { expect(_mer(el(35), 30, null)).toBe(true); expect(_mer(el(5), null, 4)).toBe(false); });
});
