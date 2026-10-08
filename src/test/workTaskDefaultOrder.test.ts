import { describe, it, expect } from "vitest";
import { sortWorkTasksDefault } from "@/lib/workTaskDefaultOrder";

const now = new Date("2026-10-08T00:00:00Z"); // Sydney: 2026-10-08
const tz = "Australia/Sydney";
const t = (id: string, o: any) => ({ id, schedule_basis: "date", target_el_stage: null, is_finalized: false, date: "2020-01-01T00:00:00Z", start_date: null, ...o } as any);
const ids = (xs: any[]) => sortWorkTasksDefault(xs, tz, now).map((x) => x.id);

describe("Work Tasks default order", () => {
  it("To do first, E-L desc numeric, then upcoming dates, past, undated; completed last", () => {
    const list = [
      t("done-el", { schedule_basis: "el_stage", target_el_stage: 40, is_finalized: true, completed_at: "2026-09-01T00:00:00Z" }),
      t("past", { start_date: "2026-09-01" }),
      t("el9", { schedule_basis: "el_stage", target_el_stage: 9 }),
      t("far", { start_date: "2026-12-01" }),
      t("el23", { schedule_basis: "el_stage", target_el_stage: 23 }),
      t("today", { start_date: "2026-10-08" }),
      t("done-date", { start_date: "2026-10-01", is_finalized: true }),
    ];
    expect(ids(list)).toEqual(["el23", "el9", "today", "far", "past", "done-el", "done-date"]);
  });
  it("E-L tasks ignore the hidden compatibility date", () => {
    expect(ids([t("d", { start_date: "2026-10-09" }), t("e", { schedule_basis: "el_stage", target_el_stage: 2, date: "2026-10-08T00:00:00Z" })])).toEqual(["e", "d"]);
  });
  it("ties are deterministic by id", () => {
    const a = t("b", { schedule_basis: "el_stage", target_el_stage: 9 });
    const b = t("a", { schedule_basis: "el_stage", target_el_stage: 9 });
    expect(ids([a, b])).toEqual(["a", "b"]);
    expect(ids([b, a])).toEqual(["a", "b"]);
  });
  it("completed dates are most recent first", () => {
    expect(ids([t("o", { start_date: "2026-01-01", is_finalized: true }), t("n", { start_date: "2026-05-01", is_finalized: true })])).toEqual(["n", "o"]);
  });
});
