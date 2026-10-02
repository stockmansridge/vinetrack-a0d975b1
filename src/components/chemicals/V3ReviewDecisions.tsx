// Actionable review decisions + front-label chooser for the V3 review drawer.
import { forwardRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { signedV3MediaUrl } from "@/lib/chemicalV3";
import {
  fetchFrontLabels, frontLabelCaption, frontLabelPath, issueActions, issueState,
  resolveReviewIssue, setFrontLabelImage, humaniseFieldKey,
  isManufacturerLabelIssue, isVineyardRatesIssue, MANUFACTURER_LABEL_NOTE, NO_VINEYARD_RATE_NOTE,
} from "@/lib/chemicalV3Review";

type Row = Record<string, any>;

function ChooserThumb({ path }: { path: string }) {
  const q = useQuery({ queryKey: ["chemical-v3-media", path], staleTime: 30 * 60_000, queryFn: () => signedV3MediaUrl(path) });
  return q.data ? <img src={q.data} alt="" className="h-48 w-full rounded bg-muted object-contain" /> : <div className="h-48 w-full rounded bg-muted" />;
}

export function FrontLabelChooser({ revisionId, issueId, open, onClose, onSaved }: {
  revisionId: string; issueId: string | null; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["chemical-v3-front-labels", revisionId], enabled: open, queryFn: () => fetchFrontLabels(revisionId) });
  const mut = useMutation({
    mutationFn: async (path: string) => issueId
      ? resolveReviewIssue(issueId, "selected", null, { storage_path: path })
      : setFrontLabelImage(revisionId, path),
    onSuccess: () => { onSaved(); onClose(); },
  });
  const items = (q.data ?? []).filter((r) => frontLabelPath(r));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Choose front label</DialogTitle></DialogHeader>
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading images…</p>}
        {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
        {q.isSuccess && !items.length && <p className="text-sm text-muted-foreground">No label images are available for this product.</p>}
        <div role="radiogroup" className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto md:grid-cols-3" data-testid="v3-front-label-options">
          {items.map((r) => {
            const p = frontLabelPath(r)!;
            const on = sel === p;
            return (
              <button key={p} type="button" role="radio" aria-checked={on} onClick={() => setSel(p)}
                className={cn("space-y-1 rounded border bg-card p-2 text-left text-sm", on ? "border-primary ring-2 ring-primary" : "")}>
                <ChooserThumb path={p} />
                <div>{on ? "●" : "○"} {frontLabelCaption(r)}</div>
              </button>
            );
          })}
        </div>
        {mut.error && <p className="text-sm text-destructive">{(mut.error as Error).message}</p>}
        <DialogFooter>
          <Button disabled={!sel || mut.isPending} onClick={() => sel && mut.mutate(sel)}>Use as Front Label</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueCard({ issue, busy, onDecide, onChoose, labelUrl, onAddRate, rateCount }: {
  issue: Row; busy: boolean; onDecide: (decision: string) => void; onChoose: () => void;
  labelUrl?: string | null; onAddRate?: () => void; rateCount?: number;
}) {
  const state = issueState(issue);
  const [open, setOpen] = useState(false);
  const label = isManufacturerLabelIssue(issue);
  const rates = isVineyardRatesIssue(issue);
  const title = label ? "Manufacturer label" : rates ? "Vineyard rates" : issue.title || humaniseFieldKey(issue.issue_key) || "Review item";
  const detail = label ? MANUFACTURER_LABEL_NOTE : rates && !rateCount ? NO_VINEYARD_RATE_NOTE : issue.detail;
  if (state === "resolved" && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="v3-issue" data-state="resolved"
        className="flex w-full items-center justify-between rounded border border-success/40 bg-success/10 p-2 text-left text-sm">
        <span>{title}</span><span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" />Resolved ✓</span>
      </button>
    );
  }
  return (
    <div data-testid="v3-issue" data-state={state}
      className={cn("space-y-2 rounded border p-3 text-sm",
        state === "needs_correction" ? "border-destructive/50 bg-destructive/10" : state === "resolved" ? "border-success/40 bg-success/10" : "border-warning/50 bg-warning/10")}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{title}</div>
        {state === "needs_correction" && <span className="text-xs font-semibold text-destructive">Needs correction</span>}
        {state === "resolved" && <button type="button" className="text-xs text-success" onClick={() => setOpen(false)}>Resolved ✓</button>}
      </div>
      {detail && <p className="whitespace-pre-wrap">{detail}</p>}
      {issue.resolution_note && <p className="text-xs text-muted-foreground">Note: {issue.resolution_note}</p>}
      <div className="flex flex-wrap gap-2">
        {issueActions(issue).map((a) => {
          if (a.kind === "link") {
            return labelUrl ? (
              <Button key={a.decision} size="sm" variant="outline" asChild>
                <a href={labelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />{a.label}</a>
              </Button>
            ) : <span key={a.decision} className="text-xs text-destructive">Manufacturer label link missing</span>;
          }
          if (a.kind === "add_rate" && !onAddRate) return null;
          return (
            <Button key={a.decision} size="sm" variant={a.kind === "correction" || a.kind === "add_rate" ? "outline" : "default"} disabled={busy}
              onClick={() => {
                if (a.kind === "chooser") return onChoose();
                if (a.kind === "add_rate") return onAddRate?.();
                if (a.kind === "confirm" && !window.confirm(a.confirmText ?? "Are you sure?")) return;
                onDecide(a.decision);
              }}>{a.label}</Button>
          );
        })}
      </div>
    </div>
  );
}

export const V3ReviewDecisions = forwardRef<HTMLElement, {
  revisionId: string; issues: Row[]; loading: boolean; error: Error | null; highlight: boolean;
  labelUrl?: string | null; onAddRate?: () => void; rateCount?: number;
}>(function V3ReviewDecisions({ revisionId, issues, loading, error, highlight, labelUrl, onAddRate, rateCount }, ref) {
  const qc = useQueryClient();
  const [chooser, setChooser] = useState<{ issueId: string | null } | null>(null);
  const reload = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["chemical-v3-issues", revisionId] }),
    qc.invalidateQueries({ queryKey: ["chemical-v3-revision", revisionId] }),
    qc.invalidateQueries({ queryKey: ["chemical-v3-front-labels", revisionId] }),
  ]);
  const mut = useMutation({
    mutationFn: (a: { id: string; decision: string }) => resolveReviewIssue(a.id, a.decision, null, null),
    onSuccess: reload,
  });
  const open = issues.filter((i) => issueState(i) !== "resolved").length;
  return (
    <section ref={ref} tabIndex={-1} data-testid="v3-review-decisions"
      className={cn("space-y-2 rounded border bg-card p-3 outline-none", highlight && "ring-2 ring-destructive")}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Review decisions</h3>
        <span className="text-xs text-muted-foreground">{issues.length ? `${open} of ${issues.length} open` : ""}</span>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">Review decisions could not be loaded: {error.message}</p>}
      {!loading && !error && !issues.length && <p className="text-sm text-muted-foreground">No review decisions for this revision.</p>}
      {mut.error && <p className="text-sm text-destructive">{(mut.error as Error).message}</p>}
      <div className="space-y-2">
        {issues.map((i) => (
          <IssueCard key={String(i.issue_id)} issue={i} busy={mut.isPending}
            labelUrl={labelUrl} onAddRate={onAddRate} rateCount={rateCount}
            onDecide={(d) => mut.mutate({ id: String(i.issue_id), decision: d })}
            onChoose={() => setChooser({ issueId: String(i.issue_id) })} />
        ))}
      </div>
      {!issues.some((i) => issueActions(i)[0].kind === "chooser") && (
        <Button size="sm" variant="outline" onClick={() => setChooser({ issueId: null })}>Choose front label</Button>
      )}
      <FrontLabelChooser revisionId={revisionId} issueId={chooser?.issueId ?? null} open={!!chooser}
        onClose={() => setChooser(null)} onSaved={reload} />
    </section>
  );
});
