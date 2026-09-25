import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import elStages from "@/assets/E-L_Stages.png.asset.json";

export function ELStagesButton() {
  const [full, setFull] = useState(false);
  return (
    <Dialog onOpenChange={(o) => !o && setFull(false)}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full px-2.5 text-xs font-semibold" aria-label="Open E-L growth stages chart">
          E-L Stages
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[95vh] max-w-[95vw] flex-col">
        <DialogHeader>
          <DialogTitle>E-L Growth Stages</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {full ? "Click the chart to fit it to the window." : "Click the chart to view it at full size."}
          </p>
        </DialogHeader>
        <div className={cn("min-h-0 flex-1", full ? "overflow-auto" : "flex items-center justify-center overflow-hidden")}>
          <img
            src={elStages.url}
            alt="Modified Eichhorn-Lorenz (E-L) grapevine growth stages chart"
            onClick={() => setFull((f) => !f)}
            className={cn(
              full ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full object-contain cursor-zoom-in",
            )}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
