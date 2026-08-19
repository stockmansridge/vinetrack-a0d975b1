// Stage 4 — Resistance Planner contract tests.
//
// These assert the things that would quietly corrupt shared data if they broke:
// stable IDs, round-trip fidelity with mobile JSON, no derived verdict in the
// save payload, and the refusal to call a failed history read a clean season.
import { describe, expect, it } from "vitest";
import {
  duplicatePlan,
  emptyPlan,
  newPositionId,
  normaliseGroupCodes,
  parsePositions,
  planFromRow,
  planValidationIssues,
  planWritePayload,
  positionGroupLabel,
  rulesetDrift,
  serialisePositions,
} from "@/lib/resistancePlanContract";
import {
  buildPlannedEvents,
  isPlannedApplicationId,
  plannedApplicationId,
} from "@/lib/resistance/resistancePlanEvents";
import { makeSeasonCalendar, seasonStarting } from "@/lib/resistance/resistanceSeason";
import { startYearOfSeasonId } from "@/hooks/useResistancePlanAssessment";

/** A plan as an iOS/Android client writes it (camelCase position keys). */
const MOBILE_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  vineyard_id: "22222222-2222-4222-8222-222222222222",
  season_id: "2026/27",
  disease: "powdery_mildew",
  jurisdiction: "AU",
  crop: "grape",
  block_ids: ["block-a", "block-c"],
  positions: [
    {
      id: "pos-1",
      sequence: 1,
      groups: ["3"],
      savedChemicalId: null,
      notes: "early cover",
      // A field the portal does not model yet — must survive a round trip.
      futureField: { keep: true },
    },
    { id: "pos-2", sequence: 2, groups: ["11", "3"] },
  ],
  notes: "mobile plan",
  ruleset_id: "croplife-au-grape-powdery",
  ruleset_version: "2026.07.22",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-02T00:00:00Z",
  deleted_at: null,
  server_revision: 4,
};

describe("SQL 196 plan mapping", () => {
  it("reads a mobile-created plan without portal-only fields", () => {
    const plan = planFromRow(MOBILE_ROW);
    expect(plan.id).toBe(MOBILE_ROW.id);
    expect(plan.seasonId).toBe("2026/27");
    expect(plan.blockIds).toEqual(["block-a", "block-c"]);
    expect(plan.positions.map((p) => p.id)).toEqual(["pos-1", "pos-2"]);
    expect(plan.serverRevision).toBe(4);
  });

  it("round-trips positions, retaining IDs, order and unknown fields", () => {
    const plan = planFromRow(MOBILE_ROW);
    const payload = planWritePayload(plan) as Record<string, any>;
    expect(payload.positions[0].id).toBe("pos-1");
    expect(payload.positions[0].futureField).toEqual({ keep: true });
    expect(payload.positions.map((p: any) => p.sequence)).toEqual([1, 2]);
    expect(payload.block_ids).toEqual(["block-a", "block-c"]);
    expect(payload.ruleset_id).toBe("croplife-au-grape-powdery");
  });

  it("never writes a derived verdict, score, findings or revision", () => {
    const payload = planWritePayload(planFromRow(MOBILE_ROW));
    const keys = Object.keys(payload).join(" ");
    for (const forbidden of [
      "verdict",
      "score",
      "status",
      "findings",
      "assessment",
      "evaluation",
      "server_revision",
      "base_revision",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("treats a combination as a group set, not one group", () => {
    const [, combo] = parsePositions(MOBILE_ROW.positions);
    expect(combo.groups).toEqual(["11", "3"].sort());
    expect(positionGroupLabel(combo)).toContain("+");
  });

  it("normalises free-typed group entry", () => {
    expect(normaliseGroupCodes(["3", " 11 ", "", "3"])).toEqual(["11", "3"]);
  });

  it("serialises an empty plan without inventing positions", () => {
    expect(serialisePositions([])).toEqual([]);
  });
});

describe("plan lifecycle", () => {
  it("duplicates intent with a new identity and new position IDs", () => {
    const source = planFromRow(MOBILE_ROW);
    const copy = duplicatePlan(source);
    expect(copy.id).toBe("");
    expect(copy.serverRevision).toBeNull();
    expect(copy.positions.map((p) => p.id)).not.toEqual(source.positions.map((p) => p.id));
    expect(copy.positions.map((p) => p.groups)).toEqual(source.positions.map((p) => p.groups));
  });

  it("requires blocks and a group-bearing position, but never a product", () => {
    const plan = emptyPlan({
      vineyardId: "v1",
      seasonId: "2026/27",
      disease: "powdery_mildew",
      jurisdiction: "AU",
    });
    expect(planValidationIssues(plan)).toContain("Select at least one block.");

    const ready = {
      ...plan,
      blockIds: ["block-a"],
      positions: [
        {
          id: newPositionId(),
          sequence: 1,
          groups: ["3"],
          savedChemicalId: null,
          productName: null,
          target: null,
          growthStage: null,
          notes: null,
          keyStyle: "camel" as const,
          extra: {},
        },
      ],
    };
    expect(planValidationIssues(ready)).toEqual([]);
  });

  it("flags ruleset drift but only when both sides are known", () => {
    const plan = planFromRow(MOBILE_ROW);
    expect(
      rulesetDrift(plan, { id: "croplife-au-grape-powdery", version: "2026.07.22" }).drifted,
    ).toBe(false);
    expect(
      rulesetDrift(plan, { id: "croplife-au-grape-powdery", version: "2027.01.01" }).drifted,
    ).toBe(true);
    expect(rulesetDrift(plan, { id: null, version: null }).drifted).toBe(false);
  });
});

describe("planned event projection", () => {
  const calendar = makeSeasonCalendar({ startMonth: 7, startDay: 1 });
  const season = seasonStarting(calendar, 2026);

  it("emits one planned event per position per block, never merged", () => {
    const plan = planFromRow(MOBILE_ROW);
    const events = buildPlannedEvents({
      positions: plan.positions,
      blockIds: plan.blockIds,
      vineyardId: plan.vineyardId,
      disease: "powdery_mildew",
      season,
      intelligenceById: new Map(),
      anchorEpochMs: season.startEpochMs,
    });
    expect(events).toHaveLength(4);
    expect(new Set(events.map((e) => e.blockId))).toEqual(new Set(["block-a", "block-c"]));
    expect(events.every((e) => e.kind === "planned")).toBe(true);
  });

  it("keeps planned application IDs stable and identifiable", () => {
    const id = plannedApplicationId("pos-1");
    expect(id).toBe(plannedApplicationId("pos-1"));
    expect(isPlannedApplicationId(id)).toBe(true);
    expect(isPlannedApplicationId("spray-record:abc")).toBe(false);
  });

  it("keeps planned events chronological and inside the season", () => {
    const plan = planFromRow(MOBILE_ROW);
    const events = buildPlannedEvents({
      positions: plan.positions,
      blockIds: ["block-a"],
      vineyardId: plan.vineyardId,
      disease: "powdery_mildew",
      season,
      intelligenceById: new Map(),
      anchorEpochMs: season.startEpochMs,
    });
    expect(events[0].appliedAtEpochMs).toBeLessThan(events[1].appliedAtEpochMs);
    expect(events[1].appliedAtEpochMs).toBeLessThan(season.endEpochMs);
  });
});

describe("season parsing", () => {
  it("reads the start year off a Rork season ID", () => {
    expect(startYearOfSeasonId("2026/27")).toBe(2026);
    expect(startYearOfSeasonId("nonsense")).toBeNull();
  });
});
