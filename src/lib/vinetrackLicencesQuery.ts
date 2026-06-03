// Read-only query for VineTrack Team user licences. All writes go through
// service-role edge functions (create-vinetrack-user-licence, etc.).
import { useQuery } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export interface VinetrackLicenceRow {
  id: string;
  subscription_id: string | null;
  user_id: string | null;
  invited_email: string | null;
  vineyard_id: string | null;
  status: string | null;
  assigned_by: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
}

export function useVinetrackLicences(subscriptionId: string | null | undefined) {
  return useQuery({
    queryKey: ["vinetrack", "licences", subscriptionId ?? null],
    enabled: !!subscriptionId,
    staleTime: 30_000,
    queryFn: async (): Promise<VinetrackLicenceRow[]> => {
      const { data, error } = await (iosSupabase as any)
        .from("vinetrack_user_licences")
        .select(
          "id, subscription_id, user_id, invited_email, vineyard_id, status, assigned_by, created_at, metadata",
        )
        .eq("subscription_id", subscriptionId)
        .order("created_at", { ascending: true });
      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("does not exist") || (error as any).code === "42P01") {
          return [];
        }
        throw error;
      }
      return (data ?? []) as VinetrackLicenceRow[];
    },
  });
}
