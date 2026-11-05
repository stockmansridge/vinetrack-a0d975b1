import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useDemoMode } from '@/context/DemoModeContext';
import { useVineyard } from '@/context/VineyardContext';
import { listPermanentItems, permanentItemsKey } from '@/lib/permanentItems';
import { getPermanentPermissions, permanentPermissionsKey } from '@/lib/permanentItemDeletion';

export function usePermanentItemsAccess() {
  const { user, loading: authLoading } = useAuth();
  const { selectedVineyardId, loading: membershipsLoading } = useVineyard();
  const { demoMode } = useDemoMode();
  const ready = !demoMode && !authLoading && !membershipsLoading && !!user?.id && !!selectedVineyardId;
  const permissions = useQuery({
    queryKey: permanentPermissionsKey(selectedVineyardId, user?.id),
    enabled: ready, retry: false, staleTime: 0,
    queryFn: () => {
      if (!selectedVineyardId) throw new Error('Select a vineyard.');
      return getPermanentPermissions(selectedVineyardId);
    },
  });
  const allowed = ready && permissions.isSuccess && permissions.data?.can_read === true;
  return { allowed, canManage: allowed && permissions.data?.can_manage === true,
    canHardDelete: allowed && permissions.data?.can_hard_delete === true,
    vineyardId: selectedVineyardId, userId: user?.id };
}
export function usePermanentItems() {
  const access = usePermanentItemsAccess();
  const query = useQuery({
    queryKey: permanentItemsKey(access.vineyardId, access.userId), enabled: access.allowed,
    queryFn: () => {
      if (!access.allowed || !access.vineyardId) throw new Error('Permanent Items pilot access is unavailable.');
      return listPermanentItems(access.vineyardId);
    },
  });
  return { ...access, query, items: access.allowed && !query.isError ? query.data ?? [] : [] };
}