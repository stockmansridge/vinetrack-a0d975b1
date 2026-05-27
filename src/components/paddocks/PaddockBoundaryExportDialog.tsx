import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Download, MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import {
  buildBoundariesGeoJson,
  buildBoundariesKml,
  downloadTextFile,
  summarizeBoundaries,
  type BoundaryPaddockExportRow,
} from "@/lib/paddockBoundaryExport";
import { toast } from "sonner";

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function safeBase(s: string) {
  return s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Vineyard";
}

export default function PaddockBoundaryExportDialog() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? "Vineyard";

  const [open, setOpen] = useState(false);

  const { data: paddocks = [], isLoading } = useQuery<BoundaryPaddockExportRow[]>({
    queryKey: ["paddocks-boundary-export", selectedVineyardId],
    enabled: !!selectedVineyardId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select(
          "id, vineyard_id, name, polygon_points, row_direction, row_width, vine_spacing, variety_allocations",
        )
        .eq("vineyard_id", selectedVineyardId!)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as BoundaryPaddockExportRow[];
    },
  });

  const stats = useMemo(() => summarizeBoundaries(paddocks), [paddocks]);

  const doExport = (format: "geojson" | "kml") => {
    if (stats.withPolygon === 0) {
      toast.info("No block boundaries to export.");
      return;
    }
    const meta = { vineyardId: selectedVineyardId, vineyardName };
    const base = `Boundaries_${safeBase(vineyardName)}_${todayStr()}`;
    if (format === "geojson") {
      downloadTextFile(`${base}.geojson`, buildBoundariesGeoJson(paddocks, meta), "application/geo+json");
    } else {
      downloadTextFile(`${base}.kml`, buildBoundariesKml(paddocks, meta), "application/vnd.google-earth.kml+xml");
    }
    toast.success(`Exported ${stats.withPolygon} boundary${stats.withPolygon === 1 ? "" : "s"}.`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Download className="h-4 w-4" /> Export boundaries
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export block boundaries</DialogTitle>
          <DialogDescription>
            Download current block polygons for <b>{vineyardName}</b> as GeoJSON
            or KML. The GeoJSON file can be re-imported with{" "}
            <b>Import boundaries</b> to restore polygons.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Total blocks" value={stats.total} />
          <Stat label="With boundary" value={stats.withPolygon} />
          <Stat label="No boundary" value={stats.withoutPolygon} warn={stats.withoutPolygon > 0} />
        </div>

        {stats.withoutPolygon > 0 && (
          <Alert>
            <AlertTitle className="text-sm">
              {stats.withoutPolygon} block{stats.withoutPolygon === 1 ? "" : "s"} have no polygon
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              {stats.missing.slice(0, 20).join(", ")}
              {stats.missing.length > 20 ? `, +${stats.missing.length - 20} more` : ""}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4 text-left"
            onClick={() => doExport("geojson")}
            disabled={isLoading || stats.withPolygon === 0}
          >
            <MapPin className="h-4 w-4" />
            <span className="font-medium">Download GeoJSON</span>
            <span className="text-xs text-muted-foreground">
              Round-trip compatible with Import boundaries
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4 text-left"
            onClick={() => doExport("kml")}
            disabled={isLoading || stats.withPolygon === 0}
          >
            <MapPin className="h-4 w-4" />
            <span className="font-medium">Download KML</span>
            <span className="text-xs text-muted-foreground">
              Opens in Google Earth, QGIS, MapKit
            </span>
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded border p-2 text-center ${warn ? "border-warning/60 bg-warning/10" : ""}`}>
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
