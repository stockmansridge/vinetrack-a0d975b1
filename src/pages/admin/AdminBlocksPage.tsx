import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAdminVineyards, type AdminPaddock } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate } from "./_shared";

export default function AdminBlocksPage() {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const vineyardsQ = useAdminVineyards();
  const vineyards = vineyardsQ.data ?? [];

  const queries = useQueries({
    queries: vineyards.map((v) => ({
      queryKey: ["admin", "paddocks", v.id],
      enabled: !!v.id,
      staleTime: 30_000,
      queryFn: async () => {
        const { data, error } = await (iosSupabase as any).rpc("admin_list_vineyard_paddocks", {
          p_vineyard_id: v.id,
        });
        if (error) throw error;
        return (data ?? []) as AdminPaddock[];
      },
    })),
  });

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vineyards
      .map((v, i) => {
        const all = (queries[i]?.data ?? []) as AdminPaddock[];
        const filteredByArchive = showArchived ? all : all.filter((p) => !p.deleted_at);
        const filtered = !q
          ? filteredByArchive
          : filteredByArchive.filter(
              (p) =>
                p.name.toLowerCase().includes(q) || v.name.toLowerCase().includes(q),
            );
        return { vineyard: v, paddocks: filtered };
      })
      .filter((g) => g.paddocks.length > 0);
  }, [vineyards, queries, search, showArchived]);

  const total = groups.reduce((s, g) => s + g.paddocks.length, 0);
  const loading = vineyardsQ.isLoading || queries.some((q) => q.isLoading);

  return (
    <AdminGate>
      <AdminPageHeader title="All Blocks" subtitle={`${total} blocks across ${groups.length} vineyards`} />
      <AdminError error={vineyardsQ.error} />
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Input
            placeholder="Search block or vineyard…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex items-center gap-2">
            <Switch id="archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="archived" className="text-sm">Show archived</Label>
          </div>
        </div>
        {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!loading && groups.length === 0 && <AdminEmpty>No blocks.</AdminEmpty>}
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.vineyard.id}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                <Link to={`/admin/vineyards/${g.vineyard.id}`} className="hover:underline">
                  {g.vineyard.name}
                </Link>
              </div>
              <div className="divide-y border rounded">
                {g.paddocks.map((p) => (
                  <Link
                    key={p.id}
                    to={`/admin/vineyards/${g.vineyard.id}/paddocks/${p.id}`}
                    className="flex items-center gap-3 py-2 px-3 hover:bg-accent/40"
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
            </div>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
