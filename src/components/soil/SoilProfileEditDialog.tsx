import { useEffect, useState } from "react";
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
  useSoilClassDefaults,
  usePaddockSoilProfile,
  useVineyardDefaultSoilProfile,
  useUpsertPaddockSoilProfile,
  useUpsertVineyardDefaultSoilProfile,
  useDeletePaddockSoilProfile,
  useDeleteVineyardDefaultSoilProfile,
  parseSoilNumber,
  validateSoilNumbers,
} from "@/lib/soilProfiles";

interface Props {
  /** Block profile. Omit (with wholeVineyard) for the vineyard-wide profile. */
  paddockId?: string | null;
  paddockName?: string | null;
  vineyardId?: string | null;
  /** Edit the shared whole-vineyard profile (paddock_id = null). */
  wholeVineyard?: boolean;
  trigger: React.ReactNode;
}

export default function SoilProfileEditDialog({
  paddockId,
  paddockName,
  vineyardId,
  wholeVineyard = false,
  trigger,
}: Props) {
  const { toast } = useToast();
  const { data: defaults = [] } = useSoilClassDefaults();
  const [open, setOpen] = useState(false);

  // Always read the latest stored profile when the editor opens.
  const paddockQuery = usePaddockSoilProfile(
    !wholeVineyard && open ? paddockId : null,
  );
  const vineyardQuery = useVineyardDefaultSoilProfile(
    wholeVineyard && open ? vineyardId : null,
  );
  const current = (wholeVineyard ? vineyardQuery.data : paddockQuery.data) ?? null;
  const loading = wholeVineyard ? vineyardQuery.isLoading : paddockQuery.isLoading;
  const loadError = wholeVineyard ? vineyardQuery.error : paddockQuery.error;

  const upsertPaddock = useUpsertPaddockSoilProfile();
  const upsertVineyard = useUpsertVineyardDefaultSoilProfile();
  const deletePaddock = useDeletePaddockSoilProfile();
  const deleteVineyard = useDeleteVineyardDefaultSoilProfile();
  const saving = upsertPaddock.isPending || upsertVineyard.isPending;
  const deleting = deletePaddock.isPending || deleteVineyard.isPending;

  const [soilClass, setSoilClass] = useState("");
  const [awc, setAwc] = useState("");
  const [rootDepth, setRootDepth] = useState("");
  const [depletion, setDepletion] = useState("");
  const [override, setOverride] = useState(false);
  const [notes, setNotes] = useState("");

  // Hydrate from the freshly loaded profile whenever it changes.
  useEffect(() => {
    if (!open) return;
    setSoilClass((current?.irrigation_soil_class as string) ?? "");
    setAwc(current?.awc_mm_per_m != null ? String(current.awc_mm_per_m) : "");
    setRootDepth(
      current?.effective_root_depth_m != null ? String(current.effective_root_depth_m) : "",
    );
    setDepletion(
      current?.allowed_depletion_percent != null
        ? String(current.allowed_depletion_percent)
        : "",
    );
    setOverride(!!current?.manual_override);
    setNotes((current?.manual_notes as string) ?? "");
  }, [open, current]);

  /** Soil-class defaults only fill blank fields — saved values are kept. */
  function applyClassDefaults(cls: string) {
    setSoilClass(cls);
    const def = defaults.find((d) => d.irrigation_soil_class === cls);
    if (!def) return;
    if (!awc && def.default_awc_mm_per_m != null) setAwc(String(def.default_awc_mm_per_m));
    if (!rootDepth && def.default_root_depth_m != null)
      setRootDepth(String(def.default_root_depth_m));
    if (!depletion && def.default_allowed_depletion_percent != null)
      setDepletion(String(def.default_allowed_depletion_percent));
  }

  async function handleSave() {
    const values = {
      awcMmPerM: parseSoilNumber(awc),
      effectiveRootDepthM: parseSoilNumber(rootDepth),
      allowedDepletionPercent: parseSoilNumber(depletion),
    };
    const invalid = validateSoilNumbers(values);
    if (invalid) {
      toast({ title: "Check the soil values", description: invalid, variant: "destructive" });
      return;
    }
    const shared = {
      irrigationSoilClass: soilClass || null,
      ...values,
      manualOverride: override,
      manualNotes: notes || null,
      soilLandscape: (current?.soil_landscape as string) ?? null,
      salisCode: (current?.salis_code as string) ?? null,
      australianSoilClassification:
        (current?.australian_soil_classification as string) ?? null,
      landAndSoilCapability: (current?.land_and_soil_capability as string) ?? null,
      confidence: (current?.confidence as string) ?? null,
      source: override ? "manual" : (current?.source as string) ?? "manual",
      provider: (current?.provider as string) ?? null,
      raw: current?.raw ?? null,
    };
    try {
      if (wholeVineyard) {
        if (!vineyardId) throw new Error("No vineyard selected.");
        await upsertVineyard.mutateAsync({ vineyardId, ...shared });
      } else {
        if (!paddockId) throw new Error("No block selected.");
        await upsertPaddock.mutateAsync({
          paddockId,
          vineyardId: vineyardId ?? null,
          ...shared,
        });
      }
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
      if (wholeVineyard) {
        if (!vineyardId) throw new Error("No vineyard selected.");
        await deleteVineyard.mutateAsync(vineyardId);
      } else {
        if (!paddockId) throw new Error("No block selected.");
        await deletePaddock.mutateAsync(paddockId);
      }
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

  const title = wholeVineyard
    ? "Whole vineyard soil"
    : `Soil profile${paddockName ? ` · ${paddockName}` : ""}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {loading && (
          <p className="text-xs text-muted-foreground">Loading saved soil profile…</p>
        )}
        {loadError && (
          <p className="text-xs text-destructive">
            Could not load the saved soil profile: {(loadError as any)?.message ?? "unknown error"}
          </p>
        )}
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
                min={0}
                max={400}
                value={awc}
                onChange={(e) => setAwc(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Root depth (m)</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={5}
                value={rootDepth}
                onChange={(e) => setRootDepth(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Allowed depletion (%)</Label>
              <Input
                type="number"
                step="1"
                min={0}
                max={100}
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
              disabled={deleting}
            >
              Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
