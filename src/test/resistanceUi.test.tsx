// Stage 3C — Resistance Check UI states and Review integration.
//
// The assessment hook is mocked so each engine state can be rendered
// deterministically; the engine itself is covered by the parity suites.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ResistanceAssessment } from "@/hooks/useResistanceAssessment";
import type { ResistanceEvaluation, ResistanceEvaluationStatus } from "@/lib/resistance";

const assessmentRef: { current: ResistanceAssessment } = { current: null as any };

vi.mock("@/hooks/useResistanceAssessment", async () => {
  const actual = await vi.importActual<any>("@/hooks/useResistanceAssessment");
  return {
    ...actual,
    useResistanceAssessment: () => assessmentRef.current,
  };
});

import { ResistanceStep } from "@/components/spray/wizard/ResistanceStep";
import { ResistanceAcknowledgement } from "@/components/spray/wizard/ResistanceAcknowledgement";
import { emptySprayApplication } from "@/lib/sprayApplicationDomain";

function evaluation(
  status: ResistanceEvaluationStatus,
  over: Partial<ResistanceEvaluation> = {},
): ResistanceEvaluation {
  return {
    status,
    jurisdiction: "AU",
    crop: "grape",
    disease: "powdery_mildew",
    blockId: "A",
    seasonId: "2026-27",
    rulesetId: "AU_GRAPE_POWDERY_2026_07_22",
    rulesetVersion: "2026.07.22",
    rulesetValidFrom: "2026-07-22",
    ruleResults: [],
    totalDiseaseSpraysInSeason: 3,
    consideredApplicationIds: [],
    unassessableApplicationIds: [],
    unattributedApplicationIds: [],
    excludedPlannedApplicationIds: [],
    evidenceQuality: "high",
    summary: `Summary for ${status}`,
    candidateApplicationId: null,
    ...over,
  };
}

function assessment(over: Partial<ResistanceAssessment> = {}): ResistanceAssessment {
  return {
    isLoading: false,
    error: null,
    season: { id: "2026-27", label: "2026/27", startEpochMs: 0, endEpochMs: 1 } as any,
    diseases: ["powdery_mildew"],
    blocks: [{ blockId: "A", blockName: "Block A", evaluations: [evaluation("compliant")] }],
    unresolvedByDisease: { powdery_mildew: [] },
    supported: true,
    jurisdictionLabelCode: "AU",
    overallStatus: "compliant",
    requiresAcknowledgement: false,
    ...over,
  };
}

const app = { ...emptySprayApplication(), blockIds: ["A"], targets: ["powdery_mildew"] as any };

function renderStep(a: ResistanceAssessment) {
  assessmentRef.current = a;
  return render(
    <ResistanceStep
      app={app as any}
      patch={() => {}}
      update={() => {}}
      geometry={{} as any}
      calc={{ diagnostics: [], tanks: [] } as any}
      lookups={{
        paddocks: [{ id: "A", name: "Block A" }],
        tractors: [],
        equipment: [],
        members: [],
        maps: {
          paddocks: new Map([["A", "Block A"]]),
          tractors: new Map(),
          equipment: new Map(),
          members: new Map(),
        },
      }}
      intelligenceById={new Map()}
      vineyardId="v1"
      canEdit
    />,
  );
}

describe("Resistance step UI states", () => {
  it("shows a loading state while season history is read", () => {
    renderStep(assessment({ isLoading: true }));
    expect(screen.getByText(/Reading season spray history/i)).toBeTruthy();
  });

  it("renders a good-fit result with the strategy metadata", () => {
    renderStep(assessment());
    expect(screen.getByText("No limit reached")).toBeTruthy();
    expect(screen.getByText(/Summary for compliant/)).toBeTruthy();
    expect(screen.getByText(/Strategy 2026.07.22/)).toBeTruthy();
    expect(screen.getByText(/CropLife Australia resistance management strategies/i)).toBeTruthy();
  });

  it("renders approaching, reached and exceeded states distinctly", () => {
    for (const [status, label] of [
      ["approaching_limit", "Approaching a limit"],
      ["limit_reached", "Strategy maximum reached"],
      ["strategy_exceeded", "Strategy exceeded"],
    ] as const) {
      const view = renderStep(
        assessment({
          blocks: [{ blockId: "A", blockName: "Block A", evaluations: [evaluation(status)] }],
          overallStatus: status,
        }),
      );
      expect(screen.getByText(label)).toBeTruthy();
      view.unmount();
    }
  });

  it("renders unable-to-assess without any clean wording", () => {
    renderStep(
      assessment({
        blocks: [
          {
            blockId: "A",
            blockName: "Block A",
            evaluations: [evaluation("unable_to_fully_assess", { evidenceQuality: "indeterminate" })],
          },
        ],
        overallStatus: "unable_to_fully_assess",
      }),
    );
    expect(screen.getByText("Unable to fully assess")).toBeTruthy();
    expect(screen.getByText("Incomplete evidence")).toBeTruthy();
  });

  it("states plainly that an unsupported jurisdiction is not evaluated against AU rules", () => {
    renderStep(assessment({ supported: false, jurisdictionLabelCode: "NZ" }));
    expect(screen.getByText(/Australian limits are deliberately not applied/i)).toBeTruthy();
  });

  it("renders one section per block and one card per disease", () => {
    renderStep(
      assessment({
        diseases: ["powdery_mildew", "downy_mildew"],
        blocks: [
          {
            blockId: "A",
            blockName: "Block A",
            evaluations: [
              evaluation("compliant"),
              evaluation("limit_reached", { disease: "downy_mildew" }),
            ],
          },
          {
            blockId: "C",
            blockName: "Block C",
            evaluations: [evaluation("strategy_exceeded", { blockId: "C" })],
          },
        ],
        overallStatus: "strategy_exceeded",
      }),
    );
    expect(screen.getByText("Block A")).toBeTruthy();
    expect(screen.getByText("Block C")).toBeTruthy();
    expect(screen.getAllByText("Powdery Mildew").length).toBeGreaterThan(0);
    expect(screen.getByText("Downy Mildew")).toBeTruthy();
  });

  it("warns that unattributed sprays make block results incomplete", () => {
    renderStep(
      assessment({
        unresolvedByDisease: {
          powdery_mildew: [
            {
              applicationId: "r1",
              vineyardId: "v1",
              appliedAtEpochMs: 1,
              seasonId: "2026-27",
              kind: "actual",
              targets: ["powdery_mildew"],
              targetsRecorded: true,
              products: [],
            },
          ],
        },
      }),
    );
    expect(screen.getByText(/no recorded blocks/i)).toBeTruthy();
  });
});

describe("Review acknowledgement", () => {
  const setup = (status: ResistanceEvaluationStatus, requires: boolean) => {
    const onChange = vi.fn();
    render(
      <ResistanceAcknowledgement
        status={status}
        lines={["Block A: Summary"]}
        requiresAcknowledgement={requires}
        acknowledged={false}
        onAcknowledgedChange={onChange}
      />,
    );
    return onChange;
  };

  it("asks for acknowledgement when the strategy is exceeded", () => {
    const onChange = setup("strategy_exceeded", true);
    const box = screen.getByTestId("resistance-ack");
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("asks for acknowledgement when the rotation cannot be fully assessed", () => {
    setup("unable_to_fully_assess", true);
    expect(screen.getByText(/cannot be fully assessed/i)).toBeTruthy();
  });

  it("does not ask for acknowledgement on a good fit", () => {
    setup("compliant", false);
    expect(screen.queryByTestId("resistance-ack")).toBeNull();
    expect(screen.getByText("Good fit — no limit reached")).toBeTruthy();
  });

  it("is informational only for an unsupported jurisdiction", () => {
    setup("unsupported_ruleset", false);
    expect(screen.queryByTestId("resistance-ack")).toBeNull();
    expect(screen.getByText("No strategy configured for this country")).toBeTruthy();
  });
});
