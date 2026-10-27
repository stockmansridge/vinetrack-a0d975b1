import { useMemo } from "react";
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin, useFeatureFlags } from "@/lib/systemAdmin";
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
  const { currentRole, selectedVineyardId, currentCountry } = useVineyard();
  const { isAdmin: isSystemAdmin, loading: adminLoading } = useIsSystemAdmin();
  const { capabilities, isLoading: irrigationLoading } =
    useIrrigationCapabilities(selectedVineyardId) as any;
  const { data: billingVineyards = [], isLoading: billingLoading } = useBillingVineyards();
  const { data: featureFlags = [] } = useFeatureFlags();

  return useMemo(
    () => ({
      role: currentRole,
      vineyardCountry: currentCountry,
      isSystemAdmin: !!isSystemAdmin,
      featureFlags: featureFlags.filter((f) => f.is_enabled).map((f) => f.key),
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
      currentCountry,
      isSystemAdmin,
      adminLoading,
      featureFlags,
      capabilities?.can_view_irrigation_records,
      capabilities?.can_view_irrigation_reports,
      capabilities?.can_manage_irrigation_setup,
      irrigationLoading,
      billingVineyards.length,
      billingLoading,
    ],
  );
}
