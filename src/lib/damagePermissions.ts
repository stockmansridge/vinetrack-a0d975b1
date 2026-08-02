// Server-authoritative permission check for deleting damage records.
//
// Authority = owner-level membership (owner / co-owner), manager, or
// system administrator. Both inputs come from the server:
//   - the role comes from `vineyard_members` (RLS-scoped read in VineyardContext)
//   - system admin comes from the `is_system_admin()` RPC
// The backend RPC (SQL 160 `delete_damage_record`) re-checks both; the UI gate
// only decides whether to render the action.
import { useVineyard } from "@/context/VineyardContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";

const OWNER_LEVEL_ROLES = new Set([
  "owner",
  "co_owner",
  "co-owner",
  "coowner",
  "manager",
]);

export function isDamageManagerRole(role: string | null | undefined): boolean {
  return !!role && OWNER_LEVEL_ROLES.has(role);
}

/**
 * `allowed` is only true once permission data has finished loading, so the
 * destructive action never flashes while roles/admin state resolve.
 */
export function useCanDeleteDamageRecords(): { allowed: boolean; loading: boolean } {
  const { currentRole, loading: vineyardLoading } = useVineyard();
  const { isAdmin, loading: adminLoading } = useIsSystemAdmin();
  const loading = vineyardLoading || adminLoading;
  return {
    allowed: !loading && (isDamageManagerRole(currentRole) || isAdmin),
    loading,
  };
}
