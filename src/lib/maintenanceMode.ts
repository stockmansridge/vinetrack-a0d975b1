// Portal maintenance mode: a single settings row on the Lovable Cloud project.
// Readable by everyone (the login screen is unauthenticated); writes go through
// the `admin-set-maintenance` edge function, which verifies VineTrack system
// admin status.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export const DEFAULT_MAINTENANCE_MESSAGE =
  "We are currently performing system maintenance. We will be back online shortly. Thank you for your patience.";

export const CANNED_MAINTENANCE_MESSAGES: { label: string; message: string }[] = [
  { label: "Standard maintenance", message: DEFAULT_MAINTENANCE_MESSAGE },
  {
    label: "Scheduled overnight upgrade",
    message:
      "VineTrack is undergoing a scheduled upgrade tonight. The portal will be available again in the morning. Thank you for your patience.",
  },
  {
    label: "Short outage",
    message:
      "VineTrack is briefly offline for essential updates. Please try again in about 15 minutes.",
  },
  {
    label: "Unplanned issue",
    message:
      "We are investigating an issue affecting VineTrack. Our team is working on a fix and the portal will return shortly.",
  },
];

export interface PortalMaintenance {
  is_enabled: boolean;
  message: string;
  updated_at: string | null;
  updated_by_email: string | null;
}

export async function fetchMaintenance(): Promise<PortalMaintenance> {
  const { data, error } = await cloudSupabase
    .from("portal_maintenance")
    .select("is_enabled, message, updated_at, updated_by_email")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return {
    is_enabled: data?.is_enabled ?? false,
    message: data?.message?.trim() || DEFAULT_MAINTENANCE_MESSAGE,
    updated_at: data?.updated_at ?? null,
    updated_by_email: data?.updated_by_email ?? null,
  };
}

export function useMaintenance() {
  return useQuery({
    queryKey: ["portal-maintenance"],
    queryFn: fetchMaintenance,
    staleTime: 30_000,
    retry: 1,
  });
}

export async function saveMaintenance(input: { isEnabled: boolean; message: string }) {
  const { data: sessionData } = await iosSupabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired — please sign in again.");

  const { data, error } = await cloudSupabase.functions.invoke("admin-set-maintenance", {
    body: { is_enabled: input.isEnabled, message: input.message },
    headers: { "x-vinetrack-token": token },
  });

  if (error) {
    const ctx = (error as any).context;
    try {
      const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (body?.error) throw new Error(body.error);
    } catch (e) {
      if (e instanceof Error && e.message) throw e;
    }
    throw new Error(error.message ?? "Request failed");
  }
  return data as { success: boolean };
}

export function useSaveMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveMaintenance,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-maintenance"] });
    },
  });
}
