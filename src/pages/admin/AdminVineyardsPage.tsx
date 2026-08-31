import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useAdminVineyards,
  useAdminVineyardActivityCounts,
  type AdminVineyardActivityCounts,
} from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate } from "./_shared";

function ActivityMetric({ label, count }: { label: string; count: number }) {
  if (count === 0) return null;
  const suffix = `${label}${count === 1 ? "" : "s"}`;
  return (
    <span className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{count}</span> {suffix}
    </span>
  );
}

/**
 * `counts === undefined` means the authoritative aggregate is unavailable
 * (still loading or the query failed) — that is NOT the same as "no activity".
 */
function ActivityMetrics({
  counts,
  state,
}: {
  counts: AdminVineyardActivityCounts | undefined;
  state: "loading" | "error" | "ready";
}) {
  if (state === "loading") {
    return <span className="text-xs text-muted-foreground italic">Loading activity…</span>;
  }
  if (state === "error" || !counts) {
    return <span className="text-xs text-muted-foreground italic">Activity unavailable</span>;
  }

  const items = [
    { key: "trips", label: "trip", count: counts.trip_count },
    { key: "pins", label: "pin", count: counts.pin_count },
    { key: "spray", label: "spray", count: counts.spray_record_count },
    { key: "tasks", label: "task", count: counts.work_task_count },
  ].filter((i) => i.count > 0);

  if (items.length === 0) {
    return <span className="text-xs text-muted-foreground italic">No activity</span>;
  }

  return (
    <>
      {items.map((item, index) => (
        <span key={item.key} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-muted-foreground/50">·</span>}
          <ActivityMetric label={item.label} count={item.count} />
        </span>
      ))}
    </>
  );
}

export default function AdminVineyardsPage() {
  const [search, setSearch] = useState("");
  const { data = [], isLoading, error } = useAdminVineyards();
  const activityQ = useAdminVineyardActivityCounts();

  const activityState: "loading" | "error" | "ready" = activityQ.error
    ? "error"
    : activityQ.isLoading
      ? "loading"
      : "ready";

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
        {/* Only a vineyard-list failure is a page-level error; the secondary
            activity aggregate degrades to "Activity unavailable" instead. */}
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && filtered.length === 0 && <AdminEmpty>No vineyards.</AdminEmpty>}
        <div className="divide-y">
          {filtered.map((v) => (
            <Link
              key={v.id}
              to={`/admin/vineyards/${v.id}`}
              className="flex flex-col sm:flex-row sm:items-center gap-2 py-2 px-2 hover:bg-accent/40 rounded"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {v.name} {v.deleted_at && <ArchivedBadge />}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {v.owner_full_name ?? v.owner_email ?? "—"} · {v.country ?? "—"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <ActivityMetrics counts={activityQ.data?.get(v.id)} state={activityState} />
              </div>
              <div className="flex items-center gap-2 sm:justify-end min-w-[8rem]">
                <div className="text-xs text-muted-foreground hidden sm:block">
                  {v.member_count} members · {v.pending_invites} pending
                </div>
                <Badge variant="outline" className="text-xs">{formatDate(v.created_at)}</Badge>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
