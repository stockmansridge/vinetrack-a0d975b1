// System Admin only: re-run the existing discovery job for a pending revision.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  RESEARCH_DONE, RESEARCH_FAILED, V3_TERMINAL_STATUSES, fetchV3Job, pick, retryChemicalDiscovery, v3ReviewQueue,
} from "@/lib/chemicalV3";
import { customerStage, discoveryRevisionId } from "@/lib/chemicalSearchPublic";

export function V3ReSearchButton({ jobId, revisionId, prominent, onNewRevision, label = "Re-search missing data" }: {
  jobId: string; revisionId: string; prominent: boolean; onNewRevision: (id: string) => void; label?: string;
}) {
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "failed" | "done">("idle");
  useEffect(() => { setPhase((p) => (p === "done" ? p : "idle")); }, [revisionId]);

  const start = async () => {
    setConfirm(false);
    setPhase("running");
    try { await retryChemicalDiscovery(jobId); } catch { setPhase("failed"); }
  };

  const job = useQuery({
    queryKey: ["chemical-v3-research-job", jobId],
    enabled: phase === "running",
    queryFn: () => fetchV3Job(jobId),
    refetchInterval: 4000,
  });
  const st = String(pick(job.data, "status") ?? "").toLowerCase();
  useEffect(() => {
    if (phase !== "running" || !job.data || !V3_TERMINAL_STATUSES.includes(st)) return;
    if (st !== "pending_review" && st !== "needs_attention") { setPhase("failed"); return; }
    (async () => {
      const rows = await qc.fetchQuery({ queryKey: ["chemical-v3-queue"], queryFn: v3ReviewQueue, staleTime: 0 });
      const fromQueue = rows.find((r) => String(pick(r, "job_id") ?? "") === jobId && String(pick(r, "revision_id", "id")) !== revisionId);
      const fromJob = discoveryRevisionId(job.data);
      const next = fromJob && fromJob !== revisionId ? fromJob : fromQueue ? String(pick(fromQueue, "revision_id", "id")) : null;
      if (!next) { setPhase("failed"); return; }
      setPhase("done");
      void qc.invalidateQueries({ queryKey: ["chemical-v3-queue"] });
      onNewRevision(next);
    })().catch(() => setPhase("failed"));
  }, [phase, st, job.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = Number(pick(job.data, "progress_percent", "progress", "percent") ?? 0);
  return (
    <div className="space-y-2" data-testid="v3-research" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant={prominent ? "default" : "outline"} disabled={phase === "running"} onClick={() => setConfirm(true)}>
        <Sparkles className="mr-1 h-4 w-4" />{label}
      </Button>
      {phase === "running" && (
        <div className="space-y-1 rounded border bg-card p-2 text-sm" data-testid="v3-research-progress">
          <div className="font-medium">Re-searching product information…</div>
          <div className="text-muted-foreground">{pick(job.data, "user_message") ?? customerStage(pick(job.data, "stage"), st)}</div>
          <Progress value={Number.isFinite(pct) ? pct : 0} />
        </div>
      )}
      {phase === "failed" && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
          {RESEARCH_FAILED}<Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Try again</Button>
        </div>
      )}
      {phase === "done" && <p className="text-sm text-success">{RESEARCH_DONE}</p>}
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
            <Button onClick={start}><Sparkles className="mr-1 h-4 w-4" />Re-search product</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
