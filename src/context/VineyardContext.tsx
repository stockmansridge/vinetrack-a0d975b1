import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export interface VineyardMembership {
  vineyard_id: string;
  role: string;
  vineyard_name?: string | null;
}

interface VineyardContextValue {
  memberships: VineyardMembership[];
  loading: boolean;
  selectedVineyardId: string | null;
  selectVineyard: (id: string) => void;
  currentRole: string | null;
}

const VineyardContext = createContext<VineyardContextValue>({
  memberships: [],
  loading: true,
  selectedVineyardId: null,
  selectVineyard: () => {},
  currentRole: null,
});

const STORAGE_KEY = "vt_selected_vineyard";
const ALLOWED_ROLES = ["owner", "manager"];

export function VineyardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedVineyardId, setSelectedVineyardId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["memberships", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<VineyardMembership[]> => {
      const { data, error } = await supabase
        .from("vineyard_members")
        .select("vineyard_id, role, vineyards(name)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? [])
        .filter((m: any) => ALLOWED_ROLES.includes(m.role))
        .map((m: any) => ({
          vineyard_id: m.vineyard_id,
          role: m.role,
          vineyard_name: m.vineyards?.name ?? null,
        }));
    },
  });

  const memberships = data ?? [];

  const selectVineyard = useCallback((id: string) => {
    setSelectedVineyardId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  // Auto-pick if exactly one
  useEffect(() => {
    if (!selectedVineyardId && memberships.length === 1) {
      selectVineyard(memberships[0].vineyard_id);
    }
    // Clear selection if no longer member
    if (selectedVineyardId && memberships.length && !memberships.find((m) => m.vineyard_id === selectedVineyardId)) {
      setSelectedVineyardId(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [memberships, selectedVineyardId, selectVineyard]);

  const currentRole = memberships.find((m) => m.vineyard_id === selectedVineyardId)?.role ?? null;

  return (
    <VineyardContext.Provider
      value={{ memberships, loading: isLoading, selectedVineyardId, selectVineyard, currentRole }}
    >
      {children}
    </VineyardContext.Provider>
  );
}

export const useVineyard = () => useContext(VineyardContext);
