import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { useAdminVineyardPaddocks, type AdminPaddock } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, ArchivedBadge, formatDate } from "./_shared";

function SinglePolygon({ paddock }: { paddock: AdminPaddock }) {
  const pts = paddock.polygon_points ?? [];
  if (pts.length < 3) {
    return <div className="text-xs text-muted-foreground border rounded p-4">No polygon</div>;
  }
  const lats = pts.map((p) => p.latitude);
  const lngs = pts.map((p) => p.longitude);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padX = (maxLng - minLng) * 0.05 || 0.0001;
  const padY = (maxLat - minLat) * 0.05 || 0.0001;
  minLat -= padY; maxLat += padY; minLng -= padX; maxLng += padX;
  const W = 800, H = 360;
  const project = (lat: number, lng: number) =>
    `${(((lng - minLng) / (maxLng - minLng)) * W).toFixed(1)},${(H - ((lat - minLat) / (maxLat - minLat)) * H).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-muted/30 rounded border">
      <polygon
        points={pts.map((p) => project(p.latitude, p.longitude)).join(" ")}
        fill="hsl(var(--primary) / 0.25)"
        stroke="hsl(var(--primary))"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export default function AdminPaddockDetailPage() {
  const { id, pid } = useParams<{ id: string; pid: string }>();
  const { data = [], isLoading, error } = useAdminVineyardPaddocks(id);
  const p = data.find((x) => x.id === pid);

  return (
    <AdminGate>
      <AdminPageHeader title={p?.name ?? "Paddock"} back={`/admin/vineyards/${id}`} />
      <AdminError error={error} />
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {p && (
        <div className="space-y-4">
          <Card className="p-2"><SinglePolygon paddock={p} /></Card>
          <Card className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Rows</div>{p.row_count ?? 0}</div>
              <div><div className="text-xs text-muted-foreground">Row direction</div>{p.row_direction ?? "—"}</div>
              <div><div className="text-xs text-muted-foreground">Row width</div>{p.row_width ?? "—"}</div>
              <div><div className="text-xs text-muted-foreground">Vine spacing</div>{p.vine_spacing ?? "—"}</div>
              <div><div className="text-xs text-muted-foreground">Created</div>{formatDate(p.created_at)}</div>
              <div><div className="text-xs text-muted-foreground">Updated</div>{formatDate(p.updated_at)}</div>
              <div><div className="text-xs text-muted-foreground">Status</div>{p.deleted_at ? <ArchivedBadge /> : "Active"}</div>
            </div>
            <div className="text-xs text-muted-foreground font-mono break-all mt-2">{p.id}</div>
          </Card>
        </div>
      )}
    </AdminGate>
  );
}
