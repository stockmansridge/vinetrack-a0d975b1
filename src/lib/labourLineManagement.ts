import type { QueryClient } from "@tanstack/react-query";
import type { WorkTaskLabourLine } from "@/lib/workTasksQuery";

/** Defence in depth for cached rows; the canonical fetch already filters these. */
export function activeVineyardLabourLines(lines: WorkTaskLabourLine[], vineyardId: string | null) {
  return lines.filter((line) => line.vineyard_id === vineyardId && !line.deleted_at);
}

/** Refresh the actual consumers, including reports with bundled labour reads. */
export async function refreshLabourLineDependents(qc: QueryClient, vineyardId: string, removedId: string) {
  await qc.cancelQueries({ queryKey: ["work_task_labour_lines", vineyardId] });
  await qc.cancelQueries({ queryKey: ["labour-line-audit", vineyardId] });
  qc.setQueryData<WorkTaskLabourLine[]>(["labour-line-audit", vineyardId], (rows) =>
    rows?.filter((row) => row.id !== removedId));
  qc.setQueryData<WorkTaskLabourLine[]>(["work_task_labour_lines", vineyardId], (rows) =>
    rows?.filter((row) => row.id !== removedId));
  await Promise.all([
    ["work_task_labour_lines", vineyardId],
    ["labour-line-audit", vineyardId],
    ["labour-line-parents", vineyardId],
    ["work-task-effective-labour-cost", vineyardId],
    ["work_tasks", vineyardId],
    ["cost-report-work-task-sources", vineyardId],
    ["pruning", "activity-report", vineyardId],
    ["pruning", "activity-work-tasks"],
    ["pruning", "activity-work-task-aggregates"],
    ["pruning", "activity-labour-lines"],
    ["pruning", "activity-export", vineyardId],
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
}