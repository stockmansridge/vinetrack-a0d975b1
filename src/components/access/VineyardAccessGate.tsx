import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { usePendingInvites } from "@/hooks/usePendingInvites";
import {
  useRefreshVineyardAccess,
  useVineyardAccessMatrix,
  type VineyardAccessRow,
} from "@/lib/vineyardAccessQuery";
import RestrictedVineyard from "@/components/access/RestrictedVineyard";

/**
 * Routes that stay reachable regardless of the selected vineyard's access:
 * account/billing, invitations, support and System Admin tooling.
 */
const ALWAYS_ALLOWED_PREFIXES = ["/account", "/billing", "/admin", "/select-vineyard", "/soon"];

function isAlwaysAllowed(pathname: string) {
  return ALWAYS_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Phase 2F gate. Access is resolved per vineyard: a restricted vineyard never
 * produces an account-wide paywall while another vineyard is accessible.
 */
export function VineyardAccessGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { selectedVineyardId } = useVineyard();
  const { data: matrix, isLoading, error } = useVineyardAccessMatrix();
  const { data: invites = [] } = usePendingInvites();
  const refresh = useRefreshVineyardAccess();

  if (isAlwaysAllowed(pathname)) return <>{children}</>;

  // Never flash a paywall while access is resolving.
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your VineTrack access…
      </div>
    );
  }

  // A transport/contract failure is not a denial — never show upgrade wording.
  if (error || !matrix) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Couldn't check your access</CardTitle>
          <CardDescription>
            {(error as { message?: string } | null)?.message ??
              "We couldn't reach the VineTrack access service."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />
            Check access again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const row: VineyardAccessRow | undefined = matrix.vineyards.find(
    (v) => v.vineyard_id === selectedVineyardId,
  );

  if (row?.can_enter_vineyard) return <>{children}</>;

  // Restricted selection, but the account still has somewhere to go.
  if (row) {
    return (
      <RestrictedVineyard row={row} onChooseAnother={() => navigate("/select-vineyard")} />
    );
  }

  // Selected vineyard isn't in the matrix (membership removed / still loading
  // the membership list) — send the user to the picker rather than a paywall.
  if (matrix.summary.has_any_accessible_vineyard || invites.length > 0) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Choose a vineyard</CardTitle>
          <CardDescription>
            Select a vineyard to continue. Pending invitations are available on the vineyard
            picker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate("/select-vineyard")}>Choose a vineyard</Button>
        </CardContent>
      </Card>
    );
  }

  // Genuine full no-access state: nothing accessible and nothing pending.
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>No vineyards available</CardTitle>
        <CardDescription>
          None of your vineyards are currently accessible. Access to a vineyard is managed by its
          Vineyard Owner.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />
          Check access again
        </Button>
        <Button variant="outline" onClick={() => navigate("/select-vineyard")}>
          Vineyards &amp; invitations
        </Button>
      </CardContent>
    </Card>
  );
}

export default VineyardAccessGate;
