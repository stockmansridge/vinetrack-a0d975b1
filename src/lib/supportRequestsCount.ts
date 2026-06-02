// Hook: unresolved support request count for system admins only.
// Calls the same admin RPC the AdminSupportRequestsPage uses, and counts
// rows whose status is not resolved/closed (and not soft-deleted, when present).

import { useQuery } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useIsSystemAdmin } from "@/lib/systemAdmin";

const RESOLVED = new Set(["resolved", "closed"]);

async function fetchUnresolvedCount(): Promise<number> {
  const { data, error } = await (iosSupabase as any).rpc("admin_list_support_requests");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ status?: string | null; deleted_at?: string | null }>;
  return rows.filter((r) => {
    if (r.deleted_at) return false;
    const s = (r.status ?? "").toLowerCase();
    return !RESOLVED.has(s);
  }).length;
}

export function useUnresolvedSupportCount() {
  const { isAdmin } = useIsSystemAdmin();
  return useQuery({
    queryKey: ["admin", "support-requests", "unresolved-count"],
    enabled: isAdmin,
    queryFn: fetchUnresolvedCount,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
