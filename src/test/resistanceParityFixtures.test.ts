// Stage 3C — cross-platform parity fixtures.
//
// Each fixture asserts the RESULT STATE and the TRIGGERING RULE ID, not merely
// that "a warning exists": a portal that warns for the wrong reason is as
// wrong as one that stays silent.
import { describe, expect, it } from "vitest";
import {
  evaluateResistance,
  makeEvent,
  makeSeasonCalendar,
  seasonForEpochMs,
  normaliseGroupCode,
  currentRuleset,
  RESISTANCE_REGISTRY,
  POWDERY_MAX_USE_TABLE,
  evaluationFindings,
  worstEvaluationStatus,
  statusRequiresAcknowledgement,
  type ResistanceApplicationEvent,
  type ResistanceDisease,
  type ResistanceEvaluation,
} from "@/lib/resistance";

const calendar = makeSeasonCalendar({ startMonth: 7, startDay: 1 });
const at = (iso: string) => Date.parse(iso);
const season = seasonForEpochMs(calendar, at("2026-10-01T00:00:00Z"));

interface SprayOpts {
  id: string;
  iso: string;
  /** One entry per PRODUCT; inner array = that product's co-formulated groups. */
  products: string[][];
  disease?: ResistanceDisease;
  kind?: "actual" | "candidate";
  availability?: any;
  blockId?: string;
  targetsRecorded?: boolean;
  mixturePartnerAtLabelRate?: boolean | null;
}

function spray(o: SprayOpts): ResistanceApplicationEvent {
  const epochMs = at(o.iso);
  return makeEvent({
    applicationId: o.id,
    kind: o.kind ?? "actual",
    appliedAtEpochMs: epochMs,
    seasonId: seasonForEpochMs(calendar, epochMs).id,
    vineyardId: "v1",
    blockId: o.blockId ?? "b1",
    targets: o.targetsRecorded === false ? [] : [o.disease ?? "powdery_mildew"],
    targetsRecorded: o.targetsRecorded ?? true,
    products: o.products.map((codes, i) => ({
      lineId: `${o.id}-${i}`,
      productName: `Product ${i}`,
      savedChemicalId: null,
      groups: { codes: codes.map((c) => normaliseGroupCode(c)!).filter(Boolean) },
      availability: o.availability ?? "available_verified",
    })),
    mixturePartnerAtLabelRate: o.mixturePartnerAtLabelRate ?? null,
  });
}

const evaluate = (
  events: ResistanceApplicationEvent[],
  candidate: ResistanceApplicationEvent | null,
  disease: ResistanceDisease = "powdery_mildew",
  opts: { jurisdiction?: any; blockId?: string } = {},
): ResistanceEvaluation =>
  evaluateResistance({
    jurisdiction: opts.jurisdiction ?? "AU",
    crop: "grape",
    disease,
    blockId: opts.blockId ?? "b1",
    season,
    seasonCalendar: calendar,
    events,
    candidate,
  });

const ruleStatuses = (e: ResistanceEvaluation, ruleId: string) =>
  e.ruleResults.filter((r) => r.ruleId === ruleId).map((r) => r.status);

/* ------------------------------------------------------- ruleset identity */

describe("ruleset identity", () => {
  it("carries the exact Rork Powdery strategy", () => {
    const rs = currentRuleset(RESISTANCE_REGISTRY, "AU", "grape", "powdery_mildew")!;
    expect(rs.id).toBe("AU_GRAPE_POWDERY_2026_07_22");
    expect(rs.rulesetVersion).toBe("2026.07.22");
    expect(rs.rules).toHaveLength(23);
    expect(new Set(rs.rules.map((r) => r.id)).size).toBe(23);
  });

  it("carries the exact Rork Downy strategy", () => {
    const rs = currentRuleset(RESISTANCE_REGISTRY, "AU", "grape", "downy_mildew")!;
    expect(rs.id).toBe("AU_GRAPE_DOWNY_2026_07_22");
    expect(rs.rulesetVersion).toBe("2026.07.22");
    expect(rs.rules).toHaveLength(24);
    expect(new Set(rs.rules.map((r) => r.id)).size).toBe(24);
  });

  it("carries the full Powdery maximum-use table: 9 spray-count rows x 10 group columns", () => {
    expect(POWDERY_MAX_USE_TABLE.rows).toHaveLength(9);
    expect(POWDERY_MAX_USE_TABLE.columns).toHaveLength(10);
    expect(POWDERY_MAX_USE_TABLE.rows.map((r) => r.totalSprays)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(POWDERY_MAX_USE_TABLE.rows[8].isOrMore).toBe(true);
    for (const row of POWDERY_MAX_USE_TABLE.rows) {
      expect(Object.keys(row.maxByColumn)).toHaveLength(10);
    }
    // Spot-checks against the published grid.
    expect(POWDERY_MAX_USE_TABLE.rows[1].maxByColumn["3"]).toBe(2);
    expect(POWDERY_MAX_USE_TABLE.rows[8].maxByColumn["11"]).toBe(2);
    expect(POWDERY_MAX_USE_TABLE.rows[8].maxByColumn["5+3,7+12"]).toBe(1);
  });

  it("pins representative stable Rork rule IDs", () => {
    const powdery = currentRuleset(RESISTANCE_REGISTRY, "AU", "grape", "powdery_mildew")!;
    const downy = currentRuleset(RESISTANCE_REGISTRY, "AU", "grape", "downy_mildew")!;
    const ids = (rs: typeof powdery) => rs.rules.map((r) => r.id);
    for (const id of [
      "AU_GRAPE_POWDERY_FRAC3_MAX_CONSECUTIVE",
      "AU_GRAPE_POWDERY_FRAC11_MIXTURE_WHEN_CONSECUTIVE",
      "AU_GRAPE_POWDERY_FRAC21_MAX_FRACTION",
      "AU_GRAPE_POWDERY_FRAC11_MAX_FROM_TOTAL_TABLE",
    ]) {
      expect(ids(powdery)).toContain(id);
    }
    for (const id of [
      "AU_GRAPE_DOWNY_FRAC40_MAX_FRACTION",
      "AU_GRAPE_DOWNY_FRAC40_PLUS_49_MAX_FRACTION",
      "AU_GRAPE_DOWNY_FRAC49_NO_CONSECUTIVE",
      "AU_GRAPE_DOWNY_FRAC11_MAX_SEASON",
    ]) {
      expect(ids(downy)).toContain(id);
    }
    // Every rule result reports the rule and strategy it came from.
    const result = evaluate([spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["3"]] })], null);
    for (const r of result.ruleResults) {
      expect(ids(powdery)).toContain(r.ruleId);
      expect(r.rulesetId).toBe("AU_GRAPE_POWDERY_2026_07_22");
      expect(r.rulesetVersion).toBe("2026.07.22");
    }
  });
});

/* ------------------------------------------------------- powdery fixtures */

describe("powdery fixtures", () => {
  it("clean alternating sequence is a good fit on high evidence", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["M3"]] }),
      spray({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["3"]] }),
      spray({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["M3"]] }),
    ];
    const result = evaluate(history, null);
    expect(result.status).toBe("compliant");
    expect(result.evidenceQuality).toBe("high");
  });

  it("reaches the Group 3 consecutive maximum on the second consecutive spray", () => {
    const history = [spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["3"]] })];
    const candidate = spray({
      id: "cand",
      iso: "2026-09-14T00:00:00Z",
      products: [["3"]],
      kind: "candidate",
    });
    const result = evaluate(history, candidate);
    expect(result.status).toBe("limit_reached");
    expect(ruleStatuses(result, "AU_GRAPE_POWDERY_FRAC3_MAX_CONSECUTIVE")).toContain(
      "would_reach_limit",
    );
  });

  it("exceeds on a third consecutive Group 3 spray, citing the same rule", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["3"]] }),
      spray({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["3"]] }),
    ];
    const candidate = spray({
      id: "cand",
      iso: "2026-09-20T00:00:00Z",
      products: [["3"]],
      kind: "candidate",
    });
    const result = evaluate(history, candidate);
    expect(result.status).toBe("strategy_exceeded");
    expect(ruleStatuses(result, "AU_GRAPE_POWDERY_FRAC3_MAX_CONSECUTIVE")).toContain(
      "would_exceed_limit",
    );
  });

  it("cross-season: last season's sprays do not consume this season's allowance", () => {
    const previousSeason = [
      spray({ id: "p1", iso: "2025-09-01T00:00:00Z", products: [["3"]] }),
      spray({ id: "p2", iso: "2025-09-10T00:00:00Z", products: [["3"]] }),
    ];
    const candidate = spray({
      id: "cand",
      iso: "2026-09-20T00:00:00Z",
      products: [["3"]],
      kind: "candidate",
    });
    const result = evaluate(previousSeason, candidate);
    // Seasonal counters reset at the season boundary...
    expect(result.totalDiseaseSpraysInSeason).toBe(1);
    // ...while the chronology deliberately keeps the previous season's tail, so
    // a run of Group 3 that continues over the break is still a run.
    expect(ruleStatuses(result, "AU_GRAPE_POWDERY_FRAC3_MAX_CONSECUTIVE")).toContain(
      "would_exceed_limit",
    );
  });

  it("mixture unknown: a partner group present but unproven never passes", () => {
    const history = [
      spray({ id: "f1", iso: "2026-08-01T00:00:00Z", products: [["M3"]] }),
      spray({ id: "f2", iso: "2026-08-08T00:00:00Z", products: [["M3"]] }),
      spray({ id: "f3", iso: "2026-08-15T00:00:00Z", products: [["M3"]] }),
      spray({ id: "f4", iso: "2026-08-22T00:00:00Z", products: [["M3"]] }),
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["11"], ["M3"]] }),
      spray({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["11"], ["M3"]] }),
    ];
    const result = evaluate(history, null);
    const rule = result.ruleResults.find(
      (r) => r.ruleId === "AU_GRAPE_POWDERY_FRAC11_MIXTURE_WHEN_CONSECUTIVE",
    )!;
    expect(rule.status).toBe("requirement_unproven");
    expect(rule.mixtureRequirement).toBe("unknown");
    expect(result.status).toBe("unable_to_fully_assess");
  });

  it("mixture not satisfied: consecutive Group 11 with no alternative mode of action", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["11"]] }),
      spray({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["11"]] }),
    ];
    const rule = evaluate(history, null).ruleResults.find(
      (r) => r.ruleId === "AU_GRAPE_POWDERY_FRAC11_MIXTURE_WHEN_CONSECUTIVE",
    )!;
    expect(rule.status).toBe("requirement_not_met");
    expect(rule.mixtureRequirement).toBe("not_satisfied");
  });

  it("mixture satisfied only when the partner is confirmed at label rate", () => {
    const history = [
      spray({
        id: "a",
        iso: "2026-09-01T00:00:00Z",
        products: [["11"], ["M3"]],
        mixturePartnerAtLabelRate: true,
      }),
      spray({
        id: "b",
        iso: "2026-09-10T00:00:00Z",
        products: [["11"], ["M3"]],
        mixturePartnerAtLabelRate: true,
      }),
    ];
    const rule = evaluate(history, null).ruleResults.find(
      (r) => r.ruleId === "AU_GRAPE_POWDERY_FRAC11_MIXTURE_WHEN_CONSECUTIVE",
    )!;
    expect(rule.mixtureRequirement).toBe("satisfied");
    expect(rule.status).toBe("within_limit");
  });
});

/* --------------------------------------------------------- downy fixtures */

describe("downy fixtures", () => {
  const dm = (o: Omit<SprayOpts, "disease">) => spray({ ...o, disease: "downy_mildew" });

  it("clean alternating sequence is a good fit", () => {
    const history = [
      dm({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["M3"]] }),
      dm({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["40"]] }),
      dm({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["M3"]] }),
    ];
    const result = evaluate(history, null, "downy_mildew");
    expect(result.status).toBe("compliant");
    expect(result.evidenceQuality).toBe("high");
  });

  it("percentage ceiling: Group 40 above half of the downy sprays is exceeded", () => {
    const history = [
      dm({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["40"]] }),
      dm({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["M3"]] }),
      dm({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["40"]] }),
      dm({ id: "d", iso: "2026-09-30T00:00:00Z", products: [["40"]] }),
    ];
    const result = evaluate(history, null, "downy_mildew");
    expect(ruleStatuses(result, "AU_GRAPE_DOWNY_FRAC40_MAX_FRACTION")).toContain("limit_exceeded");
    expect(result.status).toBe("strategy_exceeded");
  });

  it("Group 40 solo and Group 40+49 co-formulated are different chemistry to the strategy", () => {
    const solo = [
      dm({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["40"]] }),
      dm({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["M3"]] }),
      dm({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["M3"]] }),
    ];
    const soloResult = evaluate(solo, null, "downy_mildew");
    expect(ruleStatuses(soloResult, "AU_GRAPE_DOWNY_FRAC40_PLUS_49_MAX_FRACTION")).toEqual([
      "not_triggered",
    ]);

    const combo = [
      dm({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["40", "49"]] }),
      dm({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["M3"]] }),
      dm({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["40", "49"]] }),
    ];
    const comboResult = evaluate(combo, null, "downy_mildew");
    expect(ruleStatuses(comboResult, "AU_GRAPE_DOWNY_FRAC40_PLUS_49_MAX_FRACTION")).not.toEqual([
      "not_triggered",
    ]);
  });
});

/* -------------------------------------------------------- shape fixtures */

describe("candidate, blocks, diseases and jurisdiction", () => {
  it("the candidate is inserted into the chronology and identified in the result", () => {
    const candidate = spray({
      id: "cand",
      iso: "2026-09-20T00:00:00Z",
      products: [["3"]],
      kind: "candidate",
    });
    const result = evaluate(
      [spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["M3"]] })],
      candidate,
    );
    expect(result.candidateApplicationId).toBe("cand");
    expect(result.totalDiseaseSpraysInSeason).toBe(2);
    expect(result.consideredApplicationIds).toContain("cand");
  });

  it("evaluates each block independently and takes the worst, never an average", () => {
    const events = [
      // Block A: clean. Block C: two Group 3 sprays already.
      spray({ id: "a1", iso: "2026-09-01T00:00:00Z", products: [["M3"]], blockId: "A" }),
      spray({ id: "c1", iso: "2026-09-01T00:00:00Z", products: [["3"]], blockId: "C" }),
      spray({ id: "c2", iso: "2026-09-10T00:00:00Z", products: [["3"]], blockId: "C" }),
    ];
    const candidateA = spray({
      id: "cand",
      iso: "2026-09-20T00:00:00Z",
      products: [["3"]],
      kind: "candidate",
      blockId: "A",
    });
    const candidateC = { ...candidateA, blockId: "C" };
    const a = evaluate(events, candidateA, "powdery_mildew", { blockId: "A" });
    const c = evaluate(events, candidateC, "powdery_mildew", { blockId: "C" });
    expect(a.status).toBe("compliant");
    expect(c.status).toBe("strategy_exceeded");
    expect(worstEvaluationStatus([a.status, c.status])).toBe("strategy_exceeded");
  });

  it("keeps powdery and downy histories and results separate", () => {
    const events = [
      spray({ id: "p1", iso: "2026-09-01T00:00:00Z", products: [["3"]] }),
      spray({ id: "p2", iso: "2026-09-10T00:00:00Z", products: [["3"]] }),
      spray({ id: "d1", iso: "2026-09-15T00:00:00Z", products: [["40"]], disease: "downy_mildew" }),
    ];
    const powdery = evaluate(events, null, "powdery_mildew");
    const downy = evaluate(events, null, "downy_mildew");
    expect(powdery.totalDiseaseSpraysInSeason).toBe(2);
    expect(downy.totalDiseaseSpraysInSeason).toBe(1);
    expect(powdery.disease).toBe("powdery_mildew");
    expect(downy.disease).toBe("downy_mildew");
  });

  it("a New Zealand vineyard is unsupported, never evaluated against AU rules", () => {
    const result = evaluate(
      [
        spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["3"]] }),
        spray({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["3"]] }),
        spray({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["3"]] }),
      ],
      null,
      "powdery_mildew",
      { jurisdiction: "NZ" },
    );
    expect(result.status).toBe("unsupported_ruleset");
    expect(result.ruleResults).toHaveLength(0);
    expect(result.rulesetId).toBeNull();
  });
});

/* ------------------------------------------------------- scheme safety */

describe("scheme safety", () => {
  it("does not treat an HRAC or IRAC code as the FRAC group with the same numeral", () => {
    expect(normaliseGroupCode("HRAC 3")).not.toBe("3");
    expect(normaliseGroupCode("IRAC 11")).not.toBe("11");
    expect(normaliseGroupCode("FRAC 3")).toBe("3");
  });

  it("a herbicide in the chronology cannot exceed a fungicide strategy", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["FRAC 3"]] }),
      spray({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["HRAC 3"]] }),
      spray({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["HRAC 3"]] }),
    ];
    const result = evaluate(history, null);
    expect(ruleStatuses(result, "AU_GRAPE_POWDERY_FRAC3_MAX_CONSECUTIVE")).not.toContain(
      "limit_exceeded",
    );
  });
});

/* --------------------------------------------------- good fit safety net */

describe("good fit is never returned on incomplete evidence", () => {
  const clean = spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["M3"]] });

  it("not when a relevant historical target is unknown", () => {
    const result = evaluate(
      [clean, spray({ id: "u", iso: "2026-09-05T00:00:00Z", products: [["3"]], targetsRecorded: false })],
      null,
    );
    expect(result.status).toBe("unable_to_fully_assess");
    expect(result.unattributedApplicationIds).toContain("u");
  });

  it("not when historical chemistry is unavailable", () => {
    const result = evaluate(
      [clean, spray({ id: "x", iso: "2026-09-05T00:00:00Z", products: [[]], availability: "unavailable" })],
      null,
    );
    expect(result.status).toBe("unable_to_fully_assess");
    expect(result.unassessableApplicationIds).toContain("x");
  });

  it("not when relevant chemistry is in conflict", () => {
    const result = evaluate(
      [clean, spray({ id: "k", iso: "2026-09-05T00:00:00Z", products: [["3"]], availability: "conflict" })],
      null,
    );
    expect(result.status).toBe("unable_to_fully_assess");
    expect(result.unassessableApplicationIds).toContain("k");
  });

  it("an unable result and an exceeded result both demand acknowledgement", () => {
    expect(statusRequiresAcknowledgement("unable_to_fully_assess")).toBe(true);
    expect(statusRequiresAcknowledgement("strategy_exceeded")).toBe(true);
    expect(statusRequiresAcknowledgement("compliant")).toBe(false);
    expect(statusRequiresAcknowledgement("unsupported_ruleset")).toBe(false);
  });
});

/* ----------------------------------------------------------- explainability */

describe("findings stay explainable", () => {
  it("carries rule identity, threshold, observation, contributors and dates", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["3"]] }),
      spray({ id: "b", iso: "2026-09-10T00:00:00Z", products: [["3"]] }),
      spray({ id: "c", iso: "2026-09-20T00:00:00Z", products: [["3"]] }),
    ];
    const finding = evaluationFindings(evaluate(history, null)).find(
      (f) => f.ruleId === "AU_GRAPE_POWDERY_FRAC3_MAX_CONSECUTIVE",
    )!;
    expect(finding.rulesetId).toBe("AU_GRAPE_POWDERY_2026_07_22");
    expect(finding.rulesetVersion).toBe("2026.07.22");
    expect(finding.groups).toContain("3");
    expect(finding.threshold).toBe(2);
    expect(finding.observedValue).toBe(3);
    expect(finding.contributingApplicationIds.length).toBeGreaterThan(0);
    expect(finding.contributingDatesEpochMs.length).toBe(
      finding.contributingApplicationIds.length,
    );
    expect(finding.evidenceQuality).toBeTruthy();
    expect(finding.sourceReference.length).toBeGreaterThan(0);
  });

  it("carries no numeric resistance score anywhere in the result", () => {
    const result = evaluate([spray({ id: "a", iso: "2026-09-01T00:00:00Z", products: [["3"]] })], null);
    expect(Object.keys(result)).not.toContain("score");
    for (const r of result.ruleResults) expect(Object.keys(r)).not.toContain("score");
  });
});

/* ------------------------------------------------------- no persistence */

describe("no verdict is ever persisted", () => {
  it("the saved spray job payload carries no resistance verdict, score or evaluation", async () => {
    const { emptySprayApplication } = await import("@/lib/sprayApplicationDomain");
    const { resolveApplicationGeometry } = await import("@/lib/sprayApplicationGeometry");
    const { calculateSprayApplication } = await import("@/lib/sprayCalculation");
    const { toSprayJobInput } = await import("@/lib/sprayApplicationSave");

    const application = {
      ...emptySprayApplication(),
      vineyardId: "v1",
      name: "Test",
      blockIds: ["A"],
      targets: ["powdery_mildew"],
    } as any;
    const geometry = resolveApplicationGeometry({
      paddocks: [{ id: "A", name: "Block A", area_ha: 10, row_width: 2.5 }],
      blockIds: ["A"],
      mode: application.mode,
      override: application.geometryOverride,
      totalTreatedBandWidthMetres: application.totalTreatedBandWidthMetres,
    });
    const calculation = calculateSprayApplication({ application, geometry });
    const { input } = toSprayJobInput({ application, geometry, calculation });

    const serialised = JSON.stringify(input).toLowerCase();
    for (const token of ["resistance", "verdict", "croplife", "compliance_status", "score"]) {
      expect(serialised.includes(token), token).toBe(false);
    }
  });
});
