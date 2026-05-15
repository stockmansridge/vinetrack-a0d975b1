import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { useAdminPins } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, formatDate } from "./_shared";

export default function AdminPinsPage() {
  const { data = [], isLoading, error } = useAdminPins(500);
  return (
    <AdminGate>
      <AdminPageHeader title="Pins" subtitle={`${data.length} (most recent 500)`} />
      <Card className="p-4">
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && data.length === 0 && <AdminEmpty>No pins.</AdminEmpty>}
        <div className="divide-y">
          {data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2 px-2">
              {p.is_completed && <Check className="h-4 w-4 text-emerald-600" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{p.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {p.vineyard_name ?? "—"} · {p.category ?? "—"}
                </div>
              </div>
              <Badge variant="outline" className="text-xs">{formatDate(p.created_at)}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </AdminGate>
  );
}
