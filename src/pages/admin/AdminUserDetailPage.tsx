import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Mail, CreditCard } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useAdminUsers,
  useAdminUserVineyards,
  useAdminVineyardPaddocks,
  type AdminUserVineyard,
} from "@/lib/adminApi";
import { computeAdminVineyardStats, formatHa } from "@/lib/adminVineyardStats";
import { CreateGrantDialog } from "@/components/admin/access/accessDialogs";
import {
  AdminGate,
  AdminPageHeader,
  AdminError,
  AdminEmpty,
  ArchivedBadge,
  formatDate,
  formatRelative,
} from "./_shared";

const SUPPORT_EMAIL = "support@vinetrack.com.au";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

/** One vineyard card with derived stats (area, blocks, rows, varieties). */
function VineyardStatsCard({
  vineyard,
  onAddGrant,
}: {
  vineyard: AdminUserVineyard;
  onAddGrant: (v: AdminUserVineyard) => void;
}) {
  const paddocksQ = useAdminVineyardPaddocks(vineyard.id);
  const stats = computeAdminVineyardStats(paddocksQ.data);

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/admin/vineyards/${vineyard.id}`}
            className="text-sm font-medium hover:underline flex items-center gap-2"
          >
            {vineyard.name} {vineyard.deleted_at && <ArchivedBadge />}
          </Link>
          <div className="text-xs text-muted-foreground">
            {vineyard.is_owner ? "Owner" : (vineyard.role ?? "member")} ·{" "}
            {vineyard.member_count} members · {vineyard.country ?? "—"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {formatDate(vineyard.created_at)}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => onAddGrant(vineyard)}>
            <CreditCard className="h-4 w-4 mr-1" /> Add billing grant
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Total area"
          value={paddocksQ.isLoading ? "…" : formatHa(stats.totalAreaHa)}
        />
        <Stat label="Blocks" value={paddocksQ.isLoading ? "…" : stats.blockCount} />
        <Stat label="Rows" value={paddocksQ.isLoading ? "…" : stats.rowCount || "—"} />
        <Stat
          label="Varieties"
          value={paddocksQ.isLoading ? "…" : stats.varieties.length || "—"}
        />
      </div>

      {stats.varieties.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {stats.varieties.map((v) => (
            <Badge key={v} variant="secondary" className="text-[10px]">
              {v}
            </Badge>
          ))}
        </div>
      )}
      {stats.archivedBlockCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {stats.archivedBlockCount} archived block
          {stats.archivedBlockCount === 1 ? "" : "s"} not counted.
        </div>
      )}
    </div>
  );
}

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const usersQ = useAdminUsers();
  const vineyardsQ = useAdminUserVineyards(id);
  const user = usersQ.data?.find((u) => u.id === id);
  const vineyards = vineyardsQ.data ?? [];

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantVineyard, setGrantVineyard] = useState<AdminUserVineyard | null>(null);

  const copy = async (val: string, what: string) => {
    try {
      await navigator.clipboard.writeText(val);
      toast({ title: `${what} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const openGrant = (v: AdminUserVineyard | null) => {
    setGrantVineyard(v);
    setGrantOpen(true);
  };

  const grantVineyards = grantVineyard
    ? [{ id: grantVineyard.id, name: grantVineyard.name }]
    : vineyards.map((v) => ({ id: v.id, name: v.name }));

  return (
    <AdminGate>
      <AdminPageHeader
        title={user?.full_name ?? user?.email ?? "User"}
        subtitle={user?.email}
        back="/admin/users"
        actions={
          user ? (
            <Button onClick={() => openGrant(null)}>
              <CreditCard className="h-4 w-4 mr-1" /> Add billing grant
            </Button>
          ) : undefined
        }
      />

      <AdminError error={usersQ.error ?? vineyardsQ.error} />
      {!user && usersQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {user && (
        <div className="space-y-4">
          <Card className="p-4 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Vineyards" value={user.vineyard_count} />
              <Stat label="Owned" value={user.owned_count} />
              <Stat label="Blocks" value={user.block_count ?? 0} />
              <Stat label="Joined" value={formatDate(user.created_at)} />
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
                <Link to="/admin/billing-grants">All billing grants</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Vineyards &amp; stats</h2>
            {vineyardsQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {!vineyardsQ.isLoading && vineyards.length === 0 && (
              <AdminEmpty>No vineyards.</AdminEmpty>
            )}
            <div className="space-y-3">
              {vineyards.map((v) => (
                <VineyardStatsCard key={v.id} vineyard={v} onAddGrant={openGrant} />
              ))}
            </div>
          </Card>
        </div>
      )}

      <CreateGrantDialog
        open={grantOpen}
        onOpenChange={(o) => {
          setGrantOpen(o);
          if (!o) setGrantVineyard(null);
        }}
        userId={user?.id ?? null}
        userLabel={user?.full_name || user?.email || (user?.id ?? "")}
        vineyards={grantVineyards}
      />
    </AdminGate>
  );
}
