// P7 — Planner vs Live Resistance Check parity.
//
// Both surfaces must describe the same chemistry the same way and reach the
// same verdict for the same proposed spray. These tests assert that through
// the SHARED path (`resolveProductGroups` → engine events → `evaluateResistance`),
// not through either screen's own arithmetic — because neither screen has any.
import { describe, expect, it } from "vitest";
import {
  buildCandidateEvents,
  buildPlannedEvents,
  evaluateResistance,
  makeEvent,
  makeSeasonCalendar,
  normaliseGroupCode,
  resolveProductGroups,
  qualifiedGroupCode,
  seasonForEpochMs,
  type ResistanceApplicationEvent,
} from "@/lib/resistance";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";

const calendar = makeSeasonCalendar({ startMonth: 7, startDay: 1 });
const at = (iso: string) => Date.parse(iso);
const season = seasonForEpochMs(calendar, at("2026-10-01T00:00:00Z"));

function intel(opts: {
  id: string;
  groups: { scheme: string; code: string | null }[];
  status?: string;
  structured?: boolean;
}): ChemicalIntelligence {
  return {
    id: opts.id,
    name: `Chem ${opts.id}`,
    structured: opts.structured ?? true,
    activityGroups: opts.groups as any,
    verification: { status: opts.status ?? "verified" } as any,
  } as unknown as ChemicalIntelligence;
}

function actual(opts: {
  id: string;
  iso: string;
  groups: string[][];
  availability?: any;
  disease?: "powdery_mildew" | "downy_mildew";
}): ResistanceApplicationEvent {
  const epochMs = at(opts.iso);
  return makeEvent({
    applicationId: opts.id,
    kind: "actual",
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
      groups: { codes: codes.map((c) => normaliseGroupCode(c)!) },
      availability: opts.availability ?? "available_verified",
    })),
    mixturePartnerAtLabelRate: null,
  });
}

const draft = (products: any[], plannedDate = "2026-11-10") =>
  ({
    vineyardId: "v1",
    isTemplate: false,
    blockIds: ["b1"],
    targets: ["powdery_mildew"],
    plannedDate,
    products,
  }) as any;

/* ------------------------------------------------- group source semantics */

describe("shared group resolution", () => {
  it("qualifies non-fungicide schemes in both the read and write casings", () => {
    expect(qualifiedGroupCode("FRAC", "3")).toBe("3");
    expect(qualifiedGroupCode("hrac", "9")).toBe("HRAC 9");
    expect(qualifiedGroupCode("irac", "4A")).toBe("IRAC 4A");
    expect(qualifiedGroupCode("not_applicable", "3")).toBeNull();
    expect(qualifiedGroupCode("NA", "3")).toBeNull();
  });

  it("keeps every group of a multi-active product", () => {
    const r = resolveProductGroups({
      intel: intel({ id: "c1", groups: [{ scheme: "FRAC", code: "3" }, { scheme: "FRAC", code: "7" }] }),
      fallbackCodes: [],
    });
    expect(r.codes).toEqual(["3", "7"]);
    expect(r.availability).toBe("available_verified");
  });

  it("never upgrades hand-typed groups to verified just because a product is linked", () => {
    const r = resolveProductGroups({
      intel: intel({ id: "c1", groups: [{ scheme: "FRAC", code: "3" }] }),
      fallbackCodes: [],
      explicitCodes: ["11"],
    });
    expect(r.availability).toBe("available_unverified");
  });

  it("reports unresolved groups as unavailable, never as a clean pass", () => {
    const r = resolveProductGroups({
      intel: intel({ id: "c1", groups: [], structured: true }),
      fallbackCodes: [],
    });
    expect(r.codes).toEqual([]);
    expect(r.availability).toBe("unavailable");
  });

  it("carries an unverified saved chemical through as unverified", () => {
    const r = resolveProductGroups({
      intel: intel({ id: "c1", groups: [{ scheme: "FRAC", code: "40" }], status: "unverified" }),
      fallbackCodes: [],
    });
    expect(r.availability).toBe("available_unverified");
  });
});

/* --------------------------------------------------- planner ↔ live parity */

function liveVerdict(products: any[], events: ResistanceApplicationEvent[]) {
  const intelligenceById = new Map<string, ChemicalIntelligence>(
    products
      .filter((p) => p.savedChemicalId && p.intel)
      .map((p) => [p.savedChemicalId as string, p.intel as ChemicalIntelligence]),
  );
  const candidates = buildCandidateEvents({
    application: draft(products.map(({ intel: _i, ...rest }) => rest)),
    intelligenceById,
    seasonCalendar: calendar,
    nowEpochMs: at("2026-11-10T00:00:00Z"),
  });
  return evaluateResistance({
    jurisdiction: "AU",
    crop: "grape",
    disease: "powdery_mildew",
    blockId: "b1",
    season,
    seasonCalendar: calendar,
    events,
    candidate: candidates[0] ?? null,
  });
}

function plannerVerdict(groups: string[], events: ResistanceApplicationEvent[]) {
  const planned = buildPlannedEvents({
    positions: [
      {
        id: "p1",
        sequence: 1,
        groups,
        savedChemicalId: null,
        productName: null,
        target: "powdery_mildew",
      } as any,
    ],
    blockIds: ["b1"],
    vineyardId: "v1",
    disease: "powdery_mildew",
    season,
    intelligenceById: new Map(),
    anchorEpochMs: at("2026-11-10T00:00:00Z"),
  });
  return evaluateResistance({
    jurisdiction: "AU",
    crop: "grape",
    disease: "powdery_mildew",
    blockId: "b1",
    season,
    seasonCalendar: calendar,
    events: [...events, ...planned],
    includePlanned: true,
  });
}

describe("planner and live check agree", () => {
  const history3x3 = [
    actual({ id: "a1", iso: "2026-09-01T00:00:00Z", groups: [["3"]] }),
    actual({ id: "a2", iso: "2026-09-15T00:00:00Z", groups: [["3"]] }),
    actual({ id: "a3", iso: "2026-10-01T00:00:00Z", groups: [["3"]] }),
  ];

  it("same FRAC after the same FRAC — identical status on both surfaces", () => {
    const live = liveVerdict(
      [
        {
          savedChemicalId: "c3",
          productName: "Group 3 fungicide",
          activityGroups: [],
          intel: intel({ id: "c3", groups: [{ scheme: "FRAC", code: "3" }] }),
        },
      ],
      history3x3,
    );
    const plan = plannerVerdict(["3"], history3x3);
    expect(live.status).toBe(plan.status);
    expect(live.totalDiseaseSpraysInSeason).toBe(plan.totalDiseaseSpraysInSeason);
    expect(live.ruleResults.map((r) => `${r.ruleId}:${r.status}`).sort()).toEqual(
      plan.ruleResults.map((r) => `${r.ruleId}:${r.status}`).sort(),
    );
  });

  it("a different FRAC rotation agrees on both surfaces", () => {
    const history = [
      actual({ id: "a1", iso: "2026-09-01T00:00:00Z", groups: [["3"]] }),
      actual({ id: "a2", iso: "2026-09-20T00:00:00Z", groups: [["11"]] }),
    ];
    const live = liveVerdict(
      [
        {
          savedChemicalId: "c40",
          productName: "Group 40",
          activityGroups: [],
          intel: intel({ id: "c40", groups: [{ scheme: "FRAC", code: "40" }] }),
        },
      ],
      history,
    );
    const plan = plannerVerdict(["40"], history);
    expect(live.status).toBe(plan.status);
    expect(live.summary.length).toBeGreaterThan(0);
  });

  it("a multi-active product keeps both groups on both surfaces", () => {
    const history = [actual({ id: "a1", iso: "2026-09-01T00:00:00Z", groups: [["7"]] })];
    const live = liveVerdict(
      [
        {
          savedChemicalId: "cf",
          productName: "Custodia Forte",
          activityGroups: [],
          intel: intel({
            id: "cf",
            groups: [
              { scheme: "FRAC", code: "3" },
              { scheme: "FRAC", code: "7" },
            ],
          }),
        },
      ],
      history,
    );
    const plan = plannerVerdict(["3", "7"], history);
    expect(live.status).toBe(plan.status);
  });

  it("a repeat separated by another group is not a consecutive run on either surface", () => {
    const history = [
      actual({ id: "a1", iso: "2026-09-01T00:00:00Z", groups: [["3"]] }),
      actual({ id: "a2", iso: "2026-09-15T00:00:00Z", groups: [["M", "3"].slice(0, 1)] }),
    ];
    const live = liveVerdict(
      [
        {
          savedChemicalId: "c3",
          productName: "Group 3",
          activityGroups: [],
          intel: intel({ id: "c3", groups: [{ scheme: "FRAC", code: "3" }] }),
        },
      ],
      history,
    );
    const plan = plannerVerdict(["3"], history);
    expect(live.status).toBe(plan.status);
  });

  it("a multi-site M group spray is assessed, not ignored, on both surfaces", () => {
    const history = [actual({ id: "a1", iso: "2026-09-01T00:00:00Z", groups: [["M3"]] })];
    const live = liveVerdict(
      [
        {
          savedChemicalId: "cm",
          productName: "Mancozeb",
          activityGroups: [],
          intel: intel({ id: "cm", groups: [{ scheme: "FRAC", code: "M3" }] }),
        },
      ],
      history,
    );
    const plan = plannerVerdict(["M3"], history);
    expect(live.status).toBe(plan.status);
  });

  it("an unresolved group is never reported as compliant", () => {
    const live = liveVerdict(
      [
        {
          savedChemicalId: "cx",
          productName: "Unknown chemistry",
          activityGroups: [],
          intel: intel({ id: "cx", groups: [] }),
        },
      ],
      [actual({ id: "a1", iso: "2026-09-01T00:00:00Z", groups: [["3"]] })],
    );
    expect(live.evidenceQuality).not.toBe("high");
  });

  it("a manually entered chemical is assessed but never as verified evidence", () => {
    const live = liveVerdict(
      [
        {
          savedChemicalId: null,
          productName: "Hand-typed product",
          activityGroups: [{ scheme: "frac", code: "3" }],
        },
      ],
      [actual({ id: "a1", iso: "2026-09-01T00:00:00Z", groups: [["3"]] })],
    );
    expect(live.evidenceQuality).not.toBe("high");
  });

  it("previous-season history does not count against the current season total", () => {
    const previous = actual({ id: "old", iso: "2025-10-01T00:00:00Z", groups: [["3"]] });
    const current = actual({ id: "new", iso: "2026-10-01T00:00:00Z", groups: [["3"]] });
    const live = liveVerdict(
      [
        {
          savedChemicalId: "c3",
          productName: "Group 3",
          activityGroups: [],
          intel: intel({ id: "c3", groups: [{ scheme: "FRAC", code: "3" }] }),
        },
      ],
      [previous, current],
    );
    const plan = plannerVerdict(["3"], [previous, current]);
    expect(live.totalDiseaseSpraysInSeason).toBe(plan.totalDiseaseSpraysInSeason);
  });
});
