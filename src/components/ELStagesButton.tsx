import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import elStages from "@/assets/E-L_Stages.png.asset.json";

export function ELStagesButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full px-2.5 text-xs font-semibold" aria-label="Open E-L growth stages chart">
          E-L Stages
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>E-L Growth Stages</DialogTitle>
        </DialogHeader>
        <img src={elStages.url} alt="Modified Eichhorn-Lorenz (E-L) grapevine growth stages chart" className="w-full h-auto" />
      </DialogContent>
    </Dialog>
  );
}
