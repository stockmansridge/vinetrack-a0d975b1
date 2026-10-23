import type { WorkTask, WorkTaskLabourLine } from "./workTasksQuery";

export type LabourLineStatus = "ACTIVE_VALID" | "PARENT_DELETED" | "PARENT_MISSING" | "LABOUR_DELETED";

export function classifyLabourLine(line: WorkTaskLabourLine, parent?: WorkTask | null): LabourLineStatus {
  if (line.deleted_at) return "LABOUR_DELETED";
  if (!parent || parent.id !== line.work_task_id) return "PARENT_MISSING";
  return parent.deleted_at ? "PARENT_DELETED" : "ACTIVE_VALID";
}

export function eligibleLabourLines(lines: WorkTaskLabourLine[], parents: WorkTask[]) {
  const byId = new Map(parents.map((task) => [task.id, task]));
  return lines.filter((line) => classifyLabourLine(line, byId.get(line.work_task_id)) === "ACTIVE_VALID");
}

export function labourReviewSummary(rows: { line: WorkTaskLabourLine; status: LabourLineStatus }[]) {
  const review = rows.filter((row) => row.status === "PARENT_DELETED" || row.status === "PARENT_MISSING");
  return {
    activeCount: rows.filter((row) => row.status === "ACTIVE_VALID").length,
    reviewCount: review.length,
    excludedHours: review.reduce((sum, row) => sum + Number(row.line.total_hours ?? 0), 0),
    excludedCost: review.reduce((sum, row) => sum + Number(row.line.total_cost ?? 0), 0),
    costComplete: review.every((row) => row.line.total_cost != null),
  };
}