// System Admin only: re-run the existing discovery job for a pending revision.
//
// A retry only completes when the server shows evidence of THIS attempt: a new
// revision id, a higher attempt_count, or an observed active stage followed by a
// terminal status. Cached/old terminal job rows are never treated as the result.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, SlidersHorizontal } from "lucide-react";
import { V3ResearchHintsDialog } from "@/components/chemicals/V3ResearchHintsDialog";
import { hasResearchHints, isJobBusy } from "@/lib/chemicalV3ResearchHints";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  RESEARCH_DONE, RESEARCH_FAILED, V3_TERMINAL_STATUSES, fetchV3Job, pick, retryChemicalDiscovery, v3ReviewQueue,
} from "@/lib/chemicalV3";
import { customerStage, discoveryRevisionId } from "@/lib/chemicalSearchPublic";

export const DIFFERENT_PRODUCT_CODE = "different_registered_product";
export const DIFFERENT_PRODUCT_FALLBACK = "Different registered product — start a separate discovery.";
const INVOKE_FAILED = "The research service could not be reached. Nothing was changed.";

type Phase = "idle" | "starting" | "running" | "failed" | "done" | "mismatch";
type Row = Record<string, any>;

export function V3ReSearchButton({ jobId, revisionId, prominent, onNewRevision, label = "Re-search missing data", revision, showRefine = false }: {
  jobId: string; revisionId: string; prominent: boolean; onNewRevision: (id: string) => void; label?: string;
  /** Current revision row, used as context by the Refine AI Research dialog. */
  revision?: Record<string, any> | null; showRefine?: boolean;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [refine, setRefine] = useState(false);
  const [distinctMode, setDistinctMode] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const baseline = useRef<{ rev: string; attempts: number | null; sawActive: boolean }>({ rev: revisionId, attempts: null, sawActive: false });
  const hintsQ = useQuery({ queryKey: ["chemical-v3-job-hints", jobId], queryFn: () => fetchV3Job(jobId), enabled: showRefine });
  const hinted = showRefine && hasResearchHints(hintsQ.data);
  useEffect(() => { setPhase((p) => (p === "done" || p === "starting" || p === "running" ? p : "idle")); setDetail(null); }, [revisionId]);

  const busy = phase === "starting" || phase === "running";
  const start = async () => {
    if (busy) return;
    setConfirm(false); setDetail(null); setPhase("starting");
    let attempts: number | null = null;
    try {
      const pre = await fetchV3Job(jobId);
      const n = Number(pick(pre, "attempt_count", "attempts"));
      attempts = Number.isFinite(n) ? n : null;
    } catch { /* baseline unavailable — rely on revision/active evidence */ }
    baseline.current = { rev: revisionId, attempts, sawActive: false };
    try {
      await retryChemicalDiscovery(jobId);
    } catch {
      setDetail(INVOKE_FAILED); setPhase("failed"); return;
    }
    // Drop any cached terminal row so polling only sees fresh server state.
    qc.removeQueries({ queryKey: ["chemical-v3-research-job", jobId] });
    setPhase("running");
  };

  const job = useQuery({
    queryKey: ["chemical-v3-research-job", jobId],
    enabled: phase === "running",
    queryFn: () => fetchV3Job(jobId),
    refetchInterval: 4000,
    staleTime: 0,
    gcTime: 0,
  });
  const st = String(pick(job.data, "status") ?? "").toLowerCase();
  useEffect(() => {
    if (phase !== "running" || !job.data) return;
    const b = baseline.current;
    if (isJobBusy(st)) { b.sawActive = true; return; }
    if (!V3_TERMINAL_STATUSES.includes(st)) return;
    const fromJob = discoveryRevisionId(job.data);
    const newRev = fromJob && fromJob !== b.rev ? fromJob : null;
    const n = Number(pick(job.data, "attempt_count", "attempts"));
    const freshAttempt = b.sawActive || (b.attempts != null && Number.isFinite(n) && n > b.attempts);
    if (!newRev && !freshAttempt) return; // old terminal row — keep waiting for this attempt
    const code = String(pick(job.data, "error_code") ?? "");
    if (code === DIFFERENT_PRODUCT_CODE) {
      setDetail(String(pick(job.data, "user_message") ?? DIFFERENT_PRODUCT_FALLBACK)); setPhase("mismatch"); return;
    }
    if (newRev && (st === "pending_review" || st === "needs_attention" || st === "completed")) { finish(newRev); return; }
    if (st !== "pending_review" && st !== "needs_attention") { failWith(job.data); return; }
    (async () => {
      const rows = await qc.fetchQuery({ queryKey: ["chemical-v3-queue"], queryFn: v3ReviewQueue, staleTime: 0 });
      const q = rows.find((r) => String(pick(r, "job_id") ?? "") === jobId && String(pick(r, "revision_id", "id")) !== b.rev);
      if (q) finish(String(pick(q, "revision_id", "id"))); else failWith(job.data, "Research finished without producing a new revision.");
    })().catch(() => failWith(null));
  }, [phase, st, job.data]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(next: string) {
    setDetail(null); setPhase("done");
    void qc.invalidateQueries({ queryKey: ["chemical-v3-queue"] });
    void qc.invalidateQueries({ queryKey: ["chemical-v3-job-hints", jobId] });
    onNewRevision(next);
  }
  function failWith(j: Row | null, fallback?: string) {
    const code = pick(j, "error_code"); const msg = pick(j, "error_message", "user_message", "last_error");
    setDetail(code || msg ? [code, msg].filter(Boolean).join(": ") : fallback ?? null);
    setPhase("failed");
  }

  const pct = Number(pick(job.data, "progress_percent", "progress", "percent") ?? 0);
  return (
    <div className="space-y-2" data-testid="v3-research" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant={prominent ? "default" : "outline"} disabled={busy} onClick={() => setConfirm(true)}>
        <Sparkles className="mr-1 h-4 w-4" />{label}
      </Button>
      {showRefine && (
        <Button size="sm" variant="outline" className="ml-2" disabled={busy} onClick={() => { setDistinctMode(false); setRefine(true); }}>
          <SlidersHorizontal className="mr-1 h-4 w-4" />{hinted ? "Edit research hints" : "Refine AI Research"}
        </Button>
      )}
      {hinted && <p className="text-xs text-muted-foreground" data-testid="v3-hints-active">Hint-assisted research: saved research instructions will guide the next search (unverified until checked).</p>}
      {busy && (
        <div className="space-y-1 rounded border bg-card p-2 text-sm" data-testid="v3-research-progress">
          <div className="font-medium">Working… re-searching product information</div>
          {hinted && <div className="text-xs text-muted-foreground">Using your saved research instructions.</div>}
          <div className="text-muted-foreground">{phase === "starting" ? "Starting research…" : (pick(job.data, "user_message") ?? customerStage(pick(job.data, "stage"), st))}</div>
          <Progress value={phase === "running" && Number.isFinite(pct) ? pct : 0} />
        </div>
      )}
      {phase === "failed" && (
        <div className="space-y-1 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive" data-testid="v3-research-failed">
          <div className="flex flex-wrap items-center gap-2">{RESEARCH_FAILED}<Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Try again</Button></div>
          {detail && <div className="text-xs" data-testid="v3-research-failed-detail">{detail}</div>}
        </div>
      )}
      {phase === "mismatch" && (
        <div className="space-y-2 rounded border border-warning/50 bg-warning/10 p-2 text-sm" data-testid="v3-research-mismatch">
          <div className="font-medium">{detail}</div>
          <p className="text-xs text-muted-foreground">The existing review was kept. The source describes a different registered product, so it must be discovered separately.</p>
          {showRefine && <Button size="sm" onClick={() => { setDistinctMode(true); setRefine(true); }}>Start separate discovery</Button>}
        </div>
      )}
      {phase === "done" && <p className="text-sm text-success">{RESEARCH_DONE}</p>}
      {showRefine && (
        <V3ResearchHintsDialog open={refine} onOpenChange={setRefine} jobId={jobId} revision={revision} forceDistinct={distinctMode}
          onSaveAndRetry={() => void start()} />
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-search this product?</DialogTitle>
            <DialogDescription>
              VineTrack will search the manufacturer's current information again using AI and create a new review revision.
              Your current review record will remain available while the search runs.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">This runs a new AI-assisted manufacturer search.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button disabled={busy} onClick={start}><Sparkles className="mr-1 h-4 w-4" />Re-search product</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
