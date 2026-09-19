import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminVineyards, useAdminVineyardPaddocks, useAdminVineyardMembers } from "@/lib/adminApi";
import { computeAdminVineyardStats, formatHa } from "@/lib/adminVineyardStats";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate } from "./_shared";
import AdminVineyardMap from "@/components/admin/AdminVineyardMap";

export default function AdminVineyardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const vineyardsQ = useAdminVineyards();
  const paddocksQ = useAdminVineyardPaddocks(id);
  const membersQ = useAdminVineyardMembers(id);
  const v = vineyardsQ.data?.find((x) => x.id === id);
  const stats = computeAdminVineyardStats(paddocksQ.data);


  return (
    <AdminGate>
      <AdminPageHeader
        title={v?.name ?? "Vineyard"}
        subtitle={v?.owner_email ?? undefined}
        back="/admin/vineyards"
      />
      <AdminError error={vineyardsQ.error ?? paddocksQ.error} />

      {v && (
        <div className="space-y-4">
          <Card className="p-2">
            <AdminVineyardMap paddocks={paddocksQ.data ?? []} />
          </Card>
          <Card className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Owner</div>{v.owner_full_name ?? v.owner_email ?? "—"}</div>
              <div><div className="text-xs text-muted-foreground">Country</div>{v.country ?? "—"}</div>
              <div><div className="text-xs text-muted-foreground">Members</div>{v.member_count}</div>
              <div><div className="text-xs text-muted-foreground">Pending invites</div>{v.pending_invites}</div>
              <div><div className="text-xs text-muted-foreground">Blocks</div>{stats.blockCount}</div>
              <div><div className="text-xs text-muted-foreground">Total area</div>{formatHa(stats.totalAreaHa)}</div>
              <div><div className="text-xs text-muted-foreground">Rows</div>{stats.rowCount || "—"}</div>
              <div><div className="text-xs text-muted-foreground">Varieties</div>{stats.varieties.length || "—"}</div>
              <div><div className="text-xs text-muted-foreground">Created</div>{formatDate(v.created_at)}</div>
              <div><div className="text-xs text-muted-foreground">Status</div>{v.deleted_at ? <ArchivedBadge /> : "Active"}</div>
            </div>
            {stats.varieties.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {stats.varieties.map((name) => (
                  <Badge key={name} variant="secondary" className="text-[10px]">{name}</Badge>
                ))}
              </div>
            )}
            <div className="text-xs text-muted-foreground font-mono break-all mt-2">{v.id}</div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Members</h2>
            {membersQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {membersQ.error && (
              <div className="text-sm text-muted-foreground">
                Member list unavailable — the backend update for admin member access (SQL 240)
                may not be applied yet.
              </div>
            )}
            {!membersQ.isLoading && !membersQ.error && (membersQ.data ?? []).length === 0 && (
              <AdminEmpty>No members.</AdminEmpty>
            )}
            <div className="divide-y">
              {(membersQ.data ?? []).map((m) => (
                <Link
                  key={m.membership_id}
                  to={`/admin/vineyards/${v.id}/members/${m.membership_id}`}
                  className="flex items-center gap-3 py-2 px-2 hover:bg-accent/40 rounded"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {m.display_name?.trim() || m.full_name?.trim() || m.email?.trim() || "Member"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{m.email ?? "—"}</div>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{m.role}</Badge>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Blocks</h2>
            {paddocksQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {!paddocksQ.isLoading && (paddocksQ.data ?? []).length === 0 && <AdminEmpty>No paddocks.</AdminEmpty>}
            <div className="divide-y">
              {(paddocksQ.data ?? []).map((p) => (
                <Link
                  key={p.id}
                  to={`/admin/vineyards/${v.id}/paddocks/${p.id}`}
                  className="flex items-center gap-3 py-2 px-2 hover:bg-accent/40 rounded"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {p.name} {p.deleted_at && <ArchivedBadge />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.row_count ?? 0} rows · {p.row_direction ?? "—"}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{formatDate(p.created_at)}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}
    </AdminGate>
  );
}
