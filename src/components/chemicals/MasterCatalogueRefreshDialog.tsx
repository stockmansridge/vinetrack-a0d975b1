// System Admin — "Refresh Chemical Catalogue".
//
// Re-evaluates every current AU CANDIDATE master chemical through the CURRENTLY
// deployed `chemical-info-lookup` parser using the existing, trusted
// `action: "master_refresh"` path and the signed-in System Admin's JWT.
//
// The browser never writes authoritative chemical evidence, never uses a
// service-role key, never approves a candidate and never touches
// vineyard-private data (saved chemicals, pricing, stock, supplier, packs,
// notes, spray records or historical snapshots).
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
  REFRESH_STORAGE_KEY,
  masterRefreshRequestBody,
  newRefreshRunState,
  pendingIds,
  refreshTotals,
  resumableState,
  runCatalogueRefresh,
  type MasterRefreshOutcome,
  type RefreshRunState,
} from "@/lib/masterCatalogueRefresh";
import { newLookupCorrelationId } from "@/lib/chemicalLookupRequest";

const OUTCOME_ORDER: MasterRefreshOutcome[] = [
  "no_material_change",
  "evidence_refreshed",
  "material_change",
  "conflict",
  "source_unavailable",
  "skipped",
  "failed",
];

function readStored(): unknown {
  try {
    const raw = localStorage.getItem(REFRESH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(state: RefreshRunState | null) {
  try {
    if (!state) localStorage.removeItem(REFRESH_STORAGE_KEY);
    else localStorage.setItem(REFRESH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage is a convenience only — a run still completes without it */
  }
}

export function MasterCatalogueRefreshDialog({
  open,
  onOpenChange,
  ids,
  country,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Candidate master chemical ids, in list order. */
  ids: string[];
  country: string;
  onFinished?: () => void;
}) {
  const [state, setState] = useState<RefreshRunState | null>(null);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    setState((prev) => prev ?? resumableState(readStored(), ids));
  }, [open, ids]);

  const totals = useMemo(
    () => refreshTotals(state ?? newRefreshRunState(ids, new Date().toISOString())),
    [state, ids],
  );
  const remaining = state ? pendingIds(state, ids).length : ids.length;
  const pct = totals.total === 0 ? 0 : Math.round((totals.processed / totals.total) * 100);

  async function start() {
    cancelled.current = false;
    setRunning(true);
    const correlationId = newLookupCorrelationId();
    const next = await runCatalogueRefresh({
      ids,
      initialState: state,
      concurrency: DEFAULT_REFRESH_CONCURRENCY,
      // Politeness: never flood APVMA / manufacturer sources.
      delayMs: 400,
      isCancelled: () => cancelled.current,
      onProgress: (s) => {
        setState(s);
        writeStored(s);
      },
      invoke: async (id) => {
        const { data, error } = await iosSupabase.functions.invoke("chemical-info-lookup", {
          body: masterRefreshRequestBody(id, country, correlationId),
        });
        if (error) throw error;
        return data;
      },
    });
    setState(next);
    writeStored(next);
    setRunning(false);
    onFinished?.();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Refresh Chemical Catalogue</DialogTitle>
          <DialogDescription>
            Re-evaluates every candidate master chemical with the current parser and
            authority rules. Review status is never changed, nothing is approved, and no
            vineyard data is touched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <Progress value={pct} />
          <div className="text-xs text-muted-foreground">
            {totals.processed} / {totals.total} processed · {remaining} remaining
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
            <Button variant="outline" onClick={() => { cancelled.current = true; }}>
              Stop
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => { setState(null); writeStored(null); }}
                disabled={!state}
              >
                Reset progress
              </Button>
              <Button onClick={start} disabled={ids.length === 0}>
                <RefreshCw className="mr-1 h-4 w-4" />
                {state ? "Resume refresh" : "Start refresh"}
              </Button>
            </>
          )}
          {running && <Loader2 className="h-4 w-4 animate-spin self-center" />}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
