import { Outlet } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { useIrrigationAccess } from "@/lib/irrigationQuery";
import NotFound from "@/pages/NotFound";

/**
 * Phase 1 gate for Irrigation Records. Access is decided server-side by
 * `has_irrigation_records_access` (System Administrators who are members of
 * the vineyard). Non-eligible users get a 404 so the feature is invisible.
 */
export function RequireIrrigationAccess() {
  const { selectedVineyardId } = useVineyard();
  const { hasAccess, loading } = useIrrigationAccess(selectedVineyardId);
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!hasAccess) return <NotFound />;
  return <Outlet />;
}

export default RequireIrrigationAccess;
