// Review timeline from `master_chemical_review_actions` (SQL 203).
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { fetchMasterReviewActions } from "@/lib/masterReviewActions";

export function MasterReviewHistory({
  masterChemicalId,
  enabled = true,
}: {
  masterChemicalId: string;
  enabled?: boolean;
}) {
  const q = useQuery({
    queryKey: ["master-review-actions", masterChemicalId],
    enabled,
    queryFn: () => fetchMasterReviewActions(masterChemicalId),
  });

  return (
    <div className="rounded-md border border-border/60">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
        <History className="h-3.5 w-3.5" /> Review history
      </div>
      <div className="divide-y divide-border/60 text-xs">
        {q.isLoading ? (
          <div className="px-3 py-2 text-muted-foreground">Loading…</div>
        ) : q.error ? (
          <div className="px-3 py-2 text-muted-foreground">
            Review history is not readable for your account.
          </div>
        ) : (q.data ?? []).length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground">No review actions recorded yet.</div>
        ) : (
          (q.data ?? []).map((e) => (
            <div key={e.id} className="px-3 py-2 space-y-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium capitalize">{e.action}</span>
                <span className="text-muted-foreground">
                  {e.reviewer} · {e.at ? new Date(e.at).toLocaleString() : "—"}
                </span>
              </div>
              <div className="text-muted-foreground">
                {e.target ? <span className="mr-2">{e.target}</span> : null}
                {e.baseRevision != null || e.resultRevision != null ? (
                  <span>
                    rev {e.baseRevision ?? "—"} → {e.resultRevision ?? "—"}
                  </span>
                ) : null}
              </div>
              {e.reason && <div className="text-muted-foreground/90">{e.reason}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
