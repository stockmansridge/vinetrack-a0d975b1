import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "./AuthContext";
import { setDateLocaleFromCountry } from "@/lib/dateFormat";

export interface VineyardMembership {
  vineyard_id: string;
  role: string;
  vineyard_name?: string | null;
  vineyard_country?: string | null;
}

/**
 * System Admin support session: lets a System Admin open a customer's
 * vineyard (which they are not a member of) to fix block layouts.
 * UI-only — every read/write is still authorised server-side (RLS / RPC).
 */
export interface AdminSupportVineyard {
  vineyard_id: string;
  vineyard_name: string | null;
  vineyard_country: string | null;
}

interface VineyardContextValue {
  memberships: VineyardMembership[];
  loading: boolean;
  selectedVineyardId: string | null;
  selectVineyard: (id: string) => void;
  currentRole: string | null;
  currentCountry: string | null;
  adminSupport: AdminSupportVineyard | null;
  startAdminSupport: (v: AdminSupportVineyard) => void;
  endAdminSupport: () => void;
}

const VineyardContext = createContext<VineyardContextValue>({
  memberships: [],
  loading: true,
  selectedVineyardId: null,
  selectVineyard: () => {},
  currentRole: null,
  currentCountry: null,
  adminSupport: null,
  startAdminSupport: () => {},
  endAdminSupport: () => {},
});

const STORAGE_KEY = "vt_selected_vineyard";
const SUPPORT_KEY = "vt_admin_support_vineyard";

function readSupport(): AdminSupportVineyard | null {
  try {
    const raw = sessionStorage.getItem(SUPPORT_KEY);
    return raw ? (JSON.parse(raw) as AdminSupportVineyard) : null;
  } catch {
    return null;
  }
}

export function VineyardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ownSelectedId, setSelectedVineyardId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [adminSupport, setAdminSupport] = useState<AdminSupportVineyard | null>(readSupport);

  const { data, isLoading } = useQuery({
    queryKey: ["memberships", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<VineyardMembership[]> => {
      const { data, error } = await supabase
        .from("vineyard_members")
        .select("vineyard_id, role, vineyards!inner(name, country, deleted_at)")
        .eq("user_id", user!.id)
        .is("vineyards.deleted_at", null);
      if (error) throw error;
      return (data ?? [])
        .map((m: any) => ({
          vineyard_id: m.vineyard_id,
          role: m.role,
          vineyard_name: m.vineyards?.name ?? null,
          vineyard_country: m.vineyards?.country ?? null,
        }));
    },
  });

  const memberships = data ?? [];

  const endAdminSupport = useCallback(() => {
    setAdminSupport(null);
    try { sessionStorage.removeItem(SUPPORT_KEY); } catch { /* ignore */ }
  }, []);

  const startAdminSupport = useCallback((v: AdminSupportVineyard) => {
    setAdminSupport(v);
    try { sessionStorage.setItem(SUPPORT_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  }, []);

  const selectVineyard = useCallback((id: string) => {
    endAdminSupport();
    setSelectedVineyardId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, [endAdminSupport]);

  // Support session ends when the user signs out / changes.
  useEffect(() => {
    if (!user && adminSupport) endAdminSupport();
  }, [user, adminSupport, endAdminSupport]);

  // Auto-pick if exactly one
  useEffect(() => {
    if (!ownSelectedId && memberships.length === 1) {
      setSelectedVineyardId(memberships[0].vineyard_id);
      localStorage.setItem(STORAGE_KEY, memberships[0].vineyard_id);
    }
    // Clear selection if no longer member
    if (ownSelectedId && memberships.length && !memberships.find((m) => m.vineyard_id === ownSelectedId)) {
      setSelectedVineyardId(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [memberships, ownSelectedId]);

  const selectedVineyardId = adminSupport?.vineyard_id ?? ownSelectedId;
  const currentMembership = memberships.find((m) => m.vineyard_id === selectedVineyardId);
  // In a support session the admin acts with manager-level UI; the backend
  // still decides what is actually allowed.
  const currentRole = currentMembership?.role ?? (adminSupport ? "manager" : null);
  const currentCountry =
    currentMembership?.vineyard_country ?? adminSupport?.vineyard_country ?? null;

  // Keep the global date formatter in sync with the selected vineyard's country.
  useEffect(() => {
    setDateLocaleFromCountry(currentCountry);
  }, [currentCountry]);

  return (
    <VineyardContext.Provider
      value={{
        memberships,
        loading: isLoading,
        selectedVineyardId,
        selectVineyard,
        currentRole,
        currentCountry,
        adminSupport,
        startAdminSupport,
        endAdminSupport,
      }}
    >
      {children}
    </VineyardContext.Provider>
  );
}

export const useVineyard = () => useContext(VineyardContext);
