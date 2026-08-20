// Stage 5C — Plan → Proposed → Actual, seen from the Resistance Planner.
//
// One planned position may produce many Spray Jobs. Progress shown here is
// DERIVED from SQL 201 coverage every render; nothing is written back to
// `resistance_plans`, and the plan's server_revision is never bumped.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SprayJobWizard } from "@/components/spray/wizard/SprayJobWizard";
import { useWizardLookups } from "@/components/spray/wizard/useWizardLookups";
import {
  fetchLinkedSprayRecords,
  type SprayJob,
} from "@/lib/sprayJobsQuery";
import type { ResistancePlan, ResistancePlanPosition } from "@/lib/resistancePlanContract";
import {
  POSITION_PROGRESS_LABEL,
  derivePositionProgress,
  deviationAgainstSnapshot,
  DEVIATION_VERDICT_LABEL,
  provenanceFromJobRow,
  provenanceFromPosition,
} from "@/lib/resistance/sprayJobPlanLink";
import {
  fetchPositionCoverage,
  fetchSprayJobsForPosition,
} from "@/lib/resistance/sprayJobPlanLinkQuery";
import { formatDate } from "@/lib/dateFormat";

export function PlanPositionLinkage({
  plan,
  position,
  canEdit,
  dirty,
}: {
  plan: ResistancePlan;
  position: ResistancePlanPosition;
  canEdit: boolean;
  /** Unsaved plan edits — a job must freeze a saved position, not a draft. */
  dirty: boolean;
}) {
  const navigate = useNavigate();
  const lookups = useWizardLookups(plan.vineyardId || null);
  const [creating, setCreating] = useState(false);
  const [editingJob, setEditingJob] = useState<SprayJob | null>(null);

  const enabled = !!plan.id && !!position.id;

  const coverageQ = useQuery({
    queryKey: ["resistance-position-coverage", plan.id, position.id],
    enabled,
    queryFn: () => fetchPositionCoverage(plan.id, position.id),
  });

  const jobsQ = useQuery({
    queryKey: ["resistance-position-jobs", plan.id, position.id],
    enabled,
    queryFn: () => fetchSprayJobsForPosition(plan.id, position.id),
  });

  const jobs = (jobsQ.data ?? []) as SprayJob[];
  const coverage = coverageQ.data ?? {
    sprayJobIds: jobs.map((j) => j.id),
    proposedBlockIds: [],
    completedBlockIds: [],
  };

  const deviations = useMemo(
    () =>
      jobs.map((job) =>
        deviationAgainstSnapshot({
          provenance: provenanceFromJobRow(job),
          planDisease: (plan.disease as string) ?? null,
          plannedBlockIds: plan.blockIds,
          executed: {
            referenceId: job.id,
            groups: (job.chemical_lines ?? []).flatMap((l: any) =>
              Array.isArray(l?.activity_groups)
                ? l.activity_groups.map((g: any) => String(g?.code ?? g))
                : [],
            ),
            blockIds: [],
            targets: job.targets ?? null,
          },
        }),
      ),
    [jobs, plan.disease, plan.blockIds],
  );

  const progress = derivePositionProgress({
    plannedBlockIds: plan.blockIds,
    coverage,
    anyDeviation: deviations.some((d) => d.verdict === "differs"),
  });

  const provenance = provenanceFromPosition({ plan, position });

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-background/60 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{POSITION_PROGRESS_LABEL[progress]}</Badge>
        {(coverageQ.isLoading || jobsQ.isLoading) && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        <span className="text-muted-foreground">
          {jobs.length} spray job{jobs.length === 1 ? "" : "s"} ·{" "}
          {coverage.completedBlockIds.length} of {plan.blockIds.length} planned block
          {plan.blockIds.length === 1 ? "" : "s"} completed
        </span>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            disabled={!plan.id || dirty}
            onClick={() => setCreating(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Create Spray Job
          </Button>
        )}
      </div>

      {dirty && plan.id && (
        <p className="text-muted-foreground">
          Save the plan before creating a spray job — the job freezes the saved position.
        </p>
      )}
      {!plan.id && (
        <p className="text-muted-foreground">
          Save this plan first; a spray job can only be created from a saved position.
        </p>
      )}

      {jobs.map((job, i) => (
        <PositionJobRow
          key={job.id}
          job={job}
          deviationLabel={DEVIATION_VERDICT_LABEL[deviations[i].verdict]}
          onOpen={() => setEditingJob(job)}
          onOpenRecords={() => navigate("/spray-records")}
        />
      ))}

      {creating && plan.vineyardId && (
        <SprayJobWizard
          open
          onOpenChange={(o) => !o && setCreating(false)}
          vineyardId={plan.vineyardId}
          job={null}
          isTemplate={false}
          canEdit={canEdit}
          lookups={lookups}
          planProvenance={provenance}
          prefill={{
            blockIds: [...plan.blockIds],
            targets: [(position.target ?? plan.disease) as any].filter(Boolean),
            name: `Plan position ${position.sequence} — ${position.groups.join(" + ")}`,
          }}
          onCreated={() => {
            coverageQ.refetch();
            jobsQ.refetch();
          }}
        />
      )}

      {editingJob && plan.vineyardId && (
        <SprayJobWizard
          open
          onOpenChange={(o) => !o && setEditingJob(null)}
          vineyardId={plan.vineyardId}
          job={editingJob}
          isTemplate={false}
          canEdit={canEdit}
          lookups={lookups}
        />
      )}
    </div>
  );
}

function PositionJobRow({
  job,
  deviationLabel,
  onOpen,
  onOpenRecords,
}: {
  job: SprayJob;
  deviationLabel: string;
  onOpen: () => void;
  onOpenRecords: () => void;
}) {
  const recordsQ = useQuery({
    queryKey: ["spray_records_linked", job.id],
    queryFn: () => fetchLinkedSprayRecords(job.id),
  });
  const records = recordsQ.data ?? [];

  return (
    <div className="rounded border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{records.length > 0 ? "Completed" : "Proposed"}</Badge>
        <span className="font-medium">{job.name || "Spray job"}</span>
        <span className="text-muted-foreground">
          {job.planned_date ? formatDate(new Date(job.planned_date)) : "No date"} ·{" "}
          {job.status ?? "draft"}
        </span>
        <Badge variant="secondary">{deviationLabel}</Badge>
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={onOpen}>
          Open Spray Job
        </Button>
      </div>
      {records.map((rec) => (
        <div key={rec.id} className="mt-1 flex items-center gap-2 text-muted-foreground">
          <span>
            Completed record {rec.spray_reference || rec.id.slice(0, 8)}
            {rec.date ? ` · ${rec.date}` : ""}
          </span>
          <Button size="sm" variant="ghost" className="h-6" onClick={onOpenRecords}>
            <ExternalLink className="mr-1 h-3 w-3" /> Open record
          </Button>
        </div>
      ))}
    </div>
  );
}
