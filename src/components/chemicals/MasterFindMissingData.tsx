// "Find Missing Data": Master ID → backend enrichment → server-owned preview →
// admin reviews Current vs Proposed → audited apply (preview id + master id +
// reason only). Nothing here changes the database until Apply succeeds.
import { useEffect, useRef, useState } from "react";
import { Loader2, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { MasterChemicalRow } from "@/lib/masterChemicals";
import { readBackfillView, requestMasterBackfillPreview, type BackfillResult } from "@/lib/masterBackfill";
import {
  applyMasterReviewPreview, formatIdentity, identityEmpty, previewApplyBlockedReason,
} from "@/lib/masterReviewPreview";

export function MasterFindMissingData({
  row,
  trigger,
  onApplied,
  onNextIncomplete,
  disabled = false,
}: {
  row: MasterChemicalRow;
  /** Parent drawer has a save/approve in flight — lock competing actions. */
  disabled?: boolean;
  /** Increment to run the preview from elsewhere (checklist / footer). */
  trigger?: number;
  onApplied?: (row: MasterChemicalRow | null) => void;
  onNextIncomplete?: () => void;
}) {
  const [state, setState] = useState<BackfillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reason, setReason] = useState("");
  const [applied, setApplied] = useState<{ fields: string[]; revision: number | null } | null>(null);
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
    if (trigger && !disabled) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const preview = state?.outcome === "preview" ? state.preview : null;
  const view = preview
    ? readBackfillView(
        preview,
        row.registration_number,
        identityEmpty(preview.identityStored) ? null : formatIdentity(preview.identityStored),
      )
    : null;
  const blocked = preview && view?.canApply ? previewApplyBlockedReason(preview) : null;
  const rowIdentity = [row.registered_product_name, row.registration_country, row.registration_scheme, row.registration_number]
    .filter(Boolean).join(" · ");

  const apply = async () => {
    if (!preview?.previewId) return;
    setApplying(true);
    try {
      const res = await applyMasterReviewPreview({ previewId: preview.previewId, masterId: row.id, reason });
      if (res.outcome === "applied" || res.outcome === "already_applied") {
        setApplied({ fields: preview.changes.map((c) => c.label), revision: res.revision });
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
        <Button size="sm" variant="outline" disabled={disabled || loading || applying} onClick={run}>
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
          <div>
            {applied.revision != null ? `Applied — revision ${applied.revision}.` : "Applied."} Updated:{" "}
            {applied.fields.join(", ") || "no fields"}. Review status unchanged.
          </div>
          {onNextIncomplete && (
            <Button size="sm" disabled={disabled} onClick={onNextIncomplete}>Next incomplete product</Button>
          )}
        </div>
      )}

      {preview && view && (
        <div className="space-y-2 text-xs">
          {view.statusMessage ? (
            <p className={view.status.endsWith("conflict") ? "text-destructive" : "text-muted-foreground"} role="status">
              {view.statusMessage}
            </p>
          ) : (
            <p className="text-muted-foreground">Preview only — nothing has been changed yet.</p>
          )}
          <div className="text-muted-foreground">
            Locked identity: {view.lockedIdentity ?? (rowIdentity || "Not reported")}
            {view.source ? ` · Source: ${view.source}` : ""}
          </div>
          {view.reportedRegistrationNumber && (
            <div className={view.registrationMismatch ? "text-destructive" : "text-muted-foreground"}>
              Reported registration: {view.reportedRegistrationNumber}
              {view.registrationMismatch ? ` — does not match stored ${row.registration_number}` : ""}
            </div>
          )}
          {view.manufacturerLabelUrl && (
            <a className="underline" href={view.manufacturerLabelUrl} target="_blank" rel="noopener noreferrer">
              Manufacturer label
            </a>
          )}
          {view.findings.length > 0 && (
            <ul className="list-disc pl-4 text-muted-foreground">
              {view.findings.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          {view.canApply && (preview.changes.length === 0 ? (
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
          ))}
          {view.conflicts.length > 0 && <div>Conflicts: {view.conflicts.join(", ")}</div>}
          {view.remaining.length > 0 && <div className="text-muted-foreground">Still unresolved: {view.remaining.join(", ")}</div>}
          {view.canApply && (blocked ? (
            <div className="text-muted-foreground">{blocked}</div>
          ) : (
            <>
              <Textarea rows={2} placeholder="Reason for applying (required)" value={reason}
                onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" disabled={disabled || !reason.trim() || applying} onClick={apply}>
                {applying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Apply reviewed changes
              </Button>
            </>
          ))}
        </div>
      )}
    </section>
  );
}
