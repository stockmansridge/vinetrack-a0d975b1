import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminVineyards, useAdminVineyardPaddocks, type AdminPaddock } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate } from "./_shared";

function PolygonsPreview({ paddocks, height = 320 }: { paddocks: AdminPaddock[]; height?: number }) {
  const polys = paddocks
    .filter((p) => !p.deleted_at && (p.polygon_points?.length ?? 0) >= 3)
    .map((p) => p.polygon_points!);
  if (polys.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground border rounded h-40">
        No polygons available
      </div>
    );
  }
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  polys.forEach((pts) =>
    pts.forEach((pt) => {
      if (pt.latitude < minLat) minLat = pt.latitude;
      if (pt.latitude > maxLat) maxLat = pt.latitude;
      if (pt.longitude < minLng) minLng = pt.longitude;
      if (pt.longitude > maxLng) maxLng = pt.longitude;
    }),
  );
  const padX = (maxLng - minLng) * 0.05 || 0.0001;
  const padY = (maxLat - minLat) * 0.05 || 0.0001;
  minLat -= padY; maxLat += padY; minLng -= padX; maxLng += padX;
  const W = 800, H = height;
  const project = (lat: number, lng: number) => {
    const x = ((lng - minLng) / (maxLng - minLng)) * W;
    const y = H - ((lat - minLat) / (maxLat - minLat)) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-muted/30 rounded border">
      {polys.map((pts, i) => (
        <polygon
          key={i}
          points={pts.map((p) => project(p.latitude, p.longitude)).join(" ")}
          fill="hsl(var(--primary) / 0.25)"
          stroke="hsl(var(--primary))"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

export default function AdminVineyardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const vineyardsQ = useAdminVineyards();
  const paddocksQ = useAdminVineyardPaddocks(id);
  const v = vineyardsQ.data?.find((x) => x.id === id);

  return (
    <AdminGate>
      <AdminPageHeader
        title={v?.name ?? "Vineyard"}
        subtitle={v?.owner_email ?? undefined}
        back="/admin/vineyards"
      />
      <AdminError error={vineyardsQ.error ?? paddocksQ.error} />

      {v && (
        <div className="space-y-4">
          <Card className="p-2">
            <PolygonsPreview paddocks={paddocksQ.data ?? []} />
          </Card>
          <Card className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Owner</div>{v.owner_full_name ?? v.owner_email ?? "—"}</div>
              <div><div className="text-xs text-muted-foreground">Country</div>{v.country ?? "—"}</div>
              <div><div className="text-xs text-muted-foreground">Members</div>{v.member_count}</div>
              <div><div className="text-xs text-muted-foreground">Pending invites</div>{v.pending_invites}</div>
              <div><div className="text-xs text-muted-foreground">Paddocks</div>{(paddocksQ.data ?? []).filter((p) => !p.deleted_at).length}</div>
              <div><div className="text-xs text-muted-foreground">Created</div>{formatDate(v.created_at)}</div>
              <div><div className="text-xs text-muted-foreground">Status</div>{v.deleted_at ? <ArchivedBadge /> : "Active"}</div>
            </div>
            <div className="text-xs text-muted-foreground font-mono break-all mt-2">{v.id}</div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Paddocks</h2>
            {paddocksQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {!paddocksQ.isLoading && (paddocksQ.data ?? []).length === 0 && <AdminEmpty>No paddocks.</AdminEmpty>}
            <div className="divide-y">
              {(paddocksQ.data ?? []).map((p) => (
                <Link
                  key={p.id}
                  to={`/admin/vineyards/${v.id}/paddocks/${p.id}`}
                  className="flex items-center gap-3 py-2 px-2 hover:bg-accent/40 rounded"
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
          </Card>
        </div>
      )}
    </AdminGate>
  );
}
