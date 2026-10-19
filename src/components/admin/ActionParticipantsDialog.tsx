import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAdminUsers, useAdminVineyards } from "@/lib/adminApi";
import { fetchActionParticipants, type ParticipantKind } from "@/lib/adminActionParticipants";

export interface ParticipantSelection { action: string; label: string; kind: ParticipantKind; days: number | null; period: string; expected: number }
export function ActionParticipantsDialog({ selection, onClose }: { selection: ParticipantSelection; onClose: () => void }) {
  const users = useAdminUsers();
  const vineyards = useAdminVineyards();
  const query = useQuery({
    queryKey: ["admin", "action-participants", selection.action, selection.kind, selection.days, selection.expected],
    retry: false,
    queryFn: ({ signal }) => fetchActionParticipants(selection.action, selection.kind, selection.days, selection.expected, signal),
  });
  const names = selection.kind === "users" ? users : vineyards;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{selection.label} · {selection.kind === "users" ? "Users" : "Vineyards"}</DialogTitle>
        <DialogDescription>{selection.period} · Records added in this period{selection.kind === "users" ? "; attributed to their recorded creator, not the person who edited or deleted them." : "."}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-auto">
        {(query.isLoading || names.isLoading) && <p className="text-sm text-muted-foreground">Loading details…</p>}
        {(query.error || names.error) && <div className="space-y-3 text-sm"><p role="alert">{query.error ? (query.error as Error).message : "Names could not be loaded."}</p><Button variant="outline" size="sm" onClick={() => { void query.refetch(); void names.refetch(); }}>Try again</Button></div>}
        {!query.isLoading && !names.isLoading && !query.error && !names.error && <div className="divide-y divide-border">
          {query.data?.map((participant) => {
            const u = users.data?.find((r) => r.id === participant.id);
            const v = vineyards.data?.find((r) => r.id === participant.id);
            const name = selection.kind === "users" ? u?.full_name || u?.email : v?.name;
            return <div key={participant.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">{name ? <Link className="text-primary hover:underline break-words" to={`/admin/${selection.kind}/${participant.id}`} onClick={onClose}>{name}</Link> : <span className="text-muted-foreground">{selection.kind === "users" ? "Unavailable user" : "Unavailable vineyard"} · {participant.id}</span>}
                {selection.kind === "users" && u?.full_name && <div className="text-xs text-muted-foreground break-all">{u.email}</div>}
              </div><span className="shrink-0 text-sm tabular-nums">{participant.records.toLocaleString()} added</span>
            </div>;
          })}
          {query.data?.length === 0 && <p className="py-4 text-sm text-muted-foreground">No recorded participants in this period.</p>}
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}