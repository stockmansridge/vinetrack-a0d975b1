// Stage 1 access gate: Soil Analysis is visible only to active System Admins
// while the soil_analysis_admin_preview feature flag is enabled. Anything
// else — non-admins, demo mode, flag off — sees a plain 404, matching the
// existing RequireSystemAdmin behaviour.
import { ReactNode } from "react";
import { useIsSystemAdmin, useFeatureFlag } from "@/lib/systemAdmin";
import { SOIL_ANALYSIS_FLAG } from "@/lib/soilAnalysis";
import NotFound from "@/pages/NotFound";

export function useSoilAnalysisAccess(): { allowed: boolean; loading: boolean } {
  const { isAdmin, loading } = useIsSystemAdmin();
  const flagOn = useFeatureFlag(SOIL_ANALYSIS_FLAG);
  return { allowed: isAdmin && flagOn, loading };
}

export function SoilAnalysisGate({ children }: { children: ReactNode }) {
  const { allowed, loading } = useSoilAnalysisAccess();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!allowed) return <NotFound />;
  return <>{children}</>;
}
