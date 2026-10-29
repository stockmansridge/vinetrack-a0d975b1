// System Admin dialog: edit research hints for an existing discovery job.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchV3Job, pick, startV3Discovery, V3_REUSED_MESSAGE } from "@/lib/chemicalV3";
import {
  EMPTY_HINTS, HINTS_EXPLAINER, HINT_LIMITS, ResearchHintsDraft, hintExactRegistrationConflict, hintIdentityWarning, isJobBusy,
  readResearchHints, saveResearchHints, validateResearchHints,
} from "@/lib/chemicalV3ResearchHints";

type Row = Record<string, any>;

export function V3ResearchHintsDialog({ open, onOpenChange, jobId, revision, onSaveAndRetry, forceDistinct = false }: {
  open: boolean; forceDistinct?: boolean; onOpenChange: (o: boolean) => void; jobId: string; revision: Row | null | undefined;
  /** Called only after the hints RPC succeeded. */
  onSaveAndRetry: () => void;
}) {
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ["chemical-v3-job-hints", jobId], queryFn: () => fetchV3Job(jobId), enabled: open, staleTime: 0 });
  const [draft, setDraft] = useState<ResearchHintsDraft>(EMPTY_HINTS);
  const seeded = useRef(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [distinct, setDistinct] = useState<string | null>(null);

  useEffect(() => { if (!open) { seeded.current = false; setErr(null); setSaved(null); setDistinct(null); } }, [open]);
  useEffect(() => {
    if (open && !seeded.current && job.data !== undefined) { setDraft(readResearchHints(job.data)); seeded.current = true; }
  }, [open, job.data]);

  const errors = validateResearchHints(draft);
  const invalid = Object.keys(errors).length > 0;
  const status = String(pick(job.data, "status") ?? "");
  const running = isJobBusy(status);
  const warning = hintIdentityWarning(revision, draft);
  const exactConflict = hintExactRegistrationConflict(revision, draft);
  const showDistinct = !!warning || forceDistinct;
  const set = (k: keyof ResearchHintsDraft) => (e: { target: { value: string } }) => { setDraft((d) => ({ ...d, [k]: e.target.value })); setSaved(null); };

  const save = async (retry: boolean) => {
    if (invalid || running) return;
    setBusy(true); setErr(null);
    try {
      await saveResearchHints(jobId, draft);
      await qc.invalidateQueries({ queryKey: ["chemical-v3-job-hints", jobId] });
      if (retry) { onOpenChange(false); onSaveAndRetry(); }
      else setSaved("Research instructions saved.");
    } catch (e: any) {
      setErr(e?.message ? `Couldn't save research instructions: ${e.message}` : "Couldn't save research instructions.");
    } finally { setBusy(false); }
  };

  const startDistinct = async () => {
    const q = draft.productName.trim();
    if (!q) return;
    setBusy(true); setErr(null);
    try {
      const r = await startV3Discovery({ query: q, countryCode: pick(revision, "country_code") ?? null, inputKind: "text", photoPath: null, vineyardId: null });
      setDistinct(r.reused ? V3_REUSED_MESSAGE : `Started a separate discovery for "${q}". It will appear in the review queue.`);
      void qc.invalidateQueries({ queryKey: ["chemical-v3-queue"] });
    } catch (e: any) { setErr(`Couldn't start a separate discovery: ${e?.message ?? "unknown error"}`); }
    finally { setBusy(false); }
  };

  const ctx = (label: string, v: unknown) => (
    <div><span className="text-muted-foreground">{label}: </span>{v ? String(v) : "—"}</div>
  );
  const link = (label: string, v: unknown) => v ? (
    <div><span className="text-muted-foreground">{label}: </span><a className="break-all text-primary underline" href={String(v)} target="_blank" rel="noreferrer">{String(v)}</a></div>
  ) : ctx(label, null);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="v3-hints-dialog" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Refine AI research</DialogTitle>
          <DialogDescription>{HINTS_EXPLAINER}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 rounded border bg-muted/40 p-2 text-xs" data-testid="v3-hints-context">
          {ctx("Searched name", pick(job.data, "query", "search_query", "query_text") ?? pick(revision, "product_name"))}
          {ctx("Discovered product", pick(revision, "product_name"))}
          {ctx("APVMA registration (exact)", pick(revision, "registration_number"))}
          {ctx("Manufacturer", pick(revision, "manufacturer", "registrant"))}
          {link("Manufacturer product page", pick(revision, "manufacturer_product_url"))}
          {link("Manufacturer label", pick(revision, "manufacturer_label_url"))}
          {link("Regulator (APVMA) label", pick(revision, "regulator_label_url", "apvma_label_url"))}
        </div>
        {running && <p className="rounded border border-warning/50 bg-warning/10 p-2 text-sm" data-testid="v3-hints-busy">
          Research is currently running for this product. Wait for it to finish before changing research instructions.</p>}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="v3h-name">Corrected search / product name</Label>
            <Input id="v3h-name" value={draft.productName} onChange={set("productName")} maxLength={HINT_LIMITS.name + 20} />
            <p className="text-xs text-muted-foreground">Used for research only — does not rename the verified product.</p>
            {errors.productName && <p className="text-xs text-destructive">{errors.productName}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="v3h-product">Manufacturer product page URL</Label>
            <Input id="v3h-product" value={draft.productUrl} onChange={set("productUrl")} placeholder="https://" />
            {errors.productUrl && <p className="text-xs text-destructive">{errors.productUrl}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="v3h-label">Direct manufacturer label URL or document viewer</Label>
            <Input id="v3h-label" value={draft.labelUrl} onChange={set("labelUrl")} placeholder="https://" />
            <p className="text-xs text-muted-foreground">The manufacturer's own label — not the APVMA regulator label.</p>
            {errors.labelUrl && <p className="text-xs text-destructive">{errors.labelUrl}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="v3h-notes">Additional research instructions</Label>
            <Textarea id="v3h-notes" rows={4} value={draft.notes} onChange={set("notes")} />
            <p className="text-xs text-muted-foreground">{draft.notes.trim().length}/{HINT_LIMITS.notes}</p>
            {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
          </div>
        </div>
        {showDistinct && (
          <div className="space-y-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm" data-testid="v3-hints-identity-warning">
            <div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-destructive" /><span>{warning ?? "The server found a different registered product. Enter its name and start a separate discovery."}</span></div>
            <p className="text-xs">Re-searching this job will not merge products. If this is a different product, start a separate discovery instead.</p>
            <Button size="sm" variant={exactConflict || forceDistinct ? "default" : "outline"} disabled={busy || !draft.productName.trim()} onClick={startDistinct}>
              Start separate discovery{draft.productName.trim() ? ` for "${draft.productName.trim()}"` : ""}
            </Button>
            {distinct && <p className="text-xs">{distinct}</p>}
          </div>
        )}
        {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
        {saved && <p className="text-sm text-success">{saved}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" disabled={busy || invalid || running || job.isLoading} onClick={() => save(false)}>Save research instructions</Button>
          {exactConflict || forceDistinct
            ? <p className="text-xs text-muted-foreground" data-testid="v3-hints-no-retry">Re-searching this product with a different registration is not allowed.</p>
            : <Button disabled={busy || invalid || running || job.isLoading} onClick={() => save(true)}>Save &amp; re-search</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
