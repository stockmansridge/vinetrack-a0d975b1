// RefreshProgressPanel
// Persistent floating panel anchored top-right over the crop-health map.
// Shows per-paddock stage rows while a refresh is running, then transitions
// to a completion summary with a Dismiss button.
import { Loader2, CheckCircle2, XCircle, MinusCircle, RefreshCw, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

type PadStage =
  | "waiting" | "searching" | "found" | "downloading" | "processing"
  | "saving" | "manifest" | "loading_overlay"
  | "complete" | "no_imagery" | "failed" | "skipped";
type PadOutcome = "updated" | "reprocessed" | "already_current" | "no_newer" | "failed" | "skipped";
type PadErrorKind =
  | "provider_unavailable" | "no_newer_capture" | "processing_failed"
  | "asset_failed" | "overlay_failed" | null;

export type PadProgress = {
  id: string;
  name: string;
  stage: PadStage;
  errorKind: PadErrorKind;
  errorMessage?: string | null;
  oldSceneId?: string | null;
  oldProcessingVersion?: string | null;
  oldAssetId?: string | null;
  newSceneId?: string | null;
  newProcessingVersion?: string | null;
  newAssetId?: string | null;
  outcome?: PadOutcome;
  cacheInvalidated?: boolean;
  overlayRemounted?: boolean;
  overlayMountedAt?: string | null;
};

export type RefreshSummary = {
  updated: number;
  reprocessed: number;
  alreadyCurrent: number;
  noNewer: number;
  failed: number;
  displayed: number;
  expected: number;
};

export type RefreshProgressState = {
  running: boolean;
  total: number;
  order: string[];
  paddocks: Record<string, PadProgress>;
  summary?: RefreshSummary;
};

const STAGE_LABEL: Record<PadStage, string> = {
  waiting: "Waiting",
  searching: "Searching Copernicus",
  found: "Suitable capture found",
  downloading: "Downloading",
  processing: "Processing layers",
  saving: "Saving assets",
  manifest: "Updating manifest",
  loading_overlay: "Loading overlay",
  complete: "Complete",
  no_imagery: "No suitable imagery",
  failed: "Failed",
  skipped: "Already complete — skipped",
};

const OUTCOME_LABEL: Record<PadOutcome, string> = {
  updated: "Updated",
  reprocessed: "Reprocessed",
  already_current: "Already up to date",
  no_newer: "No newer imagery",
  failed: "Failed",
  skipped: "Skipped",
};

const ERROR_LABEL: Record<NonNullable<PadErrorKind>, string> = {
  provider_unavailable: "Provider unavailable",
  no_newer_capture: "No newer capture",
  processing_failed: "Processing failed",
  asset_failed: "Asset failed",
  overlay_failed: "Overlay failed",
};

function stageIcon(p: PadProgress) {
  const terminal = p.stage === "complete" || p.stage === "no_imagery" || p.stage === "failed" || p.stage === "skipped";
  if (!terminal) return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />;
  if (p.stage === "complete") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />;
  if (p.stage === "no_imagery") return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (p.stage === "skipped") return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
}

export default function RefreshProgressPanel({
  progress,
  isSystemAdmin,
  mountedPaddockCount,
  expectedCount,
  onDismiss,
}: {
  progress: RefreshProgressState;
  isSystemAdmin: boolean;
  mountedPaddockCount: number;
  expectedCount: number;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const list = progress.order.map((id) => progress.paddocks[id]).filter(Boolean);
  const terminalStages = new Set<PadStage>(["complete", "no_imagery", "failed", "skipped"]);
  const workItems = list.filter((p) => p.stage !== "skipped");
  const doneCount = workItems.filter((p) => terminalStages.has(p.stage)).length;
  const totalWork = progress.total || workItems.length;
  const pct = totalWork > 0 ? (doneCount / totalWork) * 100 : 100;
  const active = workItems.find((p) => !terminalStages.has(p.stage));
  const isRunning = progress.running || !!active;
  const summary = progress.summary;

  return (
    <div
      className="absolute right-3 top-3 z-[560] w-[340px] max-w-[calc(100vw-1.5rem)] rounded-lg border bg-background/95 shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        ) : (
          <RefreshCw className="h-4 w-4 text-primary shrink-0" />
        )}
        <div className="text-sm font-semibold flex-1 truncate">
          {isRunning ? "Refreshing Copernicus imagery" : "Refresh complete"}
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse panel" : "Expand panel"}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />
        </button>
        {!isRunning && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 py-2 space-y-2 max-h-[60vh] overflow-y-auto">
          {isRunning && (
            <>
              <Progress value={pct} className="h-1.5" />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Overall: <span className="text-foreground font-medium">{doneCount} of {totalWork} paddocks finished</span></span>
                {active && (
                  <span className="truncate max-w-[55%] text-right">Current: <span className="text-foreground font-medium">{active.name}</span></span>
                )}
              </div>
            </>
          )}


          {summary && (
            <div className="rounded-md border bg-muted/30 p-2 text-[11px] space-y-1">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span>New imagery: <span className="text-foreground font-medium">{summary.updated}</span></span>
                <span>Reprocessed: <span className="text-foreground font-medium">{summary.reprocessed}</span></span>
                <span>Already current: <span className="text-foreground font-medium">{summary.alreadyCurrent}</span></span>
                <span>No newer imagery: <span className="text-foreground font-medium">{summary.noNewer}</span></span>
                <span>Failed: <span className="text-foreground font-medium">{summary.failed}</span></span>
              </div>
              <div className="text-muted-foreground">
                Displayed: <span className="text-foreground font-medium">{mountedPaddockCount} of {expectedCount} paddocks</span>
              </div>
            </div>
          )}

          <div className="divide-y divide-border/60">
            {list.map((p) => {
              const showStageDetail = !terminalStages.has(p.stage);
              const label = showStageDetail
                ? STAGE_LABEL[p.stage]
                : (p.outcome ? OUTCOME_LABEL[p.outcome] : STAGE_LABEL[p.stage]);
              const errorLine = p.errorKind ? ERROR_LABEL[p.errorKind] : null;
              return (
                <div key={p.id} className="py-1.5 flex items-start gap-2">
                  <div className="pt-0.5">{stageIcon(p)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {label}
                      {errorLine && terminalStages.has(p.stage) && p.outcome === "failed" ? ` · ${errorLine}` : ""}
                    </div>
                    {isSystemAdmin && showDiagnostics && (
                      <div className="mt-1 rounded-sm bg-muted/40 px-1.5 py-1 text-[10px] text-muted-foreground font-mono leading-tight">
                        <div>old scene: {p.oldSceneId ?? "—"}</div>
                        <div>new scene: {p.newSceneId ?? "—"}</div>
                        <div>old asset: {p.oldAssetId ?? "—"}</div>
                        <div>new asset: {p.newAssetId ?? "—"}</div>
                        <div>reused asset: {String(!!(p.oldAssetId && p.oldAssetId === p.newAssetId))}</div>
                        <div>cache invalidated: {String(!!p.cacheInvalidated)}</div>
                        <div>overlay remounted: {String(!!p.overlayRemounted)}</div>
                        <div>mounted at: {p.overlayMountedAt ?? "—"}</div>
                      </div>
                    )}
                  </div>
                  {terminalStages.has(p.stage) && p.outcome && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 shrink-0 ${
                        p.outcome === "updated" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        : p.outcome === "reprocessed" ? "border-blue-500/40 text-blue-700 dark:text-blue-400"
                        : p.outcome === "already_current" ? "border-muted-foreground/30 text-muted-foreground"
                        : p.outcome === "no_newer" ? "border-muted-foreground/30 text-muted-foreground"
                        : p.outcome === "failed" ? "border-destructive/40 text-destructive"
                        : "border-muted-foreground/30 text-muted-foreground"
                      }`}
                    >
                      {OUTCOME_LABEL[p.outcome]}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>

          {isSystemAdmin && (
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] px-2 text-muted-foreground"
                onClick={() => setShowDiagnostics((v) => !v)}
              >
                {showDiagnostics ? "Hide" : "Show"} admin diagnostics
              </Button>
            </div>
          )}

          {summary && (
            <div className="pt-1 flex justify-end">
              <Button size="sm" variant="outline" onClick={onDismiss}>Dismiss</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
