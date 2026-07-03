// useCurrentProfile
// -----------------
// VineTrack standard: Display Name = public.profiles.full_name (server-owned,
// shared across the portal, iOS, and Android). This hook is the single source
// of truth for the signed-in user's display name inside the Lovable portal.
//
// It reads from `public.profiles` on the iOS/mobile Supabase project (which is
// the shared user database for all platforms). RLS ensures a user can only
// select / update their own row (auth.uid() = profiles.id).
//
// Fallback order for display: profiles.full_name → auth.user.email → "User".
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface CurrentProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  updated_at: string | null;
}

export function displayNameFor(
  profile: CurrentProfile | null,
  emailFallback: string | null | undefined,
): string {
  const n = profile?.full_name?.trim();
  if (n) return n;
  const e = emailFallback?.trim();
  if (e) return e;
  return "User";
}

interface State {
  profile: CurrentProfile | null;
  loading: boolean;
  error: string | null;
}

export function useCurrentProfile() {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ profile: null, loading: true, error: null });

  const load = useCallback(async () => {
    if (!user?.id) {
      setState({ profile: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const { data, error } = await (supabase as any)
      .from("profiles")
      .select("id, email, full_name, updated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      setState({ profile: null, loading: false, error: error.message });
      return;
    }

    let profile = (data as CurrentProfile | null) ?? null;

    // Optional legacy migration: if there is no profile row yet, or full_name
    // is empty, seed it from auth metadata (one-time, only when server value
    // is missing — never overwrite an existing server name).
    if (!profile) {
      const seed =
        ((user.user_metadata as any)?.full_name as string | undefined)?.trim() ||
        ((user.user_metadata as any)?.name as string | undefined)?.trim() ||
        null;
      const { data: inserted } = await (supabase as any)
        .from("profiles")
        .upsert({ id: user.id, email: user.email ?? null, full_name: seed })
        .select("id, email, full_name, updated_at")
        .maybeSingle();
      profile = (inserted as CurrentProfile | null) ?? {
        id: user.id,
        email: user.email ?? null,
        full_name: seed,
        updated_at: null,
      };
    } else if (!profile.full_name) {
      const seed =
        ((user.user_metadata as any)?.full_name as string | undefined)?.trim() ||
        ((user.user_metadata as any)?.name as string | undefined)?.trim() ||
        null;
      if (seed) {
        const { data: updated } = await (supabase as any)
          .from("profiles")
          .update({ full_name: seed, updated_at: new Date().toISOString() })
          .eq("id", user.id)
          .select("id, email, full_name, updated_at")
          .maybeSingle();
        if (updated) profile = updated as CurrentProfile;
      }
    }

    setState({ profile, loading: false, error: null });
  }, [user?.id, user?.email, user?.user_metadata]);

  useEffect(() => {
    load();
  }, [load]);

  const updateFullName = useCallback(
    async (newName: string): Promise<{ ok: boolean; error?: string }> => {
      if (!user?.id) return { ok: false, error: "Not signed in" };
      const trimmed = newName.trim();
      const { data, error } = await (supabase as any)
        .from("profiles")
        .update({ full_name: trimmed || null, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("id, email, full_name, updated_at")
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (data) setState({ profile: data as CurrentProfile, loading: false, error: null });
      return { ok: true };
    },
    [user?.id],
  );

  return { ...state, reload: load, updateFullName };
}
