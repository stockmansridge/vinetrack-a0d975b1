// Overlay Health — compact system-admin diagnostic that reads exclusively
// from the unified Crop Health view model. Do not show these metrics in the
// normal customer map view.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CropHealthViewModel } from "@/lib/cropHealthViewModel";
import { reasonToCustomerMessage } from "@/lib/cropHealthCopy";
import type { SatelliteIndexType } from "@/types/satellite";

interface Props {
  viewModel: CropHealthViewModel;
  selectedLayer: SatelliteIndexType;
}

function short(id: string | null | undefined, len = 8): string {
  if (!id) return "—";
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

export default function OverlayHealthPanel({ viewModel, selectedLayer }: Props) {
  const [open, setOpen] = useState(false);
  const s = viewModel.summary;

  const imageFailures = viewModel.paddocks.filter(
    (p) => p.displayStatus === "failed" && p.availabilityReason === "asset_load_failed",
  ).length;
  const mountFailures = viewModel.paddocks.filter(
    (p) => p.availabilityReason === "overlay_mount_failed",
  ).length;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Overlay Health</span>
          <Badge variant={s.overlaysMounted === s.activePaddocks ? "default" : "destructive"}>
            {s.overlaysMounted} of {s.activePaddocks} overlays mounted
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <div>Scenes: <span className="text-foreground">{s.scenesAvailable}</span></div>
          <div>{selectedLayer} assets: <span className="text-foreground">{s.layerAssetsAvailable}</span></div>
          <div>Loaded: <span className="text-foreground">{s.assetsLoaded}</span></div>
          <div>Mounted: <span className="text-foreground">{s.overlaysMounted}</span></div>
          <div>Cell readings ready: <span className="text-foreground">{s.analyticalReady}</span></div>
          {imageFailures > 0 && (
            <div>Image failures: <span className="text-destructive">{imageFailures}</span></div>
          )}
          {mountFailures > 0 && (
            <div>Mount failures: <span className="text-destructive">{mountFailures}</span></div>
          )}
          {s.analyticalFailed > 0 && (
            <div>Analytical failures: <span className="text-destructive">{s.analyticalFailed}</span></div>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1 text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
          Per-paddock detail
        </Button>

        {open && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-2">Paddock</th>
                  <th className="py-1 pr-2">Scene</th>
                  <th className="py-1 pr-2">Display asset</th>
                  <th className="py-1 pr-2">Load</th>
                  <th className="py-1 pr-2">Mount</th>
                  <th className="py-1 pr-2">Analytical</th>
                  <th className="py-1 pr-2">Availability</th>
                  <th className="py-1 pr-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {viewModel.paddocks.map((p) => (
                  <tr key={p.paddockId} className="border-t border-border/50">
                    <td className="py-1 pr-2 text-foreground">{p.paddockName}</td>
                    <td className="py-1 pr-2 font-mono">{short(p.sceneId)}</td>
                    <td className="py-1 pr-2 font-mono">{short(p.displayAssetId)}</td>
                    <td className="py-1 pr-2">{p.displayStatus}</td>
                    <td className="py-1 pr-2">{p.displayMounted ? "mounted" : "—"}</td>
                    <td className="py-1 pr-2">{p.analyticalStatus}</td>
                    <td className="py-1 pr-2">{reasonToCustomerMessage(p.availabilityReason, p.selectedLayer)}</td>
                    <td className="py-1 pr-2 text-destructive">{p.errorMessage ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
