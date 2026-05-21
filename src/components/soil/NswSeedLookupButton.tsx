import { Button } from "@/components/ui/button";
import { Sprout } from "lucide-react";
import { type PaddockSoilProfile } from "@/lib/soilProfiles";

interface Props {
  paddockId: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  vineyardId?: string | null;
  current: PaddockSoilProfile | null;
}

/**
 * NSW SEED soil lookup is temporarily disabled pending the final Edge Function
 * contract from the iOS/Rork team. The button is rendered in a disabled state
 * with explanatory helper text so users fall back to manual soil entry.
 *
 * Status: incomplete / blocked — do not re-enable until a known-good payload
 * example is documented and verified end-to-end against the shared backend.
 */
export default function NswSeedLookupButton(_props: Props) {
  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" disabled>
        <Sprout className="h-4 w-4 mr-1" />
        NSW SEED lookup coming soon
      </Button>
      <p className="text-xs text-muted-foreground max-w-xs">
        Automatic NSW SEED soil lookup is being configured. Please use manual
        soil entry for now.
      </p>
    </div>
  );
}
