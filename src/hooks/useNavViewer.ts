import { useMemo } from "react";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { useIrrigationCapabilities } from "@/lib/irrigationQuery";
import { useBillingVineyards } from "@/lib/customerBillingQuery";
import type { NavViewer } from "@/lib/navigationConfig";

/**
 * Who is looking, for navigation purposes only.
 *
 * It reuses the existing role, System Admin, irrigation capability and billing
 * eligibility helpers. It grants nothing — route guards still decide access.
 */
export function useNavViewer(): NavViewer {
  const { currentRole, selectedVineyardId } = useVineyard();
  const { isAdmin: isSystemAdmin, loading: adminLoading } = useIsSystemAdmin();
  const { capabilities, isLoading: irrigationLoading } =
    useIrrigationCapabilities(selectedVineyardId) as any;
  const { data: billingVineyards = [], isLoading: billingLoading } = useBillingVineyards();

  return useMemo(
    () => ({
      role: currentRole,
      isSystemAdmin: !!isSystemAdmin,
      irrigation: {
        records: !!capabilities?.can_view_irrigation_records,
        reports: !!capabilities?.can_view_irrigation_reports,
        setup: !!capabilities?.can_manage_irrigation_setup,
      },
      hasAccountBilling: billingVineyards.length > 0,
      loading: !!adminLoading || !!irrigationLoading || !!billingLoading,
    }),
    [
      currentRole,
      isSystemAdmin,
      adminLoading,
      capabilities?.can_view_irrigation_records,
      capabilities?.can_view_irrigation_reports,
      capabilities?.can_manage_irrigation_setup,
      irrigationLoading,
      billingVineyards.length,
      billingLoading,
    ],
  );
}
