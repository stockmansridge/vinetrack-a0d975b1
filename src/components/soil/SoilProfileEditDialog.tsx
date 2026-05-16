import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  type PaddockSoilProfile,
  useSoilClassDefaults,
  useUpsertPaddockSoilProfile,
  useDeletePaddockSoilProfile,
} from "@/lib/soilProfiles";

interface Props {
  paddockId: string;
  paddockName?: string | null;
  current: PaddockSoilProfile | null;
  trigger: React.ReactNode;
}

export default function SoilProfileEditDialog({
  paddockId,
  paddockName,
  current,
  trigger,
}: Props) {
  const { toast } = useToast();
  const { data: defaults = [] } = useSoilClassDefaults();
  const upsert = useUpsertPaddockSoilProfile();
  const del = useDeletePaddockSoilProfile();
  const [open, setOpen] = useState(false);

  const [soilClass, setSoilClass] = useState<string>(
    (current?.irrigation_soil_class as string) ?? "",
  );
  const [awc, setAwc] = useState<string>(
    current?.awc_mm_per_m != null ? String(current.awc_mm_per_m) : "",
  );
  const [rootDepth, setRootDepth] = useState<string>(
    current?.effective_root_depth_m != null
      ? String(current.effective_root_depth_m)
      : "",
  );
  const [depletion, setDepletion] = useState<string>(
    current?.allowed_depletion_percent != null
      ? String(current.allowed_depletion_percent)
      : "",
  );
  const [override, setOverride] = useState<boolean>(!!current?.manual_override);
  const [notes, setNotes] = useState<string>(current?.manual_notes ?? "");

  function applyClassDefaults(cls: string) {
    setSoilClass(cls);
    const def = defaults.find((d) => d.irrigation_soil_class === cls);
    if (def) {
      if (def.default_awc_mm_per_m != null) setAwc(String(def.default_awc_mm_per_m));
      if (def.default_root_depth_m != null)
        setRootDepth(String(def.default_root_depth_m));
      if (def.default_allowed_depletion_percent != null)
        setDepletion(String(def.default_allowed_depletion_percent));
    }
  }

  async function handleSave() {
    try {
      await upsert.mutateAsync({
        paddockId,
        irrigationSoilClass: soilClass || null,
        awcMmPerM: awc ? Number(awc) : null,
        effectiveRootDepthM: rootDepth ? Number(rootDepth) : null,
        allowedDepletionPercent: depletion ? Number(depletion) : null,
        manualOverride: override,
        manualNotes: notes || null,
        // preserve SEED metadata if present
        soilLandscape: (current?.soil_landscape as string) ?? null,
        salisCode: (current?.salis_code as string) ?? null,
        australianSoilClassification:
          (current?.australian_soil_classification as string) ?? null,
        landAndSoilCapability: (current?.land_and_soil_capability as string) ?? null,
        confidence: (current?.confidence as string) ?? null,
        source: override ? "manual" : (current?.source as string) ?? "manual",
        provider: (current?.provider as string) ?? null,
        raw: current?.raw ?? null,
      });
      toast({ title: "Soil profile saved" });
      setOpen(false);
    } catch (e: any) {
      toast({
        title: "Could not save soil profile",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this soil profile? This cannot be undone.")) return;
    try {
      await del.mutateAsync(paddockId);
      toast({ title: "Soil profile deleted" });
      setOpen(false);
    } catch (e: any) {
      toast({
        title: "Could not delete soil profile",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Soil profile{paddockName ? ` · ${paddockName}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Irrigation soil class</Label>
            <Select value={soilClass} onValueChange={applyClassDefaults}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select soil class" />
              </SelectTrigger>
              <SelectContent>
                {defaults.map((d) => (
                  <SelectItem
                    key={d.irrigation_soil_class}
                    value={d.irrigation_soil_class}
                  >
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">AWC (mm/m)</Label>
              <Input
                type="number"
                step="0.1"
                value={awc}
                onChange={(e) => setAwc(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Root depth (m)</Label>
              <Input
                type="number"
                step="0.05"
                value={rootDepth}
                onChange={(e) => setRootDepth(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Allowed depletion (%)</Label>
              <Input
                type="number"
                step="1"
                value={depletion}
                onChange={(e) => setDepletion(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Manual override</Label>
            <Switch checked={override} onCheckedChange={setOverride} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {current && (
            <Button
              variant="destructive"
              type="button"
              onClick={handleDelete}
              disabled={del.isPending}
            >
              Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={upsert.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
