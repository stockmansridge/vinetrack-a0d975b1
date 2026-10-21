import { useQuery } from "@tanstack/react-query";
import { AE_KEYS, adminRpc } from "@/lib/accessEntitlementsQuery";
import { parseAccessHealth } from "@/lib/accessHealth";

/** Mounted inside AdminGate. The RPC independently requires System Admin access. */
export function useAccessHealth() {
  return useQuery({
    queryKey: [...AE_KEYS.root, "health"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => parseAccessHealth(await adminRpc("admin_access_health")),
  });
}
