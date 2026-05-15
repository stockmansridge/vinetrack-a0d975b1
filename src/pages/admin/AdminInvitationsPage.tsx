import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminInvitations } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, StatusPill, formatDate } from "./_shared";

export default function AdminInvitationsPage() {
  const { data = [], isLoading, error } = useAdminInvitations();
  return (
    <AdminGate>
      <AdminPageHeader title="Invitations" subtitle={`${data.length} total`} />
      <Card className="p-4">
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && data.length === 0 && <AdminEmpty>No invitations.</AdminEmpty>}
        <div className="divide-y">
          {data.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 py-2 px-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{inv.email}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {inv.vineyard_name ?? "—"} · {inv.role}
                </div>
              </div>
              <StatusPill status={inv.status} />
              <Badge variant="outline" className="text-xs">{formatDate(inv.created_at)}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
