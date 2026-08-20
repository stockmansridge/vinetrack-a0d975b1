// Stage 5C — Plan → Proposed → Actual contract tests (pure layer).
import { describe, expect, it } from "vitest";
import {
  derivePositionProgress,
  deviationAgainstSnapshot,
  frozenIntent,
  linkStateIsValidProvenance,
  normaliseLinkState,
  provenanceFromJobRow,
  provenanceFromPosition,
  provenanceWritePayload,
  resolveLinkStateLocally,
  strippedTemplateProvenance,
} from "@/lib/resistance/sprayJobPlanLink";
import {
  emptyPlan,
  newPositionId,
  parsePositions,
  type ResistancePlan,
  type ResistancePlanPosition,
} from "@/lib/resistancePlanContract";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { emptySprayApplication, fromLegacySprayJob } from "@/lib/sprayApplicationDomain";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { calculateSprayApplication } from "@/lib/sprayCalculation";

const position = (groups: string[], id = "pos-1"): ResistancePlanPosition =>
  parsePositions([{ id, sequence: 1, groups, target: "powdery_mildew" }])[0];

const plan = (positions: ResistancePlanPosition[], overrides: Partial<ResistancePlan> = {}): ResistancePlan => ({
  ...emptyPlan({ vineyardId: "v1", seasonId: "2026-27", disease: "powdery_mildew" }),
  id: "plan-1",
  blockIds: ["a", "b"],
  positions,
  serverRevision: 7,
  ...overrides,
});

const mapping = (app: ReturnType<typeof emptySprayApplication>) => {
  const geometry = resolveApplicationGeometry({
    paddocks: [],
    blockIds: app.blockIds,
    mode: app.mode,
    override: app.geometryOverride,
    totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
  });
  return toSprayJobInput({
    application: app,
    geometry,
    calculation: calculateSprayApplication({ application: app, geometry }),
  });
};

describe("SQL 201 provenance", () => {
  it("persists all four fields for a job created from a position", () => {
    const p = plan([position(["3"])]);
    const app = emptySprayApplication();
    app.vineyardId = "v1";
    app.blockIds = ["a", "b"];
    app.planProvenance = provenanceFromPosition({ plan: p, position: p.positions[0] });

    const { input } = mapping(app);
    expect(input.resistance_plan_id).toBe("plan-1");
    expect(input.resistance_position_id).toBe("pos-1");
    expect(input.resistance_plan_source_revision).toBe(7);
    expect((input.resistance_position_snapshot as any).groups).toEqual(["3"]);
  });

  it("keeps legacy jobs with all four fields NULL valid and unlinked", () => {
    const app = fromLegacySprayJob({ id: "j", vineyard_id: "v1" } as any);
    expect(app.planProvenance).toBeNull();
    expect(provenanceFromJobRow({} as any)).toBeNull();
  });

  it("reads back a mobile-created linked job", () => {
    const app = fromLegacySprayJob({
      id: "j",
      vineyard_id: "v1",
      resistance_plan_id: "plan-1",
      resistance_position_id: "pos-1",
      // mobile may store the snapshot as a JSON string
      resistance_position_snapshot: JSON.stringify({ id: "pos-1", groups: ["3"], sequence: 1 }),
      resistance_plan_source_revision: 4,
    } as any);
    expect(app.planProvenance?.planId).toBe("plan-1");
    expect(frozenIntent(app.planProvenance)?.groups).toEqual(["3"]);
  });

  it("freezes intent even after the plan position changes", () => {
    const p = plan([position(["3"])]);
    const provenance = provenanceFromPosition({ plan: p, position: p.positions[0] });
    // Plan later edited to FRAC 11 — the frozen snapshot must not follow.
    const edited = plan([position(["11"])]);
    expect(edited.positions[0].groups).toEqual(["11"]);
    expect(frozenIntent(provenance)?.groups).toEqual(["3"]);
    // A NEW job from the same position would use the current chemistry.
    expect(
      frozenIntent(provenanceFromPosition({ plan: edited, position: edited.positions[0] }))?.groups,
    ).toEqual(["11"]);
  });

  it("strips provenance from templates", () => {
    const p = plan([position(["3"])]);
    const app = emptySprayApplication();
    app.vineyardId = "v1";
    app.isTemplate = true;
    app.planProvenance = provenanceFromPosition({ plan: p, position: p.positions[0] });
    const { input } = mapping(app);
    expect(input.resistance_plan_id).toBeNull();
    expect(input.resistance_position_id).toBeNull();
    expect(input.resistance_position_snapshot).toBeNull();
    expect(input.resistance_plan_source_revision).toBeNull();
    expect(strippedTemplateProvenance()).toEqual(provenanceWritePayload(null));
  });
});

describe("link state", () => {
  const provenance = provenanceFromPosition({
    plan: plan([position(["3"])]),
    position: position(["3"]),
  });

  it("resolves a live plan position", () => {
    const state = resolveLinkStateLocally({
      provenance,
      jobVineyardId: "v1",
      plan: plan([position(["3"])]),
    });
    expect(state).toBe("resolved");
    expect(linkStateIsValidProvenance(state)).toBe(true);
  });

  it("treats a missing plan as pending_plan, not a failure", () => {
    const state = resolveLinkStateLocally({ provenance, jobVineyardId: "v1", plan: null });
    expect(state).toBe("pending_plan");
    expect(linkStateIsValidProvenance(state)).toBe(false);
  });

  it("never treats cross_vineyard_invalid as valid provenance", () => {
    const state = resolveLinkStateLocally({
      provenance,
      jobVineyardId: "v1",
      plan: plan([position(["3"])], { vineyardId: "other" }),
    });
    expect(state).toBe("cross_vineyard_invalid");
    expect(linkStateIsValidProvenance(state)).toBe(false);
  });

  it("keeps a removed position usable via its snapshot", () => {
    const state = resolveLinkStateLocally({
      provenance,
      jobVineyardId: "v1",
      plan: plan([position(["3"], newPositionId())]),
    });
    expect(state).toBe("position_missing");
    expect(frozenIntent(provenance)?.groups).toEqual(["3"]);
  });

  it("normalises server helper values", () => {
    expect(normaliseLinkState("valid")).toBe("resolved");
    expect(normaliseLinkState({ state: "pending_plan" })).toBe("pending_plan");
    expect(normaliseLinkState("cross_vineyard_invalid")).toBe("cross_vineyard_invalid");
    expect(normaliseLinkState("")).toBeNull();
  });
});

describe("position progress", () => {
  const base = { plannedBlockIds: ["a", "b"] };

  it("is planned with nothing linked", () => {
    expect(
      derivePositionProgress({
        ...base,
        coverage: { sprayJobIds: [], proposedBlockIds: [], completedBlockIds: [] },
      }),
    ).toBe("planned");
  });

  it("supports one position with many jobs and reports proposed coverage", () => {
    expect(
      derivePositionProgress({
        ...base,
        coverage: { sprayJobIds: ["j1", "j2"], proposedBlockIds: ["a", "b"], completedBlockIds: [] },
      }),
    ).toBe("proposed");
  });

  it("completes multi-block positions block by block", () => {
    const partial = derivePositionProgress({
      ...base,
      coverage: { sprayJobIds: ["j1"], proposedBlockIds: ["a", "b"], completedBlockIds: ["a"] },
    });
    expect(partial).toBe("partially_completed");
    expect(
      derivePositionProgress({
        ...base,
        coverage: { sprayJobIds: ["j1", "j2"], proposedBlockIds: ["a", "b"], completedBlockIds: ["a", "b"] },
      }),
    ).toBe("completed");
  });

  it("reports deviation only once the work is complete", () => {
    expect(
      derivePositionProgress({
        ...base,
        coverage: { sprayJobIds: ["j1"], proposedBlockIds: ["a", "b"], completedBlockIds: ["a", "b"] },
        anyDeviation: true,
      }),
    ).toBe("deviated");
  });
});

describe("deviation is separate from compliance", () => {
  const p = plan([position(["3"])]);
  const provenance = provenanceFromPosition({ plan: p, position: p.positions[0] });

  it("matches when the frozen groups were applied", () => {
    const d = deviationAgainstSnapshot({
      provenance,
      planDisease: "powdery_mildew",
      plannedBlockIds: ["a", "b"],
      executed: { referenceId: "j1", groups: ["3"], blockIds: ["a", "b"], targets: ["powdery_mildew"] },
    });
    expect(d.verdict).toBe("matches");
  });

  it("differs without asserting anything about resistance compliance", () => {
    const d = deviationAgainstSnapshot({
      provenance,
      planDisease: "powdery_mildew",
      plannedBlockIds: ["a", "b"],
      executed: { referenceId: "j1", groups: ["11"], blockIds: ["a", "b"], targets: ["powdery_mildew"] },
    });
    expect(d.verdict).toBe("differs");
    expect(d.summary.toLowerCase()).not.toContain("exceed");
    expect(d.summary.toLowerCase()).not.toContain("compliant");
  });

  it("cannot compare when chemistry or the snapshot is unknown", () => {
    expect(
      deviationAgainstSnapshot({
        provenance,
        planDisease: "powdery_mildew",
        plannedBlockIds: ["a", "b"],
        executed: { referenceId: "j1", groups: [], blockIds: ["a"], targets: null },
      }).verdict,
    ).toBe("not_comparable");
    expect(
      deviationAgainstSnapshot({
        provenance: null,
        planDisease: null,
        plannedBlockIds: [],
        executed: { referenceId: "j1", groups: ["3"], blockIds: [], targets: null },
      }).verdict,
    ).toBe("not_comparable");
  });
});

describe("plan is never written by job work", () => {
  it("job persistence touches spray_jobs columns only", () => {
    const p = plan([position(["3"])]);
    const app = emptySprayApplication();
    app.vineyardId = "v1";
    app.planProvenance = provenanceFromPosition({ plan: p, position: p.positions[0] });
    const { input } = mapping(app);
    const keys = Object.keys(input);
    expect(keys.some((k) => k.startsWith("plan_") || k === "positions" || k === "server_revision")).toBe(
      false,
    );
    // The plan's own revision is only carried as a read-only source stamp.
    expect(input.resistance_plan_source_revision).toBe(p.serverRevision);
  });
});
