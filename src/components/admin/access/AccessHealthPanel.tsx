import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { accessHealthSummary } from "@/lib/accessHealth";
import { useAccessHealth } from "@/lib/accessHealthQuery";

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet recorded";
}

function numberLabel(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString();
}

export function AccessHealthPanel() {
  const query = useAccessHealth();
  const health = query.data;
  const summary = health ? accessHealthSummary(health) : null;
  const scan = health?.latest_scan;

  return (
    <section aria-labelledby="access-health-title" className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="access-health-title" className="text-sm font-semibold">Access health</h2>
        <Button variant="ghost" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh access health
        </Button>
      </div>
      {query.isLoading ? (
        <div role="status" aria-label="Loading access health"><Skeleton className="h-40 w-full" /></div>
      ) : query.error || !health || !summary ? (
        <Card className="flex items-center gap-2 p-4 text-sm" role="alert">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-600" />
          Access health is unavailable. The latest scan status could not be confirmed. Refresh to try again.
        </Card>
      ) : (
        <Card className="p-4">
          <div className="mb-4 flex flex-wrap items-start gap-2" aria-live="polite">
            <Badge
              variant="outline"
              className={`gap-1 ${summary.tone === "healthy" ? "border-emerald-500/40 text-emerald-600" : summary.tone === "critical" ? "border-destructive/40 text-destructive" : summary.tone === "attention" ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
            >
              {summary.tone === "healthy" ? <CheckCircle2 aria-hidden="true" className="h-3 w-3" /> : summary.tone === "pending" ? <Clock3 aria-hidden="true" className="h-3 w-3" /> : <AlertTriangle aria-hidden="true" className="h-3 w-3" />}
              {summary.label}
            </Badge>
            <p className="flex-1 text-sm text-muted-foreground">{summary.description}</p>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3 xl:grid-cols-6">
            <div>
              <dt className="text-xs text-muted-foreground">Last successful scan</dt>
              <dd className="mt-1 font-medium">{dateLabel(health.scheduler.last_success_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Latest scan coverage</dt>
              <dd className="mt-1 font-medium">{scan ? `${numberLabel(scan.checked_accounts)} of ${numberLabel(scan.total_accounts)} accounts` : "No scan recorded"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stale states corrected</dt>
              <dd className="mt-1 font-medium">{numberLabel(scan?.stale_states_corrected)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Access mismatches</dt>
              <dd className="mt-1 font-medium">{numberLabel(scan?.mismatch_count)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">No mobile version recorded</dt>
              <dd className="mt-1 font-medium">{numberLabel(scan?.unknown_client_accounts)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Open monitoring issues</dt>
              <dd className="mt-1 font-medium">{numberLabel(health.open_issue_count)}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span>Rollout: {health.rollout.is_enabled ? (health.rollout.cohort === "all" ? "All users" : health.rollout.cohort ?? "No cohort") : "Disabled"}</span>
            <span>Configuration: {health.rollout.configuration_valid ? "Valid" : "Needs review"}</span>
            <span>Schedule: {health.scheduler.active ? "Active" : "Paused"}{health.scheduler.overdue ? " · Overdue" : ""}</span>
            <span>Latest scan: {scan?.status ?? "Not yet run"}{scan ? ` · ${numberLabel(scan.error_count)} errors` : ""}</span>
            <span>Updated: {dateLabel(health.generated_at)}</span>
          </div>
          {scan && scan.unknown_client_accounts > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Mobile coverage is unverified for accounts without a recorded iOS or Android app version. This can include accounts used only in the portal or without a mobile sign-in.</p>
          )}
        </Card>
      )}
    </section>
  );
}
