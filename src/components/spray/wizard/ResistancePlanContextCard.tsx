// Stage 5C — "From Resistance Plan" provenance card.
//
// Everything shown here about ORIGINAL intent comes from the frozen SQL 201
// snapshot on the job. The current plan is only consulted for link health.
import { Info, AlertTriangle, Link2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { fetchResistancePlan } from "@/lib/resistancePlanQuery";
import { positionGroupLabel } from "@/lib/resistancePlanContract";
import { DISEASE_LABEL, type ResistanceDisease } from "@/lib/resistance/resistanceRuleset";
import {
  LINK_STATE_LABEL,
  deviationAgainstSnapshot,
  DEVIATION_VERDICT_LABEL,
  frozenIntent,
  linkStateIsValidProvenance,
  resolveLinkStateLocally,
  type SprayJobPlanProvenance,
} from "@/lib/resistance/sprayJobPlanLink";
import { fetchSprayJobLinkState } from "@/lib/resistance/sprayJobPlanLinkQuery";

export function ResistancePlanContextCard({
  provenance,
  jobId,
  vineyardId,
  executedGroups,
  executedBlockIds,
  executedTargets,
  frozen,
}: {
  provenance: SprayJobPlanProvenance | null;
  jobId: string | null;
  vineyardId: string | null;
  executedGroups: string[];
  executedBlockIds: string[];
  executedTargets: string[] | null;
  /** True once a live spray record references the job — provenance is frozen. */
  frozen?: boolean;
}) {
  const planQ = useQuery({
    queryKey: ["resistance-plan", provenance?.planId],
    enabled: !!provenance?.planId,
    queryFn: () => fetchResistancePlan(provenance!.planId),
  });

  const serverStateQ = useQuery({
    queryKey: ["spray-job-link-state", jobId],
    enabled: !!jobId && !!provenance,
    queryFn: () => fetchSprayJobLinkState(jobId!),
  });

  if (!provenance) return null;

  const plan = planQ.data ?? null;
  const localState = resolveLinkStateLocally({
    provenance,
    jobVineyardId: vineyardId,
    plan: planQ.isLoading ? null : plan,
  });
  const state = serverStateQ.data ?? localState;
  const intent = frozenIntent(provenance);
  const planned = plan?.blockIds ?? [];

  const deviation = deviationAgainstSnapshot({
    provenance,
    planDisease: (plan?.disease as string | null) ?? null,
    plannedBlockIds: planned,
    executed: {
      referenceId: jobId ?? "draft",
      groups: executedGroups,
      blockIds: executedBlockIds,
      targets: executedTargets,
    },
  });

  const invalid = !linkStateIsValidProvenance(state) && state !== "pending_plan";

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">From Resistance Plan</span>
        <Badge variant={invalid ? "destructive" : "outline"}>{LINK_STATE_LABEL[state]}</Badge>
        {frozen && <Badge variant="secondary">Provenance locked by completion</Badge>}
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
        <div>
          Plan:{" "}
          <span className="text-foreground">
            {plan
              ? `${plan.seasonId} · ${DISEASE_LABEL[plan.disease as ResistanceDisease] ?? plan.disease}`
              : provenance.planId}
          </span>
        </div>
        <div>
          Position: <span className="text-foreground">{provenance.positionId}</span>
        </div>
        <div>
          Original planned intent:{" "}
          <span className="text-foreground">
            {intent ? positionGroupLabel(intent) : "Not recorded on this job"}
          </span>
        </div>
        <div>
          Plan revision at creation:{" "}
          <span className="text-foreground">{provenance.planSourceRevision ?? "—"}</span>
        </div>
      </div>

      {intent?.productName && (
        <div className="text-xs text-muted-foreground">
          Planned product: <span className="text-foreground">{intent.productName}</span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-md border bg-background p-2 text-xs">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div>
          <div className="font-medium">
            Plan deviation: {DEVIATION_VERDICT_LABEL[deviation.verdict]}
          </div>
          <p className="mt-0.5 text-muted-foreground">{deviation.summary}</p>
          <p className="mt-0.5 text-muted-foreground">
            This compares the job with the plan's intent only. It is not the resistance check —
            a job can differ from the plan and still be a good resistance fit.
          </p>
        </div>
      </div>

      {state === "position_missing" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          Original planned position no longer exists in the current plan. The frozen snapshot above
          is still what this job was created to do.
        </div>
      )}
      {state === "pending_plan" && (
        <div className="rounded-md border p-2 text-xs text-muted-foreground">
          The linked plan is not available right now (offline or not yet synced). The frozen
          snapshot is still authoritative for this job.
        </div>
      )}
      {state === "cross_vineyard_invalid" && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span>
            The referenced plan belongs to a different vineyard. This link is not treated as valid
            provenance.
          </span>
        </div>
      )}
    </div>
  );
}
