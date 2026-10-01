// System Admin — "Rehydrate Master Catalogue" in CONTROLLED BATCHES.
//
// Each batch is the next N (default 20) CANDIDATE Master chemicals with the
// oldest evidence, calculated from CURRENT Master rows (the catalogue is re-read
// before every new batch). Each row calls the existing `master_refresh` action
// with `apply: true`; at most 2 requests are in flight. A batch never rolls into
// the next one automatically, and 5 consecutive source failures pause it.
//
// The browser never writes authoritative chemical evidence, never uses a
// service-role key, never approves a candidate and never touches
// vineyard-private data.
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase as iosSupabase } from "@/integrations/ios-supabase/client";
import {
  BATCH_SIZE_OPTIONS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_REFRESH_CONCURRENCY,
  DEFAULT_STALENESS_DAYS,
  PAUSED_SOURCE_MESSAGE,
  REFRESH_OUTCOME_LABEL,
  STALENESS_OPTIONS,
  batchPlanSummary,
  isBatchComplete,
  masterRefreshRequestBody,
  newRefreshRunState,
  pendingIds,
  readStoredRefreshState,
  refreshTotals,
  rehydratedQueueIds,
  runCatalogueRefresh,
  writeStoredRefreshState,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type EvidenceAgeRow,
  type MasterRefreshOutcome,
  type RefreshRunState,
} from "@/lib/masterCatalogueRefresh";
import { newLookupCorrelationId } from "@/lib/chemicalLookupRequest";

const OUTCOME_ORDER: MasterRefreshOutcome[] = [
  "material_change",
  "evidence_refreshed",
  "no_material_change",
  "conflict",
  "not_applied",
  "source_unavailable",
  "failed",
];

const fmtEvidence = (v: string | null | undefined) =>
  v === undefined ? "—" : v === null ? "Never" : new Date(v).toLocaleDateString();

export function MasterCatalogueRefreshDialog({
  open,
  onOpenChange,
  rows,
  reloadRows,
  onProgress,
  onFinished,
  onReview,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Current, unfiltered Master rows (for the batch preview). */
  rows: EvidenceAgeRow[];
  /** Re-read the Master Catalogue; the next batch is planned from this. */
  reloadRows: () => Promise<EvidenceAgeRow[]>;
  onProgress?: (state: RefreshRunState | null) => void;
  onFinished?: () => void;
  /** Open the "Rehydrated this batch" queue. */
  onReview?: (state: RefreshRunState) => void;
}) {
  const [state, setState] = useState<RefreshRunState | null>(null);
  const [running, setRunning] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [batchSize, setBatchSize] = useState<number>(DEFAULT_BATCH_SIZE);
  const [staleDays, setStaleDays] = useState<number | null>(DEFAULT_STALENESS_DAYS);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    setState((prev) => prev ?? readStoredRefreshState());
  }, [open]);

  const plan = useMemo(
    () => batchPlanSummary(rows, { size: batchSize, staleDays }),
    [rows, batchSize, staleDays],
  );

  const planned = state?.planned ?? [];
  const totals = useMemo(
    () => refreshTotals(state ?? newRefreshRunState([], new Date().toISOString())),
    [state],
  );
  const remaining = state ? pendingIds(state, planned).length : 0;
  const pct = totals.total === 0 ? 0 : Math.round((totals.processed / totals.total) * 100);
  const complete = isBatchComplete(state) && !running;
  const unfinished = !!state && !complete;
  const reviewable = rehydratedQueueIds(state).length;

  const persist = (s: RefreshRunState | null) => {
    setState(s);
    writeStoredRefreshState(s);
    onProgress?.(s);
  };

  async function run(initial: RefreshRunState) {
    cancelled.current = false;
    setRunning(true);
    const correlationId = newLookupCorrelationId();
    try {
    const next = await runCatalogueRefresh({
      ids: initial.planned,
      initialState: initial,
      concurrency: DEFAULT_REFRESH_CONCURRENCY,
      // Politeness: never flood registers / manufacturer sources.
      delayMs: 400,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      // Diagnostic trace (planned / queue / cursor / cancelled / paused / rows / pending).
      onTrace: (e) => console.info("[master-rehydrate]", e.type, e),
      isCancelled: () => cancelled.current,
      onProgress: persist,
      invoke: async (id) => {
        const { data, error } = await iosSupabase.functions.invoke("chemical-info-lookup", {
          body: masterRefreshRequestBody(id, correlationId),
        });
        if (error) throw error;
        return data;
      },
    });
    persist(next);
    } catch (e) {
      console.error("[master-rehydrate] runner crashed", e);
    } finally {
      setRunning(false);
      onFinished?.();
    }
  }

  // The batch runs in this browser tab: warn before a reload / close cuts it short.
  useEffect(() => {
    if (!running) return;
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  /** Plan a NEW batch from freshly re-read Master rows. */
  async function startNextBatch() {
    setPlanning(true);
    try {
      const fresh = await reloadRows();
      const { ids } = batchPlanSummary(fresh, { size: batchSize, staleDays });
      if (ids.length === 0) {
        persist(null);
        return;
      }
      const s = newRefreshRunState(ids, new Date().toISOString(), batchSize);
      persist(s);
      setPlanning(false);
      await run(s);
    } finally {
      setPlanning(false);
    }
  }

  const title = running
    ? "Rehydrating batch"
    : complete
      ? `Batch complete — ${totals.processed} chemicals processed`
      : unfinished
        ? "Rehydration batch unfinished"
        : "Rehydrate Master Catalogue";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Candidate chemicals are refreshed in small batches, oldest evidence first.
            Nothing is approved, approved and retired records are not touched, and no
            vineyard data is changed.
          </DialogDescription>
        </DialogHeader>

        {!state && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Batch size</span>
                <Select value={String(batchSize)} onValueChange={(v) => setBatchSize(Number(v))}>
                  <SelectTrigger aria-label="Batch size"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BATCH_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Only chemicals not checked in</span>
                <Select
                  value={staleDays === null ? "any" : String(staleDays)}
                  onValueChange={(v) => setStaleDays(v === "any" ? null : Number(v))}
                >
                  <SelectTrigger aria-label="Only chemicals not checked in"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STALENESS_OPTIONS.map((o) => (
                      <SelectItem key={o.label} value={o.days === null ? "any" : String(o.days)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="rounded-md border border-border/60 p-3 space-y-1 text-xs">
              <div className="text-xs text-muted-foreground">Priority: Oldest evidence first · never-checked chemicals always qualify</div>
              <div><span className="font-semibold">{plan.candidateTotal}</span> candidate chemicals total</div>
              <div><span className="font-semibold">{plan.selected}</span> selected for this batch</div>
              <div>Oldest evidence: {fmtEvidence(plan.oldestEvidence)}</div>
              <div>Newest evidence in this batch: {fmtEvidence(plan.newestEvidence)}</div>
              <div>Remaining after this batch: {plan.remainingAfter}</div>
            </div>
          </div>
        )}

        {state && (
          <div className="space-y-3 text-sm">
            <Progress value={pct} />
            <div className="text-xs text-muted-foreground">
              Progress: {totals.processed} / {totals.total} chemicals in this batch · {remaining} remaining
            </div>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOME_ORDER.map((o) => (
                <Badge key={o} variant="outline" className="text-[11px]">
                  {REFRESH_OUTCOME_LABEL[o]}: {totals[o]}
                </Badge>
              ))}
            </div>
            {state.paused && !running && (
              <Alert variant="destructive">
                <AlertDescription>{PAUSED_SOURCE_MESSAGE}</AlertDescription>
              </Alert>
            )}
            {(totals.source_unavailable > 0 || totals.failed > 0 || totals.not_applied > 0) && !running && !state.paused && (
              <p className="text-[11px] text-muted-foreground">
                Retry required: failed, unavailable and not-applied rows can be retried — Resume only retries those and any
                unfinished rows in this batch.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin self-center" />
              <Button variant="outline" onClick={() => { cancelled.current = true; }}>
                Stop
              </Button>
            </>
          ) : unfinished ? (
            <>
              <Button variant="ghost" onClick={() => persist(null)}>
                {state?.paused ? "Stop" : "Abandon batch"}
              </Button>
              <Button onClick={() => state && run(state)}>
                <RefreshCw className="mr-1 h-4 w-4" /> Resume
              </Button>
            </>
          ) : complete ? (
            <>
              <Button variant="outline" onClick={startNextBatch} disabled={planning}>
                {planning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                Rehydrate next {batchSize}
              </Button>
              {state && reviewable > 0 && (
                <Button onClick={() => onReview?.(state)}>
                  <BadgeCheck className="mr-1 h-4 w-4" /> Review this batch
                </Button>
              )}
            </>
          ) : (
            <Button onClick={startNextBatch} disabled={planning || plan.selected === 0}>
              {planning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
              Rehydrate next {batchSize}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
