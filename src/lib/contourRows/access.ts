import { useAuth } from '@/context/AuthContext';
import { useVineyard } from '@/context/VineyardContext';

/** UI boundary only; draft RPCs remain the authoritative vineyard permission checks. */
export function useContourMemberAccess(vineyardId?: string | null) {
  const { user, loading: authLoading } = useAuth();
  const { selectedVineyardId, memberships, loading: membershipsLoading } = useVineyard();
  const loading = !!authLoading || !!membershipsLoading;
  const allowed = !loading && !!user?.id && !!selectedVineyardId &&
    (!vineyardId || vineyardId === selectedVineyardId) &&
    memberships.some(m => m.vineyard_id === selectedVineyardId);
  return { allowed, loading, userId: user?.id ?? null, vineyardId: selectedVineyardId };
}