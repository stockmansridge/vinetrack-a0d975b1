import { Link } from "react-router-dom";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SetupStatusPill } from "./SetupCard";
import { SetupPresentationPill } from "./SetupPresentationPill";
import { deriveSetupPresentation } from "@/lib/guide/setupPresentation";
import type { SetupHealthSummary } from "@/lib/guide/setupHealth";
import { useGuideViewer } from "@/lib/guide/useGuideViewer";
import { setupActionDecision } from "@/lib/guide/guideAccess";

/**
 * Live Core Setup health detail (Stage 3).
 *
 * Shows the readiness figure and every individual check with its real status.
 * Readiness counts applicable REQUIRED checks only — recommended and optional
 * items are listed but never move the percentage.
 */
export function SetupHealthChecks({
  summary,
  loading,
  error,
  onRefresh,
}: {
  summary: SetupHealthSummary;
  loading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
}) {
  const presentation = deriveSetupPresentation(summary, { loading, error });
  const viewer = useGuideViewer();
  return (
    <Card className="overflow-hidden" data-setup-readiness={presentation.state}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="text-[14.5px] font-semibold text-foreground">Setup readiness</p>
          <SetupPresentationPill presentation={presentation} />
          {presentation.detail && (
            <span className="text-[12.5px] text-muted-foreground">{presentation.detail}</span>
          )}
          {!loading && !error && summary.recommendedOutstanding > 0 && (
            <span className="text-[12px] font-medium text-amber-700 dark:text-amber-400">
              {summary.recommendedOutstanding} recommendation
              {summary.recommendedOutstanding === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Re-check
          </Button>
        )}
      </div>

      {error && (
        <p className="border-b border-border/70 bg-destructive/5 px-4 py-2 text-[12.5px] text-destructive">
          Some setup checks could not be read: {error.message}
        </p>
      )}

      <ul className="divide-y divide-border/60">
        {summary.checks.map((check) => {
          const action =
            check.status === "complete"
              ? { show: false as const, hint: undefined }
              : setupActionDecision(check.route, viewer);
          return (
          <li
            key={check.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">{check.label}</p>
              {check.detail && (
                <p className="text-[12px] text-muted-foreground">{check.detail}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {check.importance}
              </span>
              <SetupStatusPill status={check.status} />
              {action.show && check.route && (
                <Link
                  to={check.route}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
                >
                  Open
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
              {!action.show && action.hint && (
                <span
                  data-setup-action-hint={check.id}
                  className="text-[11.5px] text-muted-foreground"
                >
                  {action.hint}
                </span>
              )}
            </div>
          </li>
          );
        })}
      </ul>
    </Card>
  );
}
