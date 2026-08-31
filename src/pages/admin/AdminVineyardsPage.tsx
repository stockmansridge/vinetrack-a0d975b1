import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useAdminVineyards,
  useAdminPins,
  useAdminSprayRecords,
  useAdminWorkTasks,
  useAdminTrips,
} from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate } from "./_shared";

interface VineyardActivityCounts {
  pins: number;
  sprayRecords: number;
  workTasks: number;
  trips: number;
}

function countByVineyard<T extends { vineyard_id: string | null }>(
  rows: T[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!row.vineyard_id) continue;
    map.set(row.vineyard_id, (map.get(row.vineyard_id) ?? 0) + 1);
  }
  return map;
}

function ActivityMetric({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  if (count === 0) return null;
  const suffix = `${label}${count === 1 ? "" : "s"}`;
  return (
    <span className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{count}</span>{" "}
      {suffix}
    </span>
  );
}

function ActivityMetrics({ counts }: { counts: VineyardActivityCounts }) {
  const items = [
    { key: "trips", label: "trip", count: counts.trips },
    { key: "pins", label: "pin", count: counts.pins },
    { key: "spray", label: "spray", count: counts.sprayRecords },
    { key: "tasks", label: "task", count: counts.workTasks },
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
  const pinsQ = useAdminPins();
  const sprayQ = useAdminSprayRecords();
  const workTasksQ = useAdminWorkTasks();
  const tripsQ = useAdminTrips();

  const countsByVineyard = useMemo(() => {
    const pins = countByVineyard(pinsQ.data);
    const spray = countByVineyard(sprayQ.data);
    const workTasks = countByVineyard(workTasksQ.data);
    const trips = countByVineyard(tripsQ.data);
    const map = new Map<string, VineyardActivityCounts>();
    for (const v of data) {
      map.set(v.id, {
        pins: pins.get(v.id) ?? 0,
        sprayRecords: spray.get(v.id) ?? 0,
        workTasks: workTasks.get(v.id) ?? 0,
        trips: trips.get(v.id) ?? 0,
      });
    }
    return map;
  }, [data, pinsQ.data, sprayQ.data, workTasksQ.data, tripsQ.data]);

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

  const anyLoading = isLoading || pinsQ.isLoading || sprayQ.isLoading || workTasksQ.isLoading || tripsQ.isLoading;
  const anyError = error ?? pinsQ.error ?? sprayQ.error ?? workTasksQ.error ?? tripsQ.error;

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
        <AdminError error={anyError} />
        {anyLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!anyLoading && filtered.length === 0 && <AdminEmpty>No vineyards.</AdminEmpty>}
        <div className="divide-y">
          {filtered.map((v) => {
            const c = countsByVineyard.get(v.id);
            return (
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
                  <ActivityMetrics counts={c ?? { pins: 0, sprayRecords: 0, workTasks: 0, trips: 0 }} />
                </div>
                <div className="flex items-center gap-2 sm:justify-end min-w-[8rem]">
                  <div className="text-xs text-muted-foreground hidden sm:block">
                    {v.member_count} members · {v.pending_invites} pending
                  </div>
                  <Badge variant="outline" className="text-xs">{formatDate(v.created_at)}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </AdminGate>
  );
}
