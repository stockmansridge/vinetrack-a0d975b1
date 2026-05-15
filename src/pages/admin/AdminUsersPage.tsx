import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAdminUsers } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, formatRelative } from "./_shared";

export default function AdminUsersPage() {
  const [params] = useSearchParams();
  const filter = params.get("filter"); // active7 | active30 | new30
  const [search, setSearch] = useState("");
  const { data = [], isLoading, error } = useAdminUsers();

  const filtered = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let list = data;
    if (filter === "active7") {
      list = list.filter((u) => u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() <= 7 * day);
    } else if (filter === "active30") {
      list = list.filter((u) => u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() <= 30 * day);
    } else if (filter === "new30") {
      list = list.filter((u) => u.created_at && now - new Date(u.created_at).getTime() <= 30 * day);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) => u.email?.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [data, filter, search]);

  const titleSuffix =
    filter === "active7" ? " · Active 7d"
    : filter === "active30" ? " · Active 30d"
    : filter === "new30" ? " · New 30d"
    : "";

  return (
    <AdminGate>
      <AdminPageHeader title={`Users${titleSuffix}`} subtitle={`${filtered.length} of ${data.length}`} />
      <Card className="p-4">
        <Input
          placeholder="Search email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs mb-3"
        />
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && filtered.length === 0 && <AdminEmpty>No users.</AdminEmpty>}
        <div className="divide-y">
          {filtered.map((u) => (
            <Link
              key={u.id}
              to={`/admin/users/${u.id}`}
              className="flex items-center gap-3 py-2 px-2 hover:bg-accent/40 rounded"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{u.full_name ?? u.email}</div>
                <div className="text-xs text-muted-foreground truncate">{u.email}</div>
              </div>
              <div className="text-xs text-muted-foreground hidden sm:block">
                {u.vineyard_count} vineyards · {u.owned_count} owned · {u.block_count ?? 0} blocks
              </div>
              <Badge variant="outline" className="text-xs">{formatRelative(u.last_sign_in_at)}</Badge>
            </Link>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
