import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useVineyard } from '@/context/VineyardContext';
import { useFeatureFlag, useIsSystemAdmin } from '@/lib/systemAdmin';
import { listPermanentItems, permanentItemsAllowed, permanentItemsKey } from '@/lib/permanentItems';

export function usePermanentItemsAccess() {
  const { user, loading: authLoading } = useAuth();
  const { selectedVineyardId, memberships, loading: membershipsLoading } = useVineyard();
  const { isAdmin, loading } = useIsSystemAdmin();
  const flag = useFeatureFlag('permanent_items_admin_preview');
  const member = memberships.some(m => m.vineyard_id === selectedVineyardId);
  const allowed = !loading && !authLoading && !membershipsLoading && permanentItemsAllowed(isAdmin, flag, user?.id, selectedVineyardId, member);
  return { allowed, vineyardId: selectedVineyardId, userId: user?.id };
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