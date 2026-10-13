import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { canAccessRoute } from "@/lib/rolePermissions";
import { wineGrapeLevyAccess, type WineGrapeLevyAccess } from "@/lib/wineGrapeLevyAccess";

/** Presentational gate: children only mount when access is "allowed". */
export function WineGrapeLevyGateView({
  access,
  role,
  children,
}: {
  access: WineGrapeLevyAccess;
  role: string | null | undefined;
  children: ReactNode;
}) {
  if (access === "allowed") return <>{children}</>;
  if (access === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">Checking vineyard…</div>;
  }
  if (access === "role") {
    return (
      <Card className="m-6 p-6 space-y-2">
        <h1 className="text-lg font-semibold">Permission required</h1>
        <p className="text-sm text-muted-foreground">Only vineyard owners and managers can open Wine Grape Levy.</p>
      </Card>
    );
  }
  return (
    <Card className="m-6 p-6 space-y-3">
      <h1 className="text-lg font-semibold">Wine Grape Levy</h1>
      <p className="text-sm">Wine Grape Levy is available only for vineyards located in Australia.</p>
      {access === "country-missing" && (
        <>
          <p className="text-sm text-muted-foreground">Set the vineyard country under Vineyard Settings.</p>
          {canAccessRoute("/setup/vineyard", role ?? null) && (
            <Button variant="outline" asChild>
              <Link to="/setup/vineyard">Open Vineyard Settings</Link>
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Route gate. Reads the selected vineyard's current profile `country` directly
 * (vineyard-scoped, RLS-enforced) so a stale support-session snapshot can't
 * grant access. No default country; loading never grants access.
 */
export function WineGrapeLevyGate({ children }: { children: ReactNode }) {
  const { selectedVineyardId, currentRole, currentCountry, loading } = useVineyard();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["wine-grape-levy", "vineyard-country", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("vineyards")
        .select("country")
        .eq("id", selectedVineyardId!)
        .maybeSingle();
      if (error) throw error;
      return (data as { country?: string | null } | null)?.country ?? null;
    },
  });
  // Both sources must agree on AU; membership country updates immediately on
  // Vineyard Settings save, the fresh read guards stale support snapshots.
  const country = !isError && data !== undefined && data === currentCountry ? data : isError ? null : data;
  const freshLoading = loading || (!!selectedVineyardId && isLoading);
  const access = wineGrapeLevyAccess({
    role: currentRole,
    country: selectedVineyardId ? (data === undefined ? null : currentCountry ?? country) : null,
    loading: freshLoading,
  });
  // Require the fresh read to also resolve AU before allowing.
  const final =
    access === "allowed" && wineGrapeLevyAccess({ role: currentRole, country, loading: false }) !== "allowed"
      ? wineGrapeLevyAccess({ role: currentRole, country, loading: false })
      : access;
  return (
    <WineGrapeLevyGateView access={final} role={currentRole} key={selectedVineyardId ?? "none"}>
      <div key={selectedVineyardId ?? "none"}>{children}</div>
    </WineGrapeLevyGateView>
  );
}
