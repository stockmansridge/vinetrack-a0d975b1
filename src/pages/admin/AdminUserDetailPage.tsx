import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Mail } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAdminUsers, useAdminUserVineyards } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate, formatRelative } from "./_shared";

const SUPPORT_EMAIL = "support@vinetrack.com.au";

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const usersQ = useAdminUsers();
  const vineyardsQ = useAdminUserVineyards(id);
  const user = usersQ.data?.find((u) => u.id === id);

  const copy = async (val: string, what: string) => {
    try {
      await navigator.clipboard.writeText(val);
      toast({ title: `${what} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <AdminGate>
      <AdminPageHeader
        title={user?.full_name ?? user?.email ?? "User"}
        subtitle={user?.email}
        back="/admin/users"
      />

      <AdminError error={usersQ.error ?? vineyardsQ.error} />
      {!user && usersQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {user && (
        <div className="space-y-4">
          <Card className="p-4 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Vineyards</div>{user.vineyard_count}</div>
              <div><div className="text-xs text-muted-foreground">Owned</div>{user.owned_count}</div>
              <div><div className="text-xs text-muted-foreground">Blocks</div>{user.block_count ?? 0}</div>
              <div><div className="text-xs text-muted-foreground">Joined</div>{formatDate(user.created_at)}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              Last sign-in: {formatRelative(user.last_sign_in_at)}
            </div>
            <div className="text-xs text-muted-foreground font-mono break-all">{user.id}</div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Support actions</h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`mailto:${user.email}?subject=VineTrack support`}>
                  <Mail className="h-4 w-4 mr-1" /> Email reply
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`mailto:${user.email}?subject=Welcome to VineTrack`}>
                  <Mail className="h-4 w-4 mr-1" /> Send welcome
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy(user.email, "Email")}>
                <Copy className="h-4 w-4 mr-1" /> Copy email
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy(user.id, "User ID")}>
                <Copy className="h-4 w-4 mr-1" /> Copy user ID
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Vineyards</h2>
            {vineyardsQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {!vineyardsQ.isLoading && (vineyardsQ.data ?? []).length === 0 && (
              <AdminEmpty>No vineyards.</AdminEmpty>
            )}
            <div className="divide-y">
              {(vineyardsQ.data ?? []).map((v) => (
                <Link
                  key={v.id}
                  to={`/admin/vineyards/${v.id}`}
                  className="flex items-center gap-3 py-2 px-2 hover:bg-accent/40 rounded"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {v.name} {v.deleted_at && <ArchivedBadge />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {v.is_owner ? "Owner" : v.role ?? "member"} · {v.member_count} members · {v.country ?? "—"}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{formatDate(v.created_at)}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}
    </AdminGate>
  );
}
