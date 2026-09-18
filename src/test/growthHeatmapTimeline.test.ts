import { describe, expect, it } from "vitest";
import {
  advancePlayback,
  dayAtIndex,
  dayIndex,
  dayOffsetPct,
  playbackStartDay,
  resolveSelectedDay,
  snapToNearestDay,
  stepDay,
} from "@/lib/heatTimeline";
import {
  ALL_PHASES,
  EL_PHASES,
  PHASE_OPTIONS,
  elInPhase,
  phaseById,
  phaseColour,
  phaseForEl,
  phaseProgress,
} from "@/lib/growthPhases";
import {
  buildHeatModel,
  parseElStage,
  observationDays,
  toObservations,
} from "@/lib/growthHeatmap";

const BLOCK = [
  { lat: -34.5, lng: 138.5 },
  { lat: -34.5, lng: 138.51 },
  { lat: -34.49, lng: 138.51 },
  { lat: -34.49, lng: 138.5 },
];

const rec = (id: string, code: string, date: string, lat = -34.495, lng = -0) =>
  ({
    id,
    vineyard_id: "vy",
    paddock_id: "A",
    latitude: lat,
    longitude: 138.505 + lng,
    growth_stage_code: code,
    date,
  }) as any;

const DAYS = ["2027-01-05", "2027-01-12", "2027-01-20"];

describe("timeline selection", () => {
  it("resolves the latest date by default and keeps a valid selection", () => {
    expect(resolveSelectedDay(DAYS, null)).toBe("2027-01-20");
    expect(resolveSelectedDay(DAYS, "2027-01-12")).toBe("2027-01-12");
    // A date that no longer exists (phase/block change) falls back to latest.
    expect(resolveSelectedDay(DAYS, "2026-05-01")).toBe("2027-01-20");
    expect(resolveSelectedDay([], "2027-01-12")).toBeNull();
  });

  it("selects a clicked data marker", () => {
    const clicked = DAYS[0];
    expect(resolveSelectedDay(DAYS, clicked)).toBe("2027-01-05");
    expect(dayIndex(DAYS, clicked)).toBe(0);
    expect(dayOffsetPct(DAYS, DAYS[1])).toBe(50);
  });

  it("snaps slider movement to a real observation date", () => {
    expect(dayAtIndex(DAYS, 1)).toBe("2027-01-12");
    expect(dayAtIndex(DAYS, 99)).toBe("2027-01-20");
    expect(dayAtIndex(DAYS, -3)).toBe("2027-01-05");
    expect(snapToNearestDay(DAYS, "2027-01-11")).toBe("2027-01-12");
    expect(snapToNearestDay(DAYS, "2027-01-07")).toBe("2027-01-05");
  });

  it("moves previous and next between observation dates and stops at the ends", () => {
    expect(stepDay(DAYS, "2027-01-05", 1)).toBe("2027-01-12");
    expect(stepDay(DAYS, "2027-01-20", 1)).toBe("2027-01-20");
    expect(stepDay(DAYS, "2027-01-12", -1)).toBe("2027-01-05");
    expect(stepDay(DAYS, "2027-01-05", -1)).toBe("2027-01-05");
  });

  it("plays through the dates chronologically and stops at the latest", () => {
    let cur: string | null = playbackStartDay(DAYS, null);
    expect(cur).toBe("2027-01-05"); // restarts from the first date
    const seen: (string | null)[] = [cur];
    let playing = true;
    for (let i = 0; i < 10 && playing; i++) {
      const next = advancePlayback(DAYS, cur);
      cur = next.day;
      playing = next.playing;
      seen.push(cur);
    }
    expect(seen).toEqual(["2027-01-05", "2027-01-12", "2027-01-20", "2027-01-20"]);
    expect(playing).toBe(false);
    // Pause keeps the currently displayed date.
    expect(resolveSelectedDay(DAYS, cur)).toBe("2027-01-20");
  });
});

describe("development phases", () => {
  it("covers the documented E-L ranges including E-L 47", () => {
    expect(EL_PHASES.map((p) => [p.min, p.max])).toEqual([
      [1, 18],
      [19, 26],
      [27, 33],
      [34, 39],
      [41, 47],
    ]);
    expect(parseElStage("47")).toBe(47);
    expect(parseElStage("48")).toBeNull();
    expect(phaseForEl(47).id).toBe("senescence");
    expect(phaseForEl(23).id).toBe("flowering");
  });

  it("offers All phases first, covering every E-L value including the gaps", () => {
    expect(PHASE_OPTIONS[0]).toBe(ALL_PHASES);
    expect(phaseById("all")).toBe(ALL_PHASES);
    for (const el of [1, 18, 19, 26, 33, 40, 43, 47]) {
      expect(elInPhase(el, ALL_PHASES)).toBe(true);
    }
    const first = phaseColour(ALL_PHASES.min, ALL_PHASES);
    const last = phaseColour(ALL_PHASES.max, ALL_PHASES);
    expect(first.r).toBeGreaterThan(first.g);
    expect(last.g).toBeGreaterThan(last.r);
  });

  it("uses a separate red-to-green scale per phase", () => {
    for (const p of EL_PHASES) {
      const first = phaseColour(p.min, p);
      const last = phaseColour(p.max, p);
      expect(first.r).toBeGreaterThan(first.g);
      expect(last.g).toBeGreaterThan(last.r);
      expect(phaseProgress(p.min, p)).toBe(0);
      expect(phaseProgress(p.max, p)).toBe(1);
    }
  });
});

describe("phase + date filtering drives the heatmap", () => {
  const records = [
    rec("early", "12", "2027-01-05"),
    rec("flower-a", "23", "2027-01-12", -34.4955, 0.001),
    rec("flower-b", "25", "2027-01-20", -34.4945, -0.001),
  ];
  const obs = toObservations(records);
  const blocks = [{ id: "A", name: "Block A", polygon: BLOCK }];

  it("restricts observations, dates, median and counts to the phase", () => {
    const flowering = EL_PHASES.find((p) => p.id === "flowering")!;
    const phaseObs = obs.filter((o) => elInPhase(o.el, flowering));
    expect(phaseObs.map((o) => o.id)).toEqual(["flower-a", "flower-b"]);
    expect(observationDays(phaseObs)).toEqual(["2027-01-12", "2027-01-20"]);

    const early = buildHeatModel({ observations: phaseObs, blocks, atDateISO: "2027-01-12" });
    expect(early.qualifying.map((o) => o.id)).toEqual(["flower-a"]);
    expect(early.medianEl).toBe(23);

    const later = buildHeatModel({ observations: phaseObs, blocks, atDateISO: "2027-01-20" });
    expect(later.qualifying).toHaveLength(2);
    expect(later.medianEl).toBe(24);
  });

  it("never shows observations after the selected date", () => {
    const model = buildHeatModel({ observations: obs, blocks, atDateISO: "2027-01-05" });
    expect(model.qualifying.map((o) => o.id)).toEqual(["early"]);
  });
});
