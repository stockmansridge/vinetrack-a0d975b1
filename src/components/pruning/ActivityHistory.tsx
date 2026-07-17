import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Undo2, Link2, MoreHorizontal, Pencil, ExternalLink } from "lucide-react";
import type { PruningEntry, PruningRowSegment } from "@/lib/pruningQuery";
import { useReversePruningEntry } from "@/lib/pruningQuery";
import { hardDeleteWorkTask } from "@/lib/workTasksQuery";
import { formatDate } from "@/lib/dateFormat";
import EditPruningDialog from "@/components/pruning/EditPruningDialog";
import type { RowIdentity } from "@/lib/pruningCalc";
import { Link } from "react-router-dom";

interface Props {
  seasonId: string;
  entries: PruningEntry[];
  canReverse: boolean;
  canEdit: boolean;
  vineyardId: string | null;
  identities: RowIdentity[];
  allSegments: PruningRowSegment[];
  paddockName: string;
}

export default function ActivityHistory({
  seasonId, entries, canReverse, canEdit, vineyardId, identities, allSegments, paddockName,
}: Props) {
  const reverse = useReversePruningEntry(seasonId);
  const [editEntry, setEditEntry] = useState<PruningEntry | null>(null);

  const handleReverse = async (entry: PruningEntry) => {
    if (!confirm("Reverse this entry? Its row quarters will become available again.")) return;
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
        try { await hardDeleteWorkTask(entry.work_task_id); }
        catch (e: any) { toast.error(`Reversed pruning, but could not delete Work Task: ${e?.message ?? e}`); return; }
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
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} in this season. Edit updates figures in place; reversing resets that entry's quarters.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No pruning recorded yet.</div>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => {
              // Reversed/deleted entries: `deleted_at` is set. Skip Edit.
              const isReversed = !!e.deleted_at;
              return (
                <li key={e.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{formatDate(e.entry_date)}</span>
                      <Badge variant="secondary">{e.pruning_method}</Badge>
                      {e.work_task_id && (
                        <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" /> Work Task</Badge>
                      )}
                      {isReversed && <Badge variant="destructive">Reversed</Badge>}
                      <span className="text-sm text-muted-foreground">{e.worker_or_crew || "—"}</span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 tabular-nums">
                      {Number(e.row_equivalents_completed).toFixed(2)} row eq.
                      {" · "}~{(e.estimated_vines_completed ?? 0).toLocaleString()} vines
                      {e.labour_hours ? ` · ${Number(e.labour_hours).toFixed(1)} hrs` : ""}
                      {e.vintage_year ? ` · Vintage ${e.vintage_year}` : ""}
                    </div>
                    {e.notes && <div className="text-sm mt-1 whitespace-pre-wrap">{e.notes}</div>}
                    {e.updated_at && e.updated_at !== e.created_at && (
                      <div className="text-xs text-muted-foreground mt-1">Last edited {formatDate(e.updated_at.slice(0, 10))}</div>
                    )}
                  </div>

                  {(canEdit || canReverse || e.work_task_id) && !isReversed && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Entry actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEdit && vineyardId && (
                          <DropdownMenuItem onSelect={() => setEditEntry(e)}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                        )}
                        {e.work_task_id && (
                          <DropdownMenuItem asChild>
                            <Link to={`/setup/work-tasks?highlight=${e.work_task_id}`}>
                              <ExternalLink className="h-4 w-4 mr-2" /> Open Work Task
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {canReverse && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => handleReverse(e)}
                              disabled={reverse.isPending}
                              className="text-destructive focus:text-destructive"
                            >
                              <Undo2 className="h-4 w-4 mr-2" /> Reverse
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {editEntry && vineyardId && (
        <EditPruningDialog
          open={!!editEntry}
          onOpenChange={(o) => { if (!o) setEditEntry(null); }}
          entry={editEntry}
          identities={identities}
          allSegments={allSegments}
          vineyardId={vineyardId}
          paddockName={paddockName}
        />
      )}
    </Card>
  );
}
