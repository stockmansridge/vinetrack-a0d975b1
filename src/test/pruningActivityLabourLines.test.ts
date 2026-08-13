// SQL 190 — pruning activity labour lines: summarising and cost precedence.
import { describe, it, expect } from "vitest";
import {
  resolvePruningActivityLabour, summarisePruningLabourLines,
  type PruningActivityLabourLine,
} from "@/lib/pruningActivityLabour";

const line = (p: Partial<PruningActivityLabourLine>): PruningActivityLabourLine => ({
  id: crypto.randomUUID(),
  pruning_activity_id: "a1",
  vineyard_id: "v1",
  work_date: "2026-08-01",
  worker_type_id: null,
  worker_type: "Crew",
  worker_count: 2,
  hours_per_worker: 4,
  total_hours: 8,
  hourly_rate: 30,
  total_cost: 240,
  notes: null,
  deleted_at: null,
  ...p,
});

describe("summarisePruningLabourLines", () => {
  it("sums person-hours and rated cost across lines", () => {
    const s = summarisePruningLabourLines([
      line({}),
      line({ worker_count: 1, hours_per_worker: 5, total_hours: 5, hourly_rate: 40, total_cost: 200 }),
    ]);
    expect(s.hours).toBe(13);
    expect(s.cost).toBe(440);
    expect(s.lineCount).toBe(2);
    expect(s.ratedLineCount).toBe(2);
  });

  it("returns NULL cost (not zero) when no line carries a rate", () => {
    const s = summarisePruningLabourLines([
      line({ hourly_rate: null, total_cost: null }),
    ]);
    expect(s.hours).toBe(8);
    expect(s.cost).toBeNull();
    expect(s.lineCount).toBe(1);
  });

  it("ignores soft-deleted lines", () => {
    const s = summarisePruningLabourLines([line({ deleted_at: "2026-08-02T00:00:00Z" })]);
    expect(s.lineCount).toBe(0);
    expect(s.cost).toBeNull();
  });

  it("derives hours from people × hours each when total_hours is absent", () => {
    const s = summarisePruningLabourLines([
      line({ total_hours: null, worker_count: 3, hours_per_worker: 2.5, total_cost: null }),
    ]);
    expect(s.hours).toBe(7.5);
    expect(s.cost).toBe(225);
  });
});

describe("resolvePruningActivityLabour precedence", () => {
  const lines = summarisePruningLabourLines([line({})]); // 8 h, $240

  it("1. piece rate snapshot wins over everything", () => {
    const r = resolvePruningActivityLabour({
      activityLines: lines, isPieceRate: true, taskCost: 137.5, legacyHours: 3, legacyRate: 20,
    });
    expect(r.cost).toBe(137.5);
    expect(r.costSource).toBe("piece_rate");
    expect(r.hours).toBe(8);
  });

  it("2. activity lines beat linked task labour lines", () => {
    const r = resolvePruningActivityLabour({ activityLines: lines, taskCost: 999 });
    expect(r.cost).toBe(240);
    expect(r.costSource).toBe("activity_labour_lines");
    expect(r.hoursSource).toBe("activity_labour_lines");
  });

  it("2b. unrated activity lines mean unknown cost, never task cost or zero", () => {
    const unrated = summarisePruningLabourLines([line({ hourly_rate: null, total_cost: null })]);
    const r = resolvePruningActivityLabour({ activityLines: unrated, taskCost: 999 });
    expect(r.cost).toBeNull();
    expect(r.costSource).toBe("activity_labour_lines");
    expect(r.hours).toBe(8);
  });

  it("3. linked work task cost is used when the activity has no lines", () => {
    const r = resolvePruningActivityLabour({ taskCost: 500, taskHours: 12, legacyHours: 3 });
    expect(r.cost).toBe(500);
    expect(r.costSource).toBe("work_task_labour_lines");
    expect(r.hours).toBe(12);
  });

  it("4. legacy scalar activity labour is the last resort", () => {
    const r = resolvePruningActivityLabour({ legacyHours: 4, legacyRate: 25 });
    expect(r.cost).toBe(100);
    expect(r.costSource).toBe("legacy_activity");
    expect(r.hoursSource).toBe("legacy_activity");
  });

  it("reports no known cost rather than $0.00 when nothing is recorded", () => {
    const r = resolvePruningActivityLabour({});
    expect(r.cost).toBeNull();
    expect(r.hours).toBeNull();
    expect(r.costSource).toBe("none");
  });
});
