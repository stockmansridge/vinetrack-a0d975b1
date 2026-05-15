import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAdminVineyards } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate } from "./_shared";

export default function AdminVineyardsPage() {
  const [search, setSearch] = useState("");
  const { data = [], isLoading, error } = useAdminVineyards();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.owner_email ?? "").toLowerCase().includes(q) ||
        (v.owner_full_name ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <AdminGate>
      <AdminPageHeader title="Vineyards" subtitle={`${filtered.length} of ${data.length}`} />
      <Card className="p-4">
        <Input
          placeholder="Search name or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs mb-3"
        />
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && filtered.length === 0 && <AdminEmpty>No vineyards.</AdminEmpty>}
        <div className="divide-y">
          {filtered.map((v) => (
            <Link key={v.id} to={`/admin/vineyards/${v.id}`}
              className="flex items-center gap-3 py-2 px-2 hover:bg-accent/40 rounded">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {v.name} {v.deleted_at && <ArchivedBadge />}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {v.owner_full_name ?? v.owner_email ?? "—"} · {v.country ?? "—"}
                </div>
              </div>
              <div className="text-xs text-muted-foreground hidden sm:block">
                {v.member_count} members · {v.pending_invites} pending
              </div>
              <Badge variant="outline" className="text-xs">{formatDate(v.created_at)}</Badge>
            </Link>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
