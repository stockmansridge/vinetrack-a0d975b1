import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { deriveProgramProgression, jobVintage, parseElStages } from "@/lib/sprayProgramProgression";
import { currentVintageForSeason, seasonRangeForVintage } from "@/lib/vineyardSeasonSettingsQuery";
import { vintageScope } from "@/lib/vintageScope";
import { growthStageOrder } from "@/lib/sprayProgramStep";

const step = (id: string, el: string | null, name: string): any => ({ id, vineyard_id: "v", is_template: true, growth_stage_code: el, name });
const rec = (id: string, date: string, ref: string, spray_job_id: string | null = null): any => ({ id, date, spray_reference: ref, spray_job_id });
const S = vintageScope(2027, 7, 1);

describe("Vintage", () => {
  it("23 Oct 2026 with 1 July start is Vintage 2027", () => {
    expect(currentVintageForSeason(7, 1, new Date(2026, 9, 23))).toBe(2027);
  });
  it("Vintage 2027 spans 1 Jul 2026 – 30 Jun 2027", () => {
    expect(seasonRangeForVintage(7, 1, 2027)).toEqual({ startISO: "2026-07-01", endISO: "2027-06-30" });
  });
  it("Nov 2026 and Feb 2027 planned jobs both export as Vintage 2027, not calendar year", () => {
    expect(jobVintage({ planned_date: "2026-11-10" }, 7, 1)).toBe(2027);
    expect(jobVintage({ planned_date: "2027-02-10" }, 7, 1)).toBe(2027);
    expect(jobVintage({ planned_date: "2026-06-30" }, 7, 1)).toBe(2026);
  });
});

describe("progression", () => {
  it("EL2 + EL4 completed => next staged work begins EL9, numeric order", () => {
    const steps = [step("a", "EL2", "Woolly bud"), step("b", "EL4", "Bud burst"), step("c", "EL17", "x"), step("d", "EL12", "y"), step("e", "EL9", "z")];
    const r = deriveProgramProgression(steps, [rec("1", "2026-09-04", "Woolly bud EL2"), rec("2", "2026-10-14", "Bud burst / E-L Stage 4")], S);
    expect(r.nextFromProgram.map((s) => s.growth_stage_code)).toEqual(["EL9", "EL12", "EL17"]);
  });
  it("completing one EL9 step keeps an unrelated EL9 step", () => {
    const r = deriveProgramProgression([step("a", "EL9", "Mildew"), step("b", "EL9", "Mites")], [rec("1", "2026-10-20", "x", "a")], S);
    expect(r.nextFromProgram.map((s) => s.id)).toEqual(["b"]);
  });
  it("spray_job_id provenance wins over name matching", () => {
    const r = deriveProgramProgression([step("a", "EL9", "Mildew"), step("b", "EL9", "Mites")], [rec("1", "2026-10-20", "Mites EL9", "a")], S);
    expect([...r.completedStepIds]).toEqual(["a"]);
  });
  it("legacy fallback needs same stage + name, not every same-stage step", () => {
    const r = deriveProgramProgression([step("a", "EL4", "Bud Burst"), step("b", "EL4", "Mites"), step("c", "EL9", "Bud Burst")], [rec("1", "2026-10-14", "Bud Burst / E-L Stage 4")], S);
    expect([...r.completedStepIds]).toEqual(["a"]);
    expect(r.nextFromProgram.map((s) => s.id)).toEqual(["b", "c"]);
  });
  it("completed sprays outside the Vintage do not advance progression", () => {
    const r = deriveProgramProgression([step("a", "EL4", "Bud Burst"), step("b", "EL9", "z")], [rec("1", "2026-05-01", "Bud Burst EL4", "a")], S);
    expect(r.highestCompletedStage).toBeNull();
    expect(r.nextFromProgram.map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("unstaged remaining steps are Other Program Steps", () => {
    const r = deriveProgramProgression([step("a", null, "Banded"), step("b", "EL9", "z")], [], S);
    expect(r.otherProgramSteps.map((s) => s.id)).toEqual(["a"]);
  });
  it("numeric ordering EL9 < EL12 < EL17", () => {
    expect(growthStageOrder("EL9")! < growthStageOrder("EL12")!).toBe(true);
    expect(growthStageOrder("EL12")! < growthStageOrder("EL17")!).toBe(true);
  });
  it("parses ranges", () => { expect(parseElStages("Late Woolly Bud / E-L Stage 2-3")).toEqual([2, 3]); });
  it("Stockmans fixture: non-empty Next from Program starting at EL9", () => {
    const els = [1, 2, 4, 9, 12, 17, 19, 20, 25, 27, 31, 32, 35, 41];
    const steps = els.map((n) => step(`s${n}`, `EL${n}`, n === 2 ? "Late Woolly Bud" : n === 4 ? "Bud Burst" : `Step ${n}`));
    const recs = [
      rec("1", "2026-09-04", "Late Woolly Bud / E-L Stage 2-3"),
      rec("2", "2026-09-23", "Banded Spray"),
      rec("3", "2026-10-14", "Bud Burst / E-L Stage 4"),
      rec("old", "2025-11-01", "Step 41 EL41"),
    ];
    const r = deriveProgramProgression(steps, recs, S);
    expect(r.highestCompletedStage).toBe(4);
    expect(r.nextFromProgram[0].growth_stage_code).toBe("EL9");
    expect(r.nextFromProgram.map((s) => s.id)).not.toContain("s2");
    expect(r.nextFromProgram.map((s) => s.id)).not.toContain("s4");
    expect(r.nextFromProgram).toHaveLength(11);
  });
  it("derivation is pure: no backend calls", () => {
    const src = readFileSync("src/lib/sprayProgramProgression.ts", "utf8");
    expect(src).not.toMatch(/supabase|insert|upsert|createSprayJob/);
  });
});
