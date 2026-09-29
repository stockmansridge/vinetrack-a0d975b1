// System Admin: count of feature requests + comments posted since the admin
// last opened the Feature Requests page (last-seen kept per browser; display only).
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";

const key = (uid: string) => `feature-requests-seen:${uid}`;
const QK = ["feature-requests", "unseen"];

function lastSeen(uid: string): string {
  try {
    const v = localStorage.getItem(key(uid));
    if (v) return v;
    const now = new Date().toISOString();
    localStorage.setItem(key(uid), now);
    return now;
  } catch {
    return new Date().toISOString();
  }
}

export function useUnseenFeatureRequestCount(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QK, user?.id],
    enabled: enabled && !!user,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const since = lastSeen(user!.id);
      const count = async (table: string) => {
        const { count, error } = await (iosSupabase as any)
          .from(table)
          .select("id", { count: "exact", head: true })
          .gt("created_at", since)
          .neq("created_by", user!.id);
        return error ? 0 : count ?? 0;
      };
      const [r, c] = await Promise.all([count("feature_requests"), count("feature_request_comments")]);
      return r + c;
    },
  });
}

export function useMarkFeatureRequestsSeen(active: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!active || !user) return;
    try {
      localStorage.setItem(key(user.id), new Date().toISOString());
    } catch {
      /* ignore */
    }
    qc.setQueryData([...QK, user.id], 0);
  }, [active, user, qc]);
}
