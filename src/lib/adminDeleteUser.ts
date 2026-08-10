// System-admin user deletion (edge function `admin-delete-user`).
//
// The edge function runs on Lovable Cloud but acts on the VineTrack
// (iOS-shared) project, so it must be called with the VineTrack session
// token — not the Lovable Cloud one.
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";

export interface DeleteUserVineyard {
  id: string;
  name: string | null;
  reason?: string;
}

export interface DeleteUserPreview {
  user: { id: string; email: string | null; full_name: string | null };
  vineyards_to_delete: DeleteUserVineyard[];
  vineyards_to_keep: DeleteUserVineyard[];
}

export interface DeleteUserResult extends DeleteUserPreview {
  success?: boolean;
  errors?: string[];
  deleted_vineyards?: DeleteUserVineyard[];
  kept_vineyards?: DeleteUserVineyard[];
}

async function invoke(userId: string, mode: "preview" | "delete") {
  const { data: sessionData } = await iosSupabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired — please sign in again.");

  const { data, error } = await cloudSupabase.functions.invoke("admin-delete-user", {
    body: { user_id: userId, mode },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    // Surface the function's JSON error message when present.
    const ctx = (error as any).context;
    try {
      const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (body?.error) throw new Error(body.error);
    } catch (e) {
      if (e instanceof Error && e.message) throw e;
    }
    throw new Error(error.message ?? "Request failed");
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as DeleteUserResult;
}

export const previewUserDeletion = (userId: string) => invoke(userId, "preview");
export const deleteUserPermanently = (userId: string) => invoke(userId, "delete");
