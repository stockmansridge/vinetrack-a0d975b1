// Stage 3C — parity tests for the ported Rork Resistance Rules Engine.
//
// These assert BEHAVIOUR the mobile engine guarantees, not implementation
// detail: a spray planned on the portal and the same spray planned on iOS must
// reach the same verdict, or a grower is being told two different things.
import { describe, expect, it } from "vitest";
import {
  evaluateResistance,
  makeEvent,
  makeSeasonCalendar,
  seasonForEpochMs,
  normaliseGroupCode,
  rulesetInForce,
  currentRuleset,
  evaluationFindings,
  evaluationBreaches,
  type ResistanceApplicationEvent,
} from "@/lib/resistance";

const calendar = makeSeasonCalendar({ startMonth: 7, startDay: 1 });
const at = (iso: string) => Date.parse(iso);
const season = seasonForEpochMs(calendar, at("2026-10-01T00:00:00Z"));

function spray(opts: {
  id: string;
  iso: string;
  groups: string[][];
  disease?: "powdery_mildew" | "downy_mildew";
  kind?: "actual" | "candidate";
  availability?: any;
}): ResistanceApplicationEvent {
  const epochMs = at(opts.iso);
  return makeEvent({
    applicationId: opts.id,
    kind: opts.kind ?? "actual",
    appliedAtEpochMs: epochMs,
    seasonId: seasonForEpochMs(calendar, epochMs).id,
    vineyardId: "v1",
    blockId: "b1",
    targets: [opts.disease ?? "powdery_mildew"],
    targetsRecorded: true,
    products: opts.groups.map((codes, i) => ({
      lineId: `${opts.id}-${i}`,
      productName: `Product ${i}`,
      savedChemicalId: null,
      groups: { codes: codes.map(normaliseGroupCode) },
      availability: opts.availability ?? "available_verified",
    })),
    mixturePartnerAtLabelRate: null,
  });
}

const evaluate = (
  events: ResistanceApplicationEvent[],
  candidate: ResistanceApplicationEvent | null,
  disease: "powdery_mildew" | "downy_mildew" = "powdery_mildew",
) =>
  evaluateResistance({
    jurisdiction: "AU",
    crop: "grape",
    disease,
    blockId: "b1",
    season,
    seasonCalendar: calendar,
    events,
    candidate,
  });

describe("group code normalisation", () => {
  it("strips scheme prefixes and resolves aliases the same way as mobile", () => {
    expect(normaliseGroupCode("FRAC 11")).toBe("11");
    expect(normaliseGroupCode("group 3")).toBe("3");
    expect(normaliseGroupCode(" u8 ")).toBe("50");
    expect(normaliseGroupCode("M 03")).toBe("M3");
  });
});

describe("ruleset resolution", () => {
  it("has an in-force 2026 strategy for AU grapes, both diseases", () => {
    for (const disease of ["powdery_mildew", "downy_mildew"] as const) {
      const rs = currentRuleset("AU", "grape", disease);
      expect(rs, disease).toBeTruthy();
      expect(rs!.rules.length).toBeGreaterThan(0);
    }
  });

  it("returns no ruleset for an unsupported jurisdiction rather than falling back to AU", () => {
    expect(currentRuleset("NZ" as any, "grape", "powdery_mildew")).toBeFalsy();
  });

  it("treats a strategy as in force on its effective instant (inclusive)", () => {
    const rs = currentRuleset("AU", "grape", "powdery_mildew")!;
    expect(rulesetInForce("AU", "grape", "powdery_mildew", rs.effectiveFromEpochMs)).toBeTruthy();
    expect(
      rulesetInForce("AU", "grape", "powdery_mildew", rs.effectiveFromEpochMs - 1),
    ).toBeFalsy();
  });
});

describe("consecutive-application rules", () => {
  it("flags a third consecutive Group 11 spray", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", groups: [["11"]] }),
      spray({ id: "b", iso: "2026-09-14T00:00:00Z", groups: [["11"]] }),
    ];
    const candidate = spray({
      id: "c",
      iso: "2026-09-28T00:00:00Z",
      groups: [["11"]],
      kind: "candidate",
    });
    const result = evaluate(history, candidate);
    expect(evaluationBreaches(result).length).toBeGreaterThan(0);
    expect(["strategy_exceeded", "limit_reached"]).toContain(result.status);
  });

  it("does not flag the same chemistry when an alternate group breaks the run", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", groups: [["11"]] }),
      spray({ id: "b", iso: "2026-09-14T00:00:00Z", groups: [["M3"]] }),
    ];
    const candidate = spray({
      id: "c",
      iso: "2026-09-28T00:00:00Z",
      groups: [["11"]],
      kind: "candidate",
    });
    expect(evaluationBreaches(evaluate(history, candidate))).toHaveLength(0);
  });
});

describe("seasonal maximum rules", () => {
  it("counts only sprays declared against the disease being assessed", () => {
    const history = Array.from({ length: 4 }, (_, i) =>
      spray({
        id: `dm-${i}`,
        iso: `2026-09-0${i + 1}T00:00:00Z`,
        groups: [["11"]],
        disease: "downy_mildew",
      }),
    );
    const result = evaluate(history, null, "powdery_mildew");
    expect(result.totalDiseaseSpraysInSeason).toBe(0);
  });

  it("counts sprays for the assessed disease within the season", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", groups: [["11"]] }),
      spray({ id: "b", iso: "2026-10-01T00:00:00Z", groups: [["3"]] }),
      // Previous season — must not be counted in the seasonal total.
      spray({ id: "old", iso: "2025-10-01T00:00:00Z", groups: [["3"]] }),
    ];
    expect(evaluate(history, null).totalDiseaseSpraysInSeason).toBe(2);
  });
});

describe("evidence handling", () => {
  it("never reports a clean result when chemistry is unavailable", () => {
    const candidate = spray({
      id: "c",
      iso: "2026-09-28T00:00:00Z",
      groups: [[]],
      kind: "candidate",
      availability: "unavailable",
    });
    const result = evaluate([], candidate);
    expect(result.status).toBe("unable_to_fully_assess");
    expect(result.evidenceQuality).not.toBe("high");
  });

  it("qualifies but still surfaces a breach found on unverified chemistry", () => {
    const history = [
      spray({
        id: "a",
        iso: "2026-09-01T00:00:00Z",
        groups: [["11"]],
        availability: "available_unverified",
      }),
      spray({
        id: "b",
        iso: "2026-09-14T00:00:00Z",
        groups: [["11"]],
        availability: "available_unverified",
      }),
    ];
    const candidate = spray({
      id: "c",
      iso: "2026-09-28T00:00:00Z",
      groups: [["11"]],
      kind: "candidate",
      availability: "available_unverified",
    });
    const result = evaluate(history, candidate);
    expect(evaluationBreaches(result).length).toBeGreaterThan(0);
    expect(result.evidenceQuality).toBe("qualified");
  });

  it("weakest link: one unverified line makes the whole application unverified", () => {
    const mixed = makeEvent({
      ...spray({ id: "m", iso: "2026-09-01T00:00:00Z", groups: [["11"], ["3"]] }),
      products: [
        {
          lineId: "1",
          productName: "Verified",
          savedChemicalId: null,
          groups: { codes: ["11"] },
          availability: "available_verified",
        },
        {
          lineId: "2",
          productName: "Unverified",
          savedChemicalId: null,
          groups: { codes: ["3"] },
          availability: "available_unverified",
        },
      ],
    });
    const result = evaluate([mixed], null);
    expect(result.evidenceQuality).not.toBe("high");
  });
});

describe("explainability", () => {
  it("every finding cites the published strategy text it came from", () => {
    const history = [
      spray({ id: "a", iso: "2026-09-01T00:00:00Z", groups: [["11"]] }),
      spray({ id: "b", iso: "2026-09-14T00:00:00Z", groups: [["11"]] }),
    ];
    const candidate = spray({
      id: "c",
      iso: "2026-09-28T00:00:00Z",
      groups: [["11"]],
      kind: "candidate",
    });
    const findings = evaluationFindings(evaluate(history, candidate));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.sourceReference.length).toBeGreaterThan(0);
      expect(f.sourceText.length).toBeGreaterThan(0);
      expect(f.explanation.length).toBeGreaterThan(0);
      expect(f.thresholdDescription.length).toBeGreaterThan(0);
    }
  });

  it("always produces an operator-facing summary sentence", () => {
    expect(evaluate([], null).summary.trim().length).toBeGreaterThan(0);
  });
});

describe("determinism", () => {
  it("orders same-instant applications by application id, not insertion order", () => {
    const a = spray({ id: "aaa", iso: "2026-09-01T00:00:00Z", groups: [["11"]] });
    const b = spray({ id: "bbb", iso: "2026-09-01T00:00:00Z", groups: [["3"]] });
    const forward = evaluate([a, b], null);
    const reverse = evaluate([b, a], null);
    expect(reverse.summary).toBe(forward.summary);
    expect(reverse.totalDiseaseSpraysInSeason).toBe(forward.totalDiseaseSpraysInSeason);
  });
});
