import { describe, expect, it } from "vitest";
import { eligibleLabourLines } from "@/lib/labourLineEligibility";

describe("Canonical labour-line authority eligibility", () => {
  it("retains active archived parents without restoring or exposing them in the normal task list", () => {
    const line = { id: "line1", work_task_id: "task1", vineyard_id: "v1", deleted_at: null };
    expect(eligibleLabourLines([line], [{ id: "task1", vineyard_id: "v1", is_archived: true, deleted_at: null }])).toEqual([line]);
  });
});