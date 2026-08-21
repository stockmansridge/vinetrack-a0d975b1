// Compact "what has to be decided" summary at the top of a Master review.
//
// Presentation only: every number is derived from what the backend already
// stored on the record. Nothing here approves, edits or persists.
import { AlertTriangle, BadgeCheck, CircleHelp, RefreshCw, ShieldCheck } from "lucide-react";
import type { MasterReviewSummary } from "@/lib/masterReview";

function Tile({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof AlertTriangle;
  value: string;
  label: string;
  tone: "danger" | "warn" | "ok" | "muted";
}) {
  const cls =
    tone === "danger"
      ? "border-destructive/50 bg-destructive/10 text-destructive"
      : tone === "warn"
        ? "border-warning/50 bg-warning/10 text-warning-foreground"
        : tone === "ok"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/60 bg-muted/40 text-muted-foreground";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-3.5 w-3.5" />
        {value}
      </div>
      <div className="text-[11px] opacity-90">{label}</div>
    </div>
  );
}

export function MasterReviewSummaryCard({ summary }: { summary: MasterReviewSummary }) {
  const fresh =
    summary.fresherAvailable == null
      ? { value: "Not checked", label: "Fresher APVMA data", tone: "muted" as const }
      : summary.fresherAvailable
        ? { value: "Yes", label: "Fresher APVMA data available", tone: "warn" as const }
        : { value: "Up to date", label: "Matches latest APVMA fetch", tone: "ok" as const };

  return (
    <div className="rounded-md border border-border/60 p-2 space-y-2">
      <div className="text-xs font-semibold">Review summary</div>
      <div className="text-xs text-muted-foreground">{summary.headline}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          icon={summary.decisionsRequired > 0 ? AlertTriangle : BadgeCheck}
          value={String(summary.decisionsRequired)}
          label="Items requiring a decision"
          tone={summary.decisionsRequired > 0 ? "danger" : "ok"}
        />
        <Tile
          icon={CircleHelp}
          value={String(summary.unresolvedFields.length)}
          label="Unresolved fields"
          tone={summary.unresolvedFields.length > 0 ? "warn" : "ok"}
        />
        <Tile
          icon={ShieldCheck}
          value={String(summary.autoResolved)}
          label="Auto-resolved by source precedence"
          tone="muted"
        />
        <Tile icon={RefreshCw} value={fresh.value} label={fresh.label} tone={fresh.tone} />
      </div>
      {summary.unresolvedFields.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium">Unresolved: </span>
          {summary.unresolvedFields.join(", ")}
        </div>
      )}
      {summary.blockingReasons.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
          {summary.blockingReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
