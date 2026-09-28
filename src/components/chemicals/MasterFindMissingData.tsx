// "Find Missing Data": Master ID → backend enrichment → server-owned preview →
// admin reviews Current vs Proposed → audited apply (preview id + master id +
// reason only). Nothing here changes the database until Apply succeeds.
import { useEffect, useRef, useState } from "react";
import { Loader2, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import { requestMasterBackfillPreview, type BackfillResult } from "@/lib/masterBackfill";
import {
  applyMasterReviewPreview, formatIdentity, previewApplyBlockedReason,
} from "@/lib/masterReviewPreview";

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : [];

export function MasterFindMissingData({
  row,
  trigger,
  onApplied,
  onNextIncomplete,
}: {
  row: MasterChemicalRow;
  /** Increment to run the preview from elsewhere (checklist / footer). */
  trigger?: number;
  onApplied?: (row: MasterChemicalRow | null) => void;
  onNextIncomplete?: () => void;
}) {
  const [state, setState] = useState<BackfillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reason, setReason] = useState("");
  const [applied, setApplied] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setState(null);
    setApplied(null);
    setReason("");
  }, [row.id]);

  const run = async () => {
    setLoading(true);
    setApplied(null);
    try {
      setState(await requestMasterBackfillPreview(row.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (trigger) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const preview = state?.outcome === "preview" ? state.preview : null;
  const blocked = preview ? previewApplyBlockedReason(preview) : null;
  const raw = (preview?.raw ?? {}) as Record<string, any>;
  const remaining = list(raw.remaining_unresolved ?? raw.unresolved_fields ?? preview?.proposedPatch?.verification_unresolved_fields);
  const conflicts = list(raw.conflicts ?? preview?.proposedPatch?.verification_conflicts);
  const labelUrl = (raw.manufacturer_label_url ?? raw.label_url ?? null) as string | null;
  const source = (raw.evidence_source ?? raw.source ?? null) as string | null;

  const apply = async () => {
    if (!preview?.previewId) return;
    setApplying(true);
    try {
      const res = await applyMasterReviewPreview({ previewId: preview.previewId, masterId: row.id, reason });
      if (res.outcome === "applied" || res.outcome === "already_applied") {
        setApplied(preview.changes.map((c) => c.label));
        setState(null);
        toast({ title: "Applied", description: res.message });
        onApplied?.(res.row);
      } else {
        toast({ title: "Not applied", description: res.message, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Not applied", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  return (
    <section ref={ref} className="rounded-md border border-border/60 p-3 space-y-2" aria-label="Find Missing Data">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Find Missing Data</span>
        <Button size="sm" variant="outline" disabled={loading || applying} onClick={run}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <SearchCheck className="h-4 w-4 mr-1" />}
          {preview ? "Run again" : "Find Missing Data"}
        </Button>
      </div>

      {state?.outcome === "unavailable" && (
        <p className="text-xs text-muted-foreground" role="status">{state.message}</p>
      )}
      {state?.outcome === "error" && (
        <p className="text-xs text-destructive" role="alert">{state.message} Nothing was changed.</p>
      )}

      {applied && (
        <div className="text-xs space-y-1" role="status">
          <div>Applied. Updated: {applied.join(", ") || "no fields"}. Review status unchanged.</div>
          {onNextIncomplete && (
            <Button size="sm" onClick={onNextIncomplete}>Next incomplete product</Button>
          )}
        </div>
      )}

      {preview && (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            Preview only — nothing has been changed yet.
          </p>
          <div className="text-muted-foreground">
            Locked identity: {formatIdentity(preview.identityStored)}
            {row.registration_number ? ` · APVMA ${row.registration_number}` : ""}
            {source ? ` · Source: ${source}` : ""}
          </div>
          {labelUrl && (
            <a className="underline" href={labelUrl} target="_blank" rel="noopener noreferrer">
              Manufacturer label
            </a>
          )}
          {preview.changes.length === 0 ? (
            <div className="text-muted-foreground">No evidence-backed changes were proposed.</div>
          ) : (
            <div className="rounded-md border border-border/60 divide-y divide-border/60">
              {preview.changes.map((c) => (
                <div key={c.field} className="px-3 py-2">
                  <div className="font-medium">{c.label}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-muted-foreground">Current: </span>{c.current ?? "None"}</div>
                    <div><span className="text-muted-foreground">Proposed: </span>{c.proposed ?? "None"}</div>
                  </div>
                  {c.source && <div className="text-muted-foreground">Source: {c.source}</div>}
                </div>
              ))}
            </div>
          )}
          {conflicts.length > 0 && <div>Conflicts: {conflicts.join(", ")}</div>}
          {remaining.length > 0 && <div className="text-muted-foreground">Still unresolved: {remaining.join(", ")}</div>}
          {blocked ? (
            <div className="text-muted-foreground">{blocked}</div>
          ) : (
            <>
              <Textarea rows={2} placeholder="Reason for applying (required)" value={reason}
                onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" disabled={!reason.trim() || applying} onClick={apply}>
                {applying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Apply reviewed changes
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
