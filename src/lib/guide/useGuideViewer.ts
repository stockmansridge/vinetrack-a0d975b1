import { useMemo } from "react";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import type { GuideViewer } from "@/lib/guide/guideAccess";
import type { Role } from "@/lib/rolePermissions";

/**
 * The current guide viewer (Stage 5B).
 *
 * Combines the two existing authorities — System Admin status and the user's
 * role on the selected vineyard — into the shape every guide component takes.
 * It grants nothing: it only describes who is looking.
 */
export function useGuideViewer(): GuideViewer {
  const { isAdmin } = useIsSystemAdmin();
  const { currentRole } = useVineyard();
  return useMemo(
    () => ({ isSystemAdmin: !!isAdmin, role: (currentRole as Role | null) ?? null }),
    [isAdmin, currentRole],
  );
}
