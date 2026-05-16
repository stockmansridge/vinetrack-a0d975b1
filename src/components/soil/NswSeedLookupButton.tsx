import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Sprout } from "lucide-react";
import {
  type PaddockSoilProfile,
  useNswSeedLookup,
  useUpsertPaddockSoilProfile,
  NSW_SEED_DISCLAIMER,
} from "@/lib/soilProfiles";

interface Props {
  paddockId: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  current: PaddockSoilProfile | null;
}

export default function NswSeedLookupButton({
  paddockId,
  latitude,
  longitude,
  current,
}: Props) {
  const { toast } = useToast();
  const lookup = useNswSeedLookup();
  const upsert = useUpsertPaddockSoilProfile();
  const [open, setOpen] = useState(false);

  const hasCoords = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  const hasProfile = !!current;
  const isOverride = !!current?.manual_override;

  async function runLookup() {
    if (!hasCoords) {
      toast({
        title: "No coordinates",
        description: "This block has no location to look up.",
        variant: "destructive",
      });
      return;
    }
    try {
      const seed = await lookup.mutateAsync({
        latitude: Number(latitude),
        longitude: Number(longitude),
      });
      await upsert.mutateAsync({
        paddockId,
        irrigationSoilClass: (seed.irrigation_soil_class as string) ?? null,
        soilLandscape: (seed.soil_landscape as string) ?? null,
        salisCode: (seed.salis_code as string) ?? null,
        australianSoilClassification:
          (seed.australian_soil_classification as string) ?? null,
        landAndSoilCapability: (seed.land_and_soil_capability as string) ?? null,
        awcMmPerM: (seed.awc_mm_per_m as number) ?? null,
        effectiveRootDepthM: (seed.effective_root_depth_m as number) ?? null,
        allowedDepletionPercent: (seed.allowed_depletion_percent as number) ?? null,
        confidence: (seed.confidence as string) ?? null,
        provider: (seed.provider as string) ?? "nsw_seed",
        source: (seed.source as string) ?? "nsw_seed",
        manualOverride: false,
        raw: seed.raw ?? seed,
      });
      toast({
        title: "Soil profile updated from NSW SEED",
        description: NSW_SEED_DISCLAIMER,
      });
      setOpen(false);
    } catch (e: any) {
      toast({
        title: "NSW SEED lookup failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    }
  }

  if (!hasProfile) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={runLookup}
        disabled={!hasCoords || lookup.isPending || upsert.isPending}
      >
        <Sprout className="h-4 w-4 mr-1" />
        Fetch soil from NSW SEED
      </Button>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasCoords}>
          <Sprout className="h-4 w-4 mr-1" />
          Re-fetch from NSW SEED
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace soil profile from NSW SEED?</AlertDialogTitle>
          <AlertDialogDescription>
            {isOverride
              ? "This block has a MANUAL override. Re-fetching will overwrite your manually entered values with NSW SEED data."
              : "Re-fetching will replace the existing soil profile with values from NSW SEED."}
            <br />
            <br />
            {NSW_SEED_DISCLAIMER}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={runLookup}>
            Yes, replace
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
