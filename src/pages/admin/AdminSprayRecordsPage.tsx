import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminSprayRecords } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, formatDate } from "./_shared";

export default function AdminSprayRecordsPage() {
  const { data = [], isLoading, error } = useAdminSprayRecords(500);
  const sorted = [...data].sort(
    (a, b) => new Date(b.date ?? b.created_at ?? 0).getTime() - new Date(a.date ?? a.created_at ?? 0).getTime(),
  );
  return (
    <AdminGate>
      <AdminPageHeader title="Spray Records" subtitle={`${data.length} (most recent 500)`} />
      <Card className="p-4">
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && data.length === 0 && <AdminEmpty>No spray records.</AdminEmpty>}
        <div className="divide-y">
          {sorted.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2 px-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.spray_reference ?? "(no ref)"}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.vineyard_name ?? "—"} · {r.operation_type ?? "—"}
                </div>
              </div>
              <Badge variant="outline" className="text-xs">{formatDate(r.date ?? r.created_at)}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
