import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { softDeleteLabourLine, type WorkTaskLabourLine } from "@/lib/workTasksQuery";
import { refreshLabourLineDependents } from "@/lib/labourLineManagement";
import { friendlySaveError } from "@/lib/friendlySaveError";
import { toast } from "@/hooks/use-toast";

export function RemoveLabourLineButton({ line, userId, allowed, onRemoved }: {
  line: WorkTaskLabourLine;
  userId: string | null;
  allowed: boolean;
  onRemoved?: (line: WorkTaskLabourLine) => void;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      if (!allowed || !userId) throw new Error("You do not have permission to remove this labour line.");
      await softDeleteLabourLine(line.id, userId);
    },
    onSuccess: async () => {
      // A local tombstone also clears newly saved drawer rows, which overlay the query cache.
      onRemoved?.({ ...line, deleted_at: new Date().toISOString() });
      await refreshLabourLineDependents(qc, line.vineyard_id, line.id);
      setOpen(false);
      toast({ title: "Labour line removed" });
    },
    onError: (error) => toast({ title: "Remove failed", description: friendlySaveError(error, "labour details"), variant: "destructive" }),
  });
  if (!allowed) return null;
  return <>
    <Button variant="ghost" size="icon" aria-label="Delete labour line" title="Delete labour line" disabled={!userId || remove.isPending} onClick={() => setOpen(true)}>
      <Trash2 className="h-4 w-4" />
    </Button>
    <AlertDialog open={open} onOpenChange={(value) => { if (!remove.isPending) setOpen(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove labour line?</AlertDialogTitle>
          <AlertDialogDescription>
            This labour record will be removed for the whole vineyard and team. Its hours and labour-line cost will no longer count toward the Work Task. The Work Task itself will remain. Any agreed piece-rate costing stays unchanged.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? "Removing…" : "Remove"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}