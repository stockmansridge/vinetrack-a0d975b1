import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/ios-supabase/client";

interface TeamRow {
  user_id: string;
  display_name: string | null;
  full_name: string | null;
  email: string | null;
}

export interface MemberLabel {
  name: string;
  email: string | null;
}

export function useTeamLookup(vineyardId: string | null) {
  const { data } = useQuery({
    queryKey: ["team-lookup", vineyardId],
    enabled: !!vineyardId,
    queryFn: async (): Promise<TeamRow[]> => {
      const { data, error } = await supabase.rpc("get_vineyard_team_members", {
        p_vineyard_id: vineyardId!,
      });
      if (error) {
        // 42501 = forbidden; treat as empty
        if ((error as any).code === "42501") return [];
        throw error;
      }
      return (data ?? []) as TeamRow[];
    },
  });

  const lookup = useMemo(() => {
    const m = new Map<string, MemberLabel>();
    (data ?? []).forEach((r) => {
      const name = r.display_name?.trim() || r.full_name?.trim() || r.email?.trim() || "Unknown member";
      m.set(r.user_id, { name, email: r.email?.trim() || null });
    });
    return m;
  }, [data]);

  const resolve = (userId: string | null | undefined, fallbackText?: string | null): string | null => {
    if (userId) {
      const hit = lookup.get(userId);
      if (hit) return hit.name;
      // Don't show raw UUIDs
      return fallbackText?.trim() || "Unknown member";
    }
    return fallbackText?.trim() || null;
  };

  return { lookup, resolve };
}
