import { describe, it, expect } from "vitest";
import { assignmentCellLabel, completePayload, reopenPayload, resolveCompletedBy } from "@/lib/workTaskCompletion";

const names: Record<string, string> = { a: "Alice", c: "Carl", op: "Olly", f: "Fran" };
const nameOf = (id: string) => names[id] ?? null;
const base = { vineyard_id: "v", assigned_to: "a", completed_by: null, finalized_by: null } as any;

describe("Work Task assignment / completion identity", () => {
  it("incomplete shows assignee, or Unassigned", () => {
    expect(assignmentCellLabel({ ...base, is_finalized: false }, [], nameOf)).toBe("Alice");
    expect(assignmentCellLabel({ ...base, assigned_to: null, is_finalized: false }, [], nameOf)).toBe("Unassigned");
  });
  it("completed shows completed_by, never the assignee", () => {
    expect(assignmentCellLabel({ ...base, is_finalized: true, completed_by: "c" }, [], nameOf)).toBe("Completed by Carl");
    expect(assignmentCellLabel({ ...base, is_finalized: true }, [], nameOf)).toBe("Completed by unknown");
  });
  it("trip operator fallback only when unambiguous and same vineyard", () => {
    const t = { ...base, is_finalized: true, finalized_by: "f" };
    expect(resolveCompletedBy(t, [{ vineyard_id: "v", operator_user_id: "op" }, { vineyard_id: "v", operator_user_id: "op" }]))
      .toEqual({ userId: "op", source: "trip_operator" });
    expect(resolveCompletedBy(t, [{ vineyard_id: "v", operator_user_id: "op" }, { vineyard_id: "v", operator_user_id: "x" }]).source).toBe("finalized_by");
    expect(resolveCompletedBy(t, [{ vineyard_id: "other", operator_user_id: "op" }]).source).toBe("finalized_by");
    expect(resolveCompletedBy(t, [{ vineyard_id: "v", operator_user_id: null }]).source).toBe("finalized_by");
  });
  it("complete records completed_by/at; reopen clears them but never assigned_to", () => {
    expect(completePayload("2026-10-01", "u1", "NOW")).toMatchObject({ completed_by: "u1", completed_at: "NOW" });
    expect(reopenPayload()).toMatchObject({ completed_by: null, completed_at: null });
    expect("assigned_to" in completePayload("2026-10-01", "u1", "NOW")).toBe(false);
    expect("assigned_to" in reopenPayload()).toBe(false);
  });
});
