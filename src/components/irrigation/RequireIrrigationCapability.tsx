import { Outlet } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import {
  useIrrigationCapabilities,
  type IrrigationCapability,
} from "@/lib/irrigationQuery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, Loader2 } from "lucide-react";

function IrrigationAccessDenied() {
  return (
    <div className="p-8">
      <Card className="max-w-xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Permission required</CardTitle>
          </div>
          <CardDescription>
            You do not have permission to perform this irrigation action. Please contact a
            vineyard owner or manager.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

/**
 * Route gate driven entirely by the shared SQL 151 capability response.
 * Nothing renders until the capability answer is authoritative, so gated
 * content never flashes before a denial. Load failures deny and offer a retry
 * rather than falling back to any frontend role matrix.
 */
export function RequireIrrigationCapability({
  capability,
}: {
  capability: IrrigationCapability;
}) {
  const { selectedVineyardId } = useVineyard();
  const { can, loading, error, ready, refetch } = useIrrigationCapabilities(selectedVineyardId);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Couldn't check irrigation access</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ready || !can(capability)) return <IrrigationAccessDenied />;
  return <Outlet />;
}

export default RequireIrrigationCapability;
