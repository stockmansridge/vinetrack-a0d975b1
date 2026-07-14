import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Undo2, Link2 } from "lucide-react";
import type { PruningEntry } from "@/lib/pruningQuery";
import { useReversePruningEntry } from "@/lib/pruningQuery";
import { hardDeleteWorkTask } from "@/lib/workTasksQuery";
import { formatDate } from "@/lib/dateFormat";

interface Props { seasonId: string; entries: PruningEntry[]; canReverse: boolean }

export default function ActivityHistory({ seasonId, entries, canReverse }: Props) {
  const reverse = useReversePruningEntry(seasonId);

  const handleReverse = async (entry: PruningEntry) => {
    if (!confirm("Reverse this entry? Its row quarters will become available again.")) return;

    // If a Work Task is linked, offer to remove it as part of the reversal.
    // SQL 114 releases the exclusive link automatically when the pruning
    // entry is soft-deleted; the task itself stays unless the user asks
    // us to delete it.
    let deleteLinkedTask = false;
    if (entry.work_task_id) {
      const choice = window.prompt(
        "This entry is linked to a Work Task.\n\n" +
        "Type 'delete' to also delete the linked Work Task, or leave blank to keep it. " +
        "Type 'cancel' to abort the reversal.",
        "",
      );
      if (choice === null) return;
      const v = choice.trim().toLowerCase();
      if (v === "cancel") return;
      if (v === "delete") deleteLinkedTask = true;
    }

    try {
      await reverse.mutateAsync(entry.id);
      if (deleteLinkedTask && entry.work_task_id) {
        try {
          await hardDeleteWorkTask(entry.work_task_id);
        } catch (e: any) {
          toast.error(`Reversed pruning, but could not delete Work Task: ${e?.message ?? e}`);
          return;
        }
      }
      toast.success("Pruning record reversed.");
    } catch (e: any) {
      toast.error(`Failed to reverse: ${e?.message ?? e}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity history</CardTitle>
        <CardDescription>
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} in this season. Reversing an entry resets its quarters.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No pruning recorded yet.</div>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <li key={e.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{formatDate(e.entry_date)}</span>
                    <Badge variant="secondary">{e.pruning_method}</Badge>
                    {e.work_task_id && (
                      <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" /> Work Task</Badge>
                    )}
                    <span className="text-sm text-muted-foreground">{e.worker_or_crew || "—"}</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 tabular-nums">
                    {Number(e.row_equivalents_completed).toFixed(2)} row eq.
                    {" · "}~{(e.estimated_vines_completed ?? 0).toLocaleString()} vines
                    {e.labour_hours ? ` · ${Number(e.labour_hours).toFixed(1)} hrs` : ""}
                  </div>
                  {e.notes && <div className="text-sm mt-1 whitespace-pre-wrap">{e.notes}</div>}
                </div>
                {canReverse && (
                  <Button variant="ghost" size="sm" onClick={() => handleReverse(e)} disabled={reverse.isPending}>
                    <Undo2 className="h-4 w-4 mr-1" /> Reverse
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
