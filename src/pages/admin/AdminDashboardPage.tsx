import { Link, Navigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useAuth } from "@/context/AuthContext";
import {
  useEngagementSummary,
  useAdminUsers,
  useAdminVineyards,
} from "@/lib/adminApi";
import { iosSupabase } from "@/integrations/ios-supabase/client";

const SHARED_PROJECT_REF = "tbafuqwruefgkbyxrxyb";

function formatRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string | null, email: string) {
  const src = (name ?? email ?? "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

interface TileProps {
  to: string;
  label: string;
  value: number | string;
  hint?: string;
}
function Tile({ to, label, value, hint }: TileProps) {
  return (
    <Link to={to}>
      <Card className="p-4 hover:bg-accent/40 transition-colors h-full">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </Card>
    </Link>
  );
}

function useBlocksTotal(vineyardIds: string[]) {
  const queries = useQueries({
    queries: vineyardIds.map((id) => ({
      queryKey: ["admin", "paddocks-count", id],
      staleTime: 60_000,
      queryFn: async () => {
        const { data, error } = await (iosSupabase as any).rpc(
          "admin_list_vineyard_paddocks",
          { p_vineyard_id: id },
        );
        if (error) return 0;
        return ((data ?? []) as Array<{ deleted_at: string | null }>).filter(
          (p) => !p.deleted_at,
        ).length;
      },
    })),
  });
  const loading = queries.some((q) => q.isLoading);
  const total = queries.reduce((s, q) => s + ((q.data as number) ?? 0), 0);
  return { total, loading };
}

export default function AdminDashboardPage() {
  const { isAdmin, loading } = useIsSystemAdmin();
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const summary = useEngagementSummary();
  const usersQ = useAdminUsers();
  const vineyardsQ = useAdminVineyards();

  const activeVineyardIds = useMemo(
    () => (vineyardsQ.data ?? []).filter((v) => !v.deleted_at).map((v) => v.id),
    [vineyardsQ.data],
  );
  const blocks = useBlocksTotal(activeVineyardIds);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = usersQ.data ?? [];
    if (!q) return list;
    return list.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q),
    );
  }, [usersQ.data, search]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const s = summary.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Platform-level tools shared with the iOS app.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">System admin access confirmed</div>
            <div className="text-xs text-muted-foreground">
              Signed in as <span className="font-mono">{user?.email}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Shared backend project: <span className="font-mono">{SHARED_PROJECT_REF}</span>
            </div>
          </div>
        </div>
      </Card>

      {summary.error && (
        <Card className="p-3 flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <span>Could not load engagement summary: {(summary.error as Error).message}</span>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile to="/admin/users" label="Total Users" value={s?.total_users ?? "—"} />
        <Tile to="/admin/vineyards" label="Vineyards" value={s?.total_vineyards ?? "—"} />
        <Tile to="/admin/blocks" label="Blocks" value={blocks.loading ? "…" : blocks.total} />
        <Tile
          to="/admin/users?filter=active7"
          label="Active 7d"
          value={s?.signed_in_last_7_days ?? "—"}
        />
        <Tile
          to="/admin/users?filter=active30"
          label="Active 30d"
          value={s?.signed_in_last_30_days ?? "—"}
        />
        <Tile
          to="/admin/users?filter=new30"
          label="New 30d"
          value={s?.new_users_last_30_days ?? "—"}
        />
        <Tile
          to="/admin/invitations"
          label="Pending Invites"
          value={s?.pending_invitations ?? "—"}
        />
        <Tile to="/admin/pins" label="Pins" value={s?.total_pins ?? "—"} />
        <Tile to="/admin/spray-records" label="Spray Records" value={s?.total_spray_records ?? "—"} />
        <Tile to="/admin/work-tasks" label="Work Tasks" value={s?.total_work_tasks ?? "—"} />
      </div>
      <p className="text-xs text-muted-foreground">
        Tap any tile to see the underlying records. Active = signed in within the period.
      </p>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="font-semibold">Users</h2>
          <Input
            placeholder="Search email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {usersQ.isLoading && <div className="text-sm text-muted-foreground">Loading users…</div>}
        {usersQ.error && (
          <div className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            {(usersQ.error as Error).message}
          </div>
        )}
        <div className="divide-y">
          {filteredUsers.slice(0, 50).map((u) => (
            <Link
              key={u.id}
              to={`/admin/users/${u.id}`}
              className="flex items-center gap-3 py-2 hover:bg-accent/40 px-2 rounded"
            >
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                {initials(u.full_name, u.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{u.full_name ?? u.email}</div>
                <div className="text-xs text-muted-foreground truncate">{u.email}</div>
              </div>
              <div className="text-xs text-muted-foreground hidden sm:block">
                {u.vineyard_count} vineyards · {u.block_count ?? 0} blocks
              </div>
              <Badge variant="outline" className="text-xs">
                {formatRelative(u.last_sign_in_at)}
              </Badge>
            </Link>
          ))}
          {!usersQ.isLoading && filteredUsers.length === 0 && (
            <div className="text-sm text-muted-foreground py-4">No users match.</div>
          )}
        </div>
        {filteredUsers.length > 50 && (
          <div className="text-xs text-muted-foreground mt-2">
            Showing first 50 of {filteredUsers.length}.{" "}
            <Link to="/admin/users" className="text-primary">View all →</Link>
          </div>
        )}
      </Card>
    </div>
  );
}
