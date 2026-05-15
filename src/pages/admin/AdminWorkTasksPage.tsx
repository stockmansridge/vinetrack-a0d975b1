import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminWorkTasks } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, formatDate } from "./_shared";

export default function AdminWorkTasksPage() {
  const { data = [], isLoading, error } = useAdminWorkTasks(500);
  const sorted = [...data].sort(
    (a, b) => new Date(b.date ?? b.created_at ?? 0).getTime() - new Date(a.date ?? a.created_at ?? 0).getTime(),
  );
  return (
    <AdminGate>
      <AdminPageHeader title="Work Tasks" subtitle={`${data.length} (most recent 500)`} />
      <Card className="p-4">
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && data.length === 0 && <AdminEmpty>No work tasks.</AdminEmpty>}
        <div className="divide-y">
          {sorted.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2 px-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{t.task_type ?? "Task"}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.vineyard_name ?? "—"} · {t.paddock_name ?? "—"} · {t.duration_hours ?? 0}h
                </div>
              </div>
              <Badge variant="outline" className="text-xs">{formatDate(t.date ?? t.created_at)}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
