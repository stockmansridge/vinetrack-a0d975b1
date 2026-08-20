import { Navigate, useParams } from "react-router-dom";
import { GuidePageShell } from "@/components/guide/GuidePageShell";
import { OperationalToolGuideView } from "@/components/guide/OperationalToolGuideView";
import {
  operationalToolGuide,
  OPERATIONAL_TOOLS_ROUTE,
} from "@/lib/guide/operationalToolGuides";

/**
 * One parameterised route serves all thirteen Operational Tool guides:
 *   /dashboard/how-vinetrack-works/operational-tools/:tool
 *
 * `:tool` is the stable shared OperationalToolCatalog ID. Unknown IDs fall back
 * safely to the Operational Tools catalogue. Access stays System Admin-only
 * through RequireSystemAdmin on the parent route.
 */
export default function OperationalToolGuidePage() {
  const { tool } = useParams<{ tool: string }>();
  const guide = operationalToolGuide(tool);

  if (!guide) return <Navigate to={OPERATIONAL_TOOLS_ROUTE} replace />;

  return (
    <GuidePageShell>
      <OperationalToolGuideView guide={guide} />
    </GuidePageShell>
  );
}
