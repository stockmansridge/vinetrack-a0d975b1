// Typed wrappers for the shared System Admin RPCs on the iOS-shared Supabase project.
// All RPCs are gated server-side by public.is_system_admin().

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";

const QK = {
  engagement: ["admin", "engagement"] as const,
  users: ["admin", "users"] as const,
  vineyards: ["admin", "vineyards"] as const,
  userVineyards: (id: string) => ["admin", "user-vineyards", id] as const,
  invitations: ["admin", "invitations"] as const,
  pins: (limit: number) => ["admin", "pins", limit] as const,
  spray: (limit: number) => ["admin", "spray", limit] as const,
  workTasks: (limit: number) => ["admin", "work-tasks", limit] as const,
  paddocks: (vineyardId: string) => ["admin", "paddocks", vineyardId] as const,
  systemAdmins: ["admin", "system-admins"] as const,
};

// ---------- Types ----------

export interface AdminEngagementSummary {
  total_users: number;
  total_vineyards: number;
  total_pins: number;
  total_spray_records: number;
  total_work_tasks: number;
  signed_in_last_7_days: number;
  signed_in_last_30_days: number;
  new_users_last_30_days: number;
  pending_invitations: number;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_sign_in_at: string | null;
  vineyard_count: number;
  owned_count: number;
  block_count: number | null;
}

export interface AdminVineyard {
  id: string;
  name: string;
  owner_id: string | null;
  owner_email: string | null;
  owner_full_name: string | null;
  country: string | null;
  created_at: string | null;
  deleted_at: string | null;
  member_count: number;
  pending_invites: number;
}

export interface AdminUserVineyard {
  id: string;
  name: string;
  role: string | null;
  is_owner: boolean;
  country: string | null;
  created_at: string | null;
  deleted_at: string | null;
  member_count: number;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  vineyard_id: string | null;
  vineyard_name: string | null;
  invited_by: string | null;
  invited_by_email: string | null;
  created_at: string | null;
  expires_at: string | null;
}

export interface AdminPin {
  id: string;
  vineyard_id: string | null;
  vineyard_name: string | null;
  title: string;
  category: string | null;
  status: string | null;
  created_at: string | null;
  is_completed: boolean;
}

export interface AdminSprayRecord {
  id: string;
  vineyard_id: string | null;
  vineyard_name: string | null;
  spray_reference: string | null;
  operation_type: string | null;
  date: string | null;
  created_at: string | null;
}

export interface AdminWorkTask {
  id: string;
  vineyard_id: string | null;
  vineyard_name: string | null;
  task_type: string | null;
  paddock_name: string | null;
  date: string | null;
  duration_hours: number | null;
  created_at: string | null;
}

export interface AdminPaddock {
  id: string;
  vineyard_id: string;
  name: string;
  polygon_points: Array<{ latitude: number; longitude: number }> | null;
  rows: unknown[] | null;
  row_count: number | null;
  row_direction: string | null;
  row_width: number | null;
  vine_spacing: number | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface SystemAdminRow {
  user_id: string;
  email: string;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
}

// ---------- Hooks ----------

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (iosSupabase as any).rpc(name, args ?? {});
  if (error) throw error;
  return data as T;
}

export function useEngagementSummary() {
  return useQuery({
    queryKey: QK.engagement,
    staleTime: 30_000,
    queryFn: async () => {
      const data = await rpc<AdminEngagementSummary[] | AdminEngagementSummary>(
        "admin_engagement_summary",
      );
      return Array.isArray(data) ? data[0] : data;
    },
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: QK.users,
    staleTime: 30_000,
    queryFn: () => rpc<AdminUser[]>("admin_list_users").then((d) => d ?? []),
  });
}

export function useAdminVineyards() {
  return useQuery({
    queryKey: QK.vineyards,
    staleTime: 30_000,
    queryFn: () => rpc<AdminVineyard[]>("admin_list_vineyards").then((d) => d ?? []),
  });
}

export function useAdminUserVineyards(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? QK.userVineyards(userId) : ["admin", "user-vineyards", "none"],
    enabled: !!userId,
    queryFn: () =>
      rpc<AdminUserVineyard[]>("admin_list_user_vineyards", { p_user_id: userId }).then(
        (d) => d ?? [],
      ),
  });
}

export function useAdminInvitations() {
  return useQuery({
    queryKey: QK.invitations,
    queryFn: () => rpc<AdminInvitation[]>("admin_list_invitations").then((d) => d ?? []),
  });
}

export function useAdminPins(limit = 500) {
  return useQuery({
    queryKey: QK.pins(limit),
    queryFn: () => rpc<AdminPin[]>("admin_list_pins", { p_limit: limit }).then((d) => d ?? []),
  });
}

export function useAdminSprayRecords(limit = 500) {
  return useQuery({
    queryKey: QK.spray(limit),
    queryFn: () =>
      rpc<AdminSprayRecord[]>("admin_list_spray_records", { p_limit: limit }).then((d) => d ?? []),
  });
}

export function useAdminWorkTasks(limit = 500) {
  return useQuery({
    queryKey: QK.workTasks(limit),
    queryFn: () =>
      rpc<AdminWorkTask[]>("admin_list_work_tasks", { p_limit: limit }).then((d) => d ?? []),
  });
}

export function useAdminVineyardPaddocks(vineyardId: string | undefined) {
  return useQuery({
    queryKey: vineyardId ? QK.paddocks(vineyardId) : ["admin", "paddocks", "none"],
    enabled: !!vineyardId,
    queryFn: () =>
      rpc<AdminPaddock[]>("admin_list_vineyard_paddocks", { p_vineyard_id: vineyardId }).then(
        (d) => d ?? [],
      ),
  });
}

// System admins management
export function useSystemAdmins() {
  return useQuery({
    queryKey: QK.systemAdmins,
    queryFn: () => rpc<SystemAdminRow[]>("list_system_admins").then((d) => d ?? []),
  });
}

export function useAddSystemAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => rpc<SystemAdminRow>("add_system_admin", { p_email: email }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.systemAdmins }),
  });
}

export function useSetSystemAdminActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: string; isActive: boolean }) =>
      rpc<SystemAdminRow>("set_system_admin_active", {
        p_user_id: args.userId,
        p_is_active: args.isActive,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.systemAdmins }),
  });
}
