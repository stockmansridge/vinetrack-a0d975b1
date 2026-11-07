import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { ALLOW_READ_ONLY } from "@/lib/vineyardWriteAccess";

export type ReleasePlatform = "ios" | "android";
export interface AppReleasePolicy {
  platform: ReleasePlatform;
  latest_version: string;
  latest_build: number;
  minimum_supported_version: string;
  minimum_supported_build: number;
  update_title: string | null;
  update_message: string | null;
  store_url: string | null;
  active: boolean;
  updated_at: string | null;
}
export interface ReleaseForm {
  latest_version: string;
  latest_build: string;
  minimum_supported_version: string;
  minimum_supported_build: string;
  update_title: string;
  update_message: string;
  active: boolean;
  reason: string;
}

export function releaseForm(row: AppReleasePolicy): ReleaseForm {
  return { ...row, latest_build: String(row.latest_build), minimum_supported_build: String(row.minimum_supported_build),
    update_title: row.update_title ?? "", update_message: row.update_message ?? "", reason: "" };
}
function validBuild(value: string) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}
export function releaseValidation(form: ReleaseForm): string[] {
  const errors: string[] = [];
  if (!validBuild(form.latest_build)) errors.push("Latest build must be a whole number ≥ 0.");
  if (!validBuild(form.minimum_supported_build)) errors.push("Minimum supported build must be a whole number ≥ 0.");
  if (validBuild(form.latest_build) && validBuild(form.minimum_supported_build) && Number(form.minimum_supported_build) > Number(form.latest_build))
    errors.push("Minimum supported build cannot be above the latest build");
  if (form.update_title.length > 100) errors.push("Prompt title must be 100 characters or fewer.");
  if (form.update_message.length > 800) errors.push("Prompt message must be 800 characters or fewer.");
  if (!form.reason.trim()) errors.push("A reason is required");
  return errors;
}
export function raisesMinimum(row: AppReleasePolicy, form: ReleaseForm) {
  return Number(form.minimum_supported_build) > row.minimum_supported_build;
}
export function releaseError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}
export async function listAppReleasePolicies(): Promise<AppReleasePolicy[]> {
  const { data, error } = await supabase.rpc("admin_list_app_release_policies");
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("No release policy list was returned. Please retry.");
  return data as AppReleasePolicy[];
}
export async function saveAppReleasePolicy(platform: ReleasePlatform, form: ReleaseForm): Promise<AppReleasePolicy> {
  const errors = releaseValidation(form);
  if (errors.length) throw new Error(errors[0]);
  const { data, error } = await supabase.rpc("admin_set_app_release_policy", {
    p_platform: platform,
    p_latest_version: form.latest_version.trim(),
    p_latest_build: Number(form.latest_build),
    p_minimum_supported_version: form.minimum_supported_version.trim(),
    p_minimum_supported_build: Number(form.minimum_supported_build),
    p_update_title: form.update_title || null,
    p_update_message: form.update_message || null,
    p_active: form.active,
    p_reason: form.reason.trim(),
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data) || data.platform !== platform)
    throw new Error("The server did not return the saved policy. Refresh before trying again.");
  return data as AppReleasePolicy;
}
const RELEASE_KEY = ["system-admin", "app-releases"] as const;
export function useAppReleasePolicies() {
  const { user } = useAuth();
  const { isAdmin, loading } = useIsSystemAdmin();
  return useQuery({ queryKey: [...RELEASE_KEY, user?.id], enabled: !!user && isAdmin && !loading,
    queryFn: listAppReleasePolicies, staleTime: 0, retry: false });
}
export function useSaveAppReleasePolicy() {
  const qc = useQueryClient();
  const { isAdmin, loading } = useIsSystemAdmin();
  return useMutation({
    // Global platform policy is not a write to the selected vineyard.
    meta: ALLOW_READ_ONLY,
    retry: false,
    mutationFn: ({ platform, form }: { platform: ReleasePlatform; form: ReleaseForm }) => {
      if (!isAdmin || loading) throw new Error("System Admin access is required.");
      return saveAppReleasePolicy(platform, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: RELEASE_KEY }),
  });
}