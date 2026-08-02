// Backfill progress + controls for Crop Health Maps.
// Shows how many historical imagery dates are missing, lets an admin start the
// automatic backfill, and keeps reporting progress (it polls the server, so the
// job continues and stays visible across page refreshes).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, History, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  discoverBackfill, fetchBackfillStatus, isBackfillActive, runBackfillBatch,
} from "@/lib/satelliteBackfill";

const HISTORY_DAYS = 180;

export default function BackfillPanel({
  vineyardId,
  paddockIds,
  canManage,
  onImageryChanged,
}: {
  vineyardId: string | null;
  paddockIds: string[];
  canManage: boolean;
  onImageryChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["satellite-backfill-status", vineyardId],
    queryFn: () => fetchBackfillStatus(vineyardId!),
    enabled: Boolean(vineyardId),
    refetchInterval: (q) => (isBackfillActive(q.state.data as any) ? 5000 : false),
  });

  const status = statusQuery.data;
  const active = isBackfillActive(status);

  // Drive the batch runner while a job is active. Each batch is a separate
  // server call, so a refresh simply picks the job back up.
  useEffect(() => {
    if (!vineyardId || !active || running) return;
    let cancelled = false;
    setRunning(true);
    (async () => {
      try {
        for (;;) {
          if (cancelled) return;
          const res = await runBackfillBatch({ vineyardId, batchSize: 2 });
          await statusQuery.refetch();
          onImageryChanged?.();
          if (res.finished || res.remaining === 0) break;
        }
      } catch (e: any) {
        toast({
          title: "Backfill paused",
          description: e?.message ?? "Could not process the next imagery date.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setRunning(false);
        qc.invalidateQueries({ queryKey: ["satellite-backfill-status", vineyardId] });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vineyardId, active]);

  const discover = useMutation({
    mutationFn: () => discoverBackfill({
      vineyardId: vineyardId!,
      paddockIds: paddockIds.length ? paddockIds : undefined,
      historyDays: HISTORY_DAYS,
    }),
    onSuccess: (res) => {
      statusQuery.refetch();
      toast({
        title: res.already_running ? "Backfill already running" : "Backfill started",
        description: res.already_running
          ? "An imagery backfill is already in progress for this vineyard."
          : `${res.missing_dates ?? 0} missing date${res.missing_dates === 1 ? "" : "s"} queued — current imagery stays usable while these process.`,
      });
    },
    onError: (e: any) => toast({
      title: "Couldn't start backfill",
      description: e?.message ?? "Please try again.",
      variant: "destructive",
    }),
  });

  if (!vineyardId) return null;

  const total = status?.expected_date_total ?? 0;
  const done = status?.downloaded_dates ?? 0;
  const missing = status?.missing_dates ?? 0;
  const percent = status?.percent_complete ?? 0;
  const job = status?.active_job ?? status?.last_job ?? null;
  const failed = status?.outcome_counts?.failed ?? 0;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2 text-[11px] text-muted-foreground">
      <div className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" />
        Historical imagery backfill
      </div>

      {total > 0 ? (
        <>
          <Progress value={percent} className="h-1.5" />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>Stored dates: <span className="text-foreground">{done} of {total}</span></div>
            <div>Missing: <span className="text-foreground">{missing}</span></div>
            {status?.newest_missing_date && (
              <div className="col-span-2">Next to process: <span className="text-foreground">{status.newest_missing_date}</span></div>
            )}
            {job?.current_processing_date && active && (
              <div className="col-span-2">Working on: <span className="text-foreground">{job.current_processing_date}</span></div>
            )}
            {(status?.outcome_counts?.cloud_obscured ?? 0) > 0 && (
              <div className="col-span-2">Skipped (cloud): <span className="text-foreground">{status?.outcome_counts?.cloud_obscured}</span></div>
            )}
            {(status?.outcome_counts?.no_provider_capture ?? 0) > 0 && (
              <div className="col-span-2">No provider capture: <span className="text-foreground">{status?.outcome_counts?.no_provider_capture}</span></div>
            )}
          </div>
        </>
      ) : (
        <div>No history check has run yet for this vineyard.</div>
      )}

      {failed > 0 && (
        <div className="inline-flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          <span>{failed} date{failed === 1 ? "" : "s"} could not be processed after repeated attempts.</span>
        </div>
      )}

      {active && (
        <div className="inline-flex items-center gap-1.5 text-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Filling missing dates in the background — current imagery is still usable.
        </div>
      )}

      {canManage && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={active || discover.isPending || statusQuery.isLoading}
          onClick={() => setConfirmOpen(true)}
        >
          {discover.isPending
            ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            : <History className="h-3.5 w-3.5 mr-1.5" />}
          {active ? "Backfill running…" : "Find and fill missing dates"}
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fill missing imagery dates?</AlertDialogTitle>
            <AlertDialogDescription>
              VineTrack will check the last {HISTORY_DAYS} days for every selected block, then
              download and process any date that is missing — newest first. This can take a while
              and uses satellite provider quota. Your current imagery stays available the whole time,
              and progress continues if you leave this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => discover.mutate()}>Start backfill</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
