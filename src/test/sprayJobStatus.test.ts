// Ticket #46 — spray_jobs_status_check must never be violated by the Portal.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SELECTABLE_SPRAY_JOB_STATUSES,
  SPRAY_JOB_STATUSES,
  SPRAY_JOB_STATUS_LABEL,
  normalizeSprayJobStatus,
  sprayJobStatusForSave,
} from "@/lib/sprayJobStatus";
import { toSprayJobInput } from "@/lib/sprayApplicationSave";
import { resolveApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import { calculateSprayApplication } from "@/lib/sprayCalculation";
import { emptySprayApplication, type SprayApplication } from "@/lib/sprayApplicationDomain";
import { hydrateDraft } from "@/lib/sprayApplicationDraft";
import { planSprayPrefillFromProgramStep } from "@/lib/sprayProgramStep";

// Exact live constraint (read from the shared backend for ticket #46).
const CONSTRAINT = ["draft", "planned", "in_progress", "completed", "cancelled", "archived"];

function save(app: SprayApplication) {
  const geometry = resolveApplicationGeometry({
    paddocks: [{ id: "A", name: "A", area_ha: 2, row_width: 2.5 }],
    blockIds: app.isTemplate ? [] : app.blockIds,
    mode: app.mode,
    override: app.geometryOverride,
    totalTreatedBandWidthMetres: app.totalTreatedBandWidthMetres,
  });
  const calculation = calculateSprayApplication({ application: app, geometry });
  return toSprayJobInput({ application: app, geometry, calculation }).input;
}
const draft = (over: Partial<SprayApplication> = {}): SprayApplication => ({
  ...emptySprayApplication(), vineyardId: "v1", name: "Job", blockIds: ["A"], ...over,
});

describe("spray job status (ticket #46)", () => {
  it("every offered and canonical status is allowed by the constraint", () => {
    expect([...SPRAY_JOB_STATUSES].sort()).toEqual([...CONSTRAINT].sort());
    for (const s of SELECTABLE_SPRAY_JOB_STATUSES) expect(CONSTRAINT).toContain(s);
    expect(SELECTABLE_SPRAY_JOB_STATUSES).not.toContain("scheduled" as never);
    expect(SPRAY_JOB_STATUS_LABEL.planned).toBe("Planned");
  });

  it("no status dropdown hard-codes 'scheduled'", () => {
    for (const f of ["src/components/spray/wizard/ApplicationStep.tsx", "src/pages/setup/SprayJobsPage.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/["']scheduled["']/);
    }
  });

  it("a new planned job saves as 'planned'", () => {
    expect(save(draft({ status: "planned" })).status).toBe("planned");
  });

  it("legacy or illegal statuses never reach spray_jobs", () => {
    expect(save(draft({ status: "scheduled" })).status).toBe("planned");
    expect(save(draft({ status: "bogus" })).status).toBe("draft");
    expect(save(draft({ status: null })).status).toBe("draft");
    for (const v of ["scheduled", "SCHEDULED", "x", "", null, undefined, "Planned"]) {
      expect(CONSTRAINT).toContain(sprayJobStatusForSave(v));
    }
  });

  it("editing a legacy 'scheduled' job reads it as 'planned' without other changes", () => {
    const app = hydrateDraft({ vineyardId: "v1", isTemplate: false, job: { id: "j1", vineyard_id: "v1", status: "scheduled" } as never });
    expect(app.status).toBe("planned");
    expect(save({ ...app, blockIds: ["A"] }).status).toBe("planned");
  });

  it("program-created and template flows never write 'scheduled'", () => {
    const prefill = planSprayPrefillFromProgramStep(draft({ isTemplate: true }));
    expect(prefill.status).toBe("draft");
    expect(save(draft({ isTemplate: true, status: "scheduled", blockIds: [] })).status).toBe("draft");
  });

  it("'completed' is only a label — it creates no spray record", () => {
    expect(normalizeSprayJobStatus("completed")).toBe("completed");
    const input = save(draft({ status: "completed" })) as unknown as Record<string, unknown>;
    expect(input.status).toBe("completed");
    expect(Object.keys(input).some((k) => /spray_record|actual/i.test(k))).toBe(false);
  });
});
