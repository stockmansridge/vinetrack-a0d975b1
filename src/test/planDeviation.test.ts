// Stage 5A — pure comparison tests. No schema dependency: these exercise the
// helper only, because the authoritative linkage does not exist yet.
import { describe, expect, it } from "vitest";
import {
  comparePlanExecution,
  positionProgressStatus,
  type PlannedIntent,
} from "@/lib/resistance/planDeviation";

const planned: PlannedIntent = {
  positionId: "pos-1",
  groups: ["3"],
  blockIds: ["a", "b"],
  disease: "powdery_mildew",
};

describe("plan vs execution comparison", () => {
  it("calls an identical group, block and target set on plan", () => {
    const d = comparePlanExecution(planned, {
      referenceId: "job-1",
      groups: ["3"],
      blockIds: ["a", "b"],
      targets: ["powdery_mildew"],
    });
    expect(d.kind).toBe("exact_match");
    expect(d.onPlan).toBe(true);
  });

  it("reports a different group without calling it non-compliance", () => {
    const d = comparePlanExecution(planned, {
      referenceId: "job-1",
      groups: ["11"],
      blockIds: ["a", "b"],
      targets: ["powdery_mildew"],
    });
    expect(d.kind).toBe("different_group");
    expect(d.onPlan).toBe(false);
    expect(d.summary.toLowerCase()).not.toContain("exceed");
    expect(d.summary.toLowerCase()).not.toContain("non-compliant");
  });

  it("distinguishes a partially applied combination from a superset", () => {
    const combo: PlannedIntent = { ...planned, groups: ["3", "11"] };
    expect(
      comparePlanExecution(combo, {
        referenceId: "r",
        groups: ["3"],
        blockIds: ["a", "b"],
        targets: ["powdery_mildew"],
      }).kind,
    ).toBe("partial_combination");
    expect(
      comparePlanExecution(combo, {
        referenceId: "r",
        groups: ["3", "11", "7"],
        blockIds: ["a", "b"],
        targets: ["powdery_mildew"],
      }).kind,
    ).toBe("superset_match");
  });

  it("surfaces partial block execution rather than hiding it", () => {
    const d = comparePlanExecution(planned, {
      referenceId: "job-1",
      groups: ["3"],
      blockIds: ["a"],
      targets: ["powdery_mildew"],
    });
    expect(d.blocksNotCovered).toEqual(["b"]);
    expect(d.onPlan).toBe(false);
  });

  it("never claims agreement when chemistry or target is unknown", () => {
    expect(
      comparePlanExecution(planned, {
        referenceId: "r",
        groups: [],
        blockIds: ["a", "b"],
        targets: ["powdery_mildew"],
      }).kind,
    ).toBe("chemistry_unknown");

    const noTarget = comparePlanExecution(planned, {
      referenceId: "r",
      groups: ["3"],
      blockIds: ["a", "b"],
      targets: null,
    });
    expect(noTarget.targetUnknown).toBe(true);
    expect(noTarget.onPlan).toBe(false);
  });
});

describe("derived position status", () => {
  it("is 'planned' while nothing is linked — today's only possible state", () => {
    expect(positionProgressStatus({ linkedJobIds: [], linkedRecordIds: [] })).toBe("planned");
  });

  it("derives proposed, cancelled, completed and deviated from links only", () => {
    expect(positionProgressStatus({ linkedJobIds: ["j"], linkedRecordIds: [] })).toBe("proposed");
    expect(
      positionProgressStatus({ linkedJobIds: ["j"], linkedRecordIds: [], jobCancelled: true }),
    ).toBe("cancelled");
    const onPlan = comparePlanExecution(planned, {
      referenceId: "r",
      groups: ["3"],
      blockIds: ["a", "b"],
      targets: ["powdery_mildew"],
    });
    expect(
      positionProgressStatus({ linkedJobIds: ["j"], linkedRecordIds: ["r"], deviation: onPlan }),
    ).toBe("completed");
    const off = comparePlanExecution(planned, {
      referenceId: "r",
      groups: ["11"],
      blockIds: ["a", "b"],
      targets: ["powdery_mildew"],
    });
    expect(
      positionProgressStatus({ linkedJobIds: ["j"], linkedRecordIds: ["r"], deviation: off }),
    ).toBe("deviated");
  });
});
