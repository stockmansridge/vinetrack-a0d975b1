// System Admin — "Rehydrate Master Catalogue".
//
// Re-evaluates EVERY current CANDIDATE master chemical (unfiltered scope,
// supplied by the page) through the CURRENTLY deployed `chemical-info-lookup`
// parser using the existing, trusted `action: "master_refresh"` path with
// `apply: true` and the signed-in System Admin's JWT. The backend derives the
// jurisdiction from the exact Master record and keeps review_status=candidate.
//
// The browser never writes authoritative chemical evidence, never uses a
// service-role key, never approves a candidate and never touches
// vineyard-private data.
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import {
  DEFAULT_REFRESH_CONCURRENCY,
  REFRESH_OUTCOME_LABEL,
  masterRefreshRequestBody,
  newRefreshRunState,
  pendingIds,
  readStoredRefreshState,
  refreshTotals,
  rehydratedQueueIds,
  resumableState,
  runCatalogueRefresh,
  writeStoredRefreshState,
  type MasterRefreshOutcome,
  type RefreshRunState,
} from "@/lib/masterCatalogueRefresh";
import { newLookupCorrelationId } from "@/lib/chemicalLookupRequest";

const OUTCOME_ORDER: MasterRefreshOutcome[] = [
  "material_change",
  "evidence_refreshed",
  "no_material_change",
  "conflict",
  "source_unavailable",
  "failed",
];

export function MasterCatalogueRefreshDialog({
  open,
  onOpenChange,
  ids,
  onProgress,
  onFinished,
  onReview,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Every candidate master chemical id (unfiltered), in list order. */
  ids: string[];
  onProgress?: (state: RefreshRunState | null) => void;
  onFinished?: () => void;
  /** Open the "Rehydrated this run" queue. */
  onReview?: (state: RefreshRunState) => void;
}) {
  const [state, setState] = useState<RefreshRunState | null>(null);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    setState((prev) => prev ?? resumableState(readStoredRefreshState(), ids));
  }, [open, ids]);

  const totals = useMemo(
    () => refreshTotals(state ?? newRefreshRunState(ids, new Date().toISOString())),
    [state, ids],
  );
  const remaining = state ? pendingIds(state, ids).length : ids.length;
  const pct = totals.total === 0 ? 0 : Math.round((totals.processed / totals.total) * 100);
  const complete = !!state && !running && remaining === 0;
  const reviewable = rehydratedQueueIds(state).length;

  async function start() {
    cancelled.current = false;
    setRunning(true);
    const correlationId = newLookupCorrelationId();
    const next = await runCatalogueRefresh({
      ids,
      initialState: state,
      concurrency: DEFAULT_REFRESH_CONCURRENCY,
      // Politeness: never flood registers / manufacturer sources.
      delayMs: 400,
      isCancelled: () => cancelled.current,
      onProgress: (s) => {
        setState(s);
        writeStoredRefreshState(s);
        onProgress?.(s);
      },
      invoke: async (id) => {
        const { data, error } = await iosSupabase.functions.invoke("chemical-info-lookup", {
          body: masterRefreshRequestBody(id, correlationId),
        });
        if (error) throw error;
        return data;
      },
    });
    setState(next);
    writeStoredRefreshState(next);
    onProgress?.(next);
    setRunning(false);
    onFinished?.();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{complete ? "Rehydration complete" : "Rehydrate Master Catalogue"}</DialogTitle>
          <DialogDescription>
            Re-evaluates every candidate Master chemical with the current parser and
            authority rules, whatever filter is showing. Nothing is approved, approved
            records are not changed, and no vineyard data is touched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <Progress value={pct} />
          <div className="text-xs text-muted-foreground">
            Progress: {totals.processed} / {totals.total} chemicals · {remaining} remaining
          </div>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOME_ORDER.map((o) => (
              <Badge key={o} variant="outline" className="text-[11px]">
                {REFRESH_OUTCOME_LABEL[o]}: {totals[o]}
              </Badge>
            ))}
          </div>
          {(totals.source_unavailable > 0 || totals.failed > 0) && !running && (
            <p className="text-[11px] text-muted-foreground">
              Transient failures can be retried — start again and only the unfinished rows
              are processed.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin self-center" />
              <Button variant="outline" onClick={() => { cancelled.current = true; }}>
                Stop
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => { setState(null); writeStoredRefreshState(null); onProgress?.(null); }}
                disabled={!state}
              >
                Reset progress
              </Button>
              {remaining > 0 && (
                <Button variant={reviewable ? "outline" : "default"} onClick={start} disabled={ids.length === 0}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  {state ? "Resume rehydration" : "Start rehydration"}
                </Button>
              )}
              {state && reviewable > 0 && (
                <Button onClick={() => onReview?.(state)}>
                  <BadgeCheck className="mr-1 h-4 w-4" /> Review rehydrated chemicals
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
