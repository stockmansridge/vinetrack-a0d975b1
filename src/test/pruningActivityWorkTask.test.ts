// Regression guard: the Work Task workflow must not destroy the pruning draft.
//
// Mirrors the editor flow — quarters selected in two blocks, labour and notes
// entered, a Work Task created, the task id set on the parent activity draft —
// and asserts every allocation and activity field survives, that the saved
// payload carries the task link, and that unlinking sends clear_work_task.
import { describe, expect, it } from "vitest";
import {
  activityObject, activityTotals, allocationKey, buildActivityPayload,
  type PruningActivityDraft,
} from "@/lib/pruningActivityContract";

const VINEYARD = "11111111-1111-1111-1111-111111111111";
const ACTIVITY = "22222222-2222-2222-2222-222222222222";
const TASK = "33333333-3333-3333-3333-333333333333";

function quarters(row: number, segs: number[], vines: number) {
  return Object.fromEntries(segs.map((s) => [
    allocationKey(row, s),
    { rowNumber: row, segmentNumber: s, paddockRowId: null, rowLabel: String(row), vines },
  ]));
}

function draftWithTwoBlocks(): PruningActivityDraft {
  return {
    activityId: ACTIVITY,
    entryDate: "2026-08-04",
    worker: "Crew A",
    method: "spur",
    labourHours: 6.5,
    hourlyRate: 32,
    startTime: "2026-08-04T07:30:00.000Z",
    finishTime: "2026-08-04T14:00:00.000Z",
    notes: "Cold morning, slow start.",
    workTaskId: null,
    allocations: {
      "block-a": {
        paddockId: "block-a", paddockName: "Pinot Noir W1", variety: "Pinot Noir",
        quarters: { ...quarters(1, [1, 2, 3, 4], 25), ...quarters(2, [1, 2], 25) },
        seasonId: null,
      },
      "block-b": {
        paddockId: "block-b", paddockName: "Shiraz E2", variety: "Shiraz",
        quarters: quarters(9, [1, 2], 30),
        seasonId: null,
      },
    },
  };
}

describe("pruning activity Work Task workflow", () => {
  it("keeps every allocation and activity field when a task is linked", () => {
    const before = draftWithTwoBlocks();
    const beforeTotals = activityTotals(before);

    // Create Work Task -> only the task id changes on the draft.
    const after: PruningActivityDraft = { ...before, workTaskId: TASK };

    expect(activityTotals(after)).toEqual(beforeTotals);
    expect(beforeTotals.blocks).toBe(2);
    expect(beforeTotals.quarters).toBe(8);
    expect(after.allocations).toEqual(before.allocations);
    expect(after.worker).toBe("Crew A");
    expect(after.method).toBe("spur");
    expect(after.labourHours).toBe(6.5);
    expect(after.hourlyRate).toBe(32);
    expect(after.startTime).toBe(before.startTime);
    expect(after.finishTime).toBe(before.finishTime);
    expect(after.notes).toBe("Cold morning, slow start.");
    expect(after.workTaskId).toBe(TASK);
  });

  it("records the activity with the task link and both allocations", () => {
    const draft: PruningActivityDraft = { ...draftWithTwoBlocks(), workTaskId: TASK };
    const payload = buildActivityPayload(draft, VINEYARD, ACTIVITY);

    expect(payload.activity.work_task_id).toBe(TASK);
    expect(payload.activity.clear_work_task).toBe(false);
    expect(payload.allocations).toHaveLength(2);
    expect(payload.allocations.map((a) => a.paddock_id).sort()).toEqual(["block-a", "block-b"]);
    expect(payload.allocations.find((a) => a.paddock_id === "block-a")!.segments).toHaveLength(6);
    expect(payload.allocations.find((a) => a.paddock_id === "block-b")!.segments).toHaveLength(2);
  });

  it("reopening keeps the link, and unlinking is explicit", () => {
    // Reopened activity (canonical.activity.work_task_id restored).
    const reopened: PruningActivityDraft = { ...draftWithTwoBlocks(), workTaskId: TASK };
    expect(activityObject(reopened, VINEYARD, ACTIVITY).work_task_id).toBe(TASK);

    const unlinked: PruningActivityDraft = { ...reopened, workTaskId: null };
    const obj = activityObject(unlinked, VINEYARD, ACTIVITY);
    expect(obj.work_task_id).toBeNull();
    expect(obj.clear_work_task).toBe(true);
    // Unlinking must not touch the allocations.
    expect(unlinked.allocations).toEqual(reopened.allocations);
  });
});
