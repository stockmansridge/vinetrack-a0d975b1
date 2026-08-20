import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { SetupHealthSummary } from "@/lib/guide/setupHealth";

/**
 * System Admin-only setup health diagnostics (Stage 3.1 §12).
 *
 * Collapsed by default and rendered only inside the System Admin-gated guide.
 * Shows rule-level metadata: check id, status, importance, whether the check
 * is inside the readiness denominator, the source it was read from, the
 * readability state, the coverage detail ("11 of 14 blocks…") and the
 * applicability reason. It deliberately shows NO tokens, payloads, secrets,
 * signed URLs, personal information or row-level data dumps.
 */
export function SetupHealthDiagnostics({ summary }: { summary: SetupHealthSummary }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-[13.5px] font-semibold text-foreground">
            Setup health diagnostics
          </span>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            Internal
          </span>
        </span>
        <span className="text-[12px] text-muted-foreground">
          readiness {summary.completedRequired}/{summary.totalRequired}
          {summary.readinessPct !== null ? ` = ${summary.readinessPct}%` : ""}
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-border/70">
          <table className="w-full min-w-[860px] text-left text-[12px]">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Check ID</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Importance</th>
                <th className="px-3 py-2 font-semibold">In denominator</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Readable</th>
                <th className="px-3 py-2 font-semibold">Detail</th>
                <th className="px-3 py-2 font-semibold">Applicability</th>
                <th className="px-3 py-2 font-semibold">Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {summary.checks.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2 font-mono text-[11.5px] text-foreground">{c.id}</td>
                  <td className="px-3 py-2 text-foreground">{c.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.applicable ? c.importance : `${c.importance} (conditional)`}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.countsTowardReadiness ? "yes" : "no"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.source}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.sourceState === "ok" ? "ok" : "unreadable"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.detail ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.applicabilityReason ?? (c.applicable ? "always applies" : "not applicable")}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
                    {c.route ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
