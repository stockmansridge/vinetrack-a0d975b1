import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { MapContainer, TileLayer, Polygon, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminVineyards, useAdminVineyardPaddocks, type AdminPaddock } from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, ArchivedBadge, formatDate } from "./_shared";
import MapSourceBadge from "@/components/MapSourceBadge";

function FitToPolys({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try {
      const lb = L.latLngBounds(bounds as L.LatLngBoundsLiteral).pad(0.2);
      map.fitBounds(lb, { padding: [16, 16] });
    } catch { /* noop */ }
  }, [bounds, map]);
  return null;
}

function PolygonsPreview({ paddocks, height = 420 }: { paddocks: AdminPaddock[]; height?: number }) {
  const polys = paddocks
    .filter((p) => !p.deleted_at && (p.polygon_points?.length ?? 0) >= 3)
    .map((p) => p.polygon_points!.map((pt) => [pt.latitude, pt.longitude] as [number, number]));
  if (polys.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground border rounded h-40">
        No polygons available
      </div>
    );
  }
  const all = polys.flat();
  const bounds: L.LatLngBoundsExpression = all as any;
  const center: [number, number] = [all[0][0], all[0][1]];
  return (
    <div className="relative rounded border overflow-hidden" style={{ height }}>
      <MapContainer
        center={center}
        zoom={15}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://www.esri.com/">Esri</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
        {polys.map((pts, i) => (
          <Polygon
            key={i}
            positions={pts}
            pathOptions={{ color: "#A3E635", weight: 2, fillColor: "#A3E635", fillOpacity: 0.35 }}
          />
        ))}
        <FitToPolys bounds={bounds} />
      </MapContainer>
      <MapSourceBadge source="fallback" />
    </div>
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
              <div><div className="text-xs text-muted-foreground">Blocks</div>{(paddocksQ.data ?? []).filter((p) => !p.deleted_at).length}</div>
              <div><div className="text-xs text-muted-foreground">Created</div>{formatDate(v.created_at)}</div>
              <div><div className="text-xs text-muted-foreground">Status</div>{v.deleted_at ? <ArchivedBadge /> : "Active"}</div>
            </div>
            <div className="text-xs text-muted-foreground font-mono break-all mt-2">{v.id}</div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Blocks</h2>
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
