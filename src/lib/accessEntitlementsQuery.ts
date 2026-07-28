// Access & Entitlements admin centre — SQL 139/140/141 RPC layer.
//
// Every read and mutation goes through System-Admin-gated RPCs on the shared
// VineTrack Supabase project. The portal never computes entitlement, never
// writes to billing / subscription / licence / entitlement tables, and never
// touches raw provider payloads.
//
// RPC signatures verified live against the backend schema cache:
//   admin_store_billing_monitor()
//   admin_billing_alerts(p_limit, p_include_acknowledged)
//   admin_acknowledge_billing_alert(p_alert_id)
//   admin_access_users(p_search, p_limit, p_offset, p_vineyard_id, p_role,
//                      p_plan_code, p_billing_source)
//   admin_user_access_detail(p_user_id)
//   admin_user_access_history(p_user_id)
//   admin_list_billing_grants()
//   admin_create_billing_grant(p_owner_user_id, p_grant_type, p_reason,
//                              [p_vineyard_id, p_starts_at, p_expires_at])
//   admin_extend_billing_grant(p_subscription_id, p_reason, p_new_expires_at)
//   admin_revoke_billing_grant(p_subscription_id, p_reason, [p_revoke_licences])
//   admin_assign_licence(p_subscription_id, p_user_id, p_reason, [p_vineyard_id])
//   admin_remove_licence(p_licence_id, p_reason)
//   admin_refresh_user_entitlement(p_user_id)

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

export type Rec = Record<string, any>;

export async function adminRpc<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (iosSupabase as any).rpc(name, args ?? {});
  if (error) throw error;
  return data as T;
}

/** First non-empty value across candidate field names (tolerant field mapping). */
export function pick<T = any>(o: Rec | null | undefined, ...keys: string[]): T | null {
  if (!o) return null;
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

export function asRows(v: unknown): Rec[] {
  if (Array.isArray(v)) return v as Rec[];
  if (v && typeof v === "object") return [v as Rec];
  return [];
}

export function asObject(v: unknown): Rec | null {
  if (Array.isArray(v)) return (v[0] as Rec) ?? null;
  if (v && typeof v === "object") return v as Rec;
  return null;
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function isPermissionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const msg = (e?.message ?? "").toLowerCase();
  return e?.code === "42501" || msg.includes("system admin") || msg.includes("permission");
}

export function friendlyError(err: unknown): string {
  if (!err) return "";
  if (isPermissionError(err))
    return "You do not have permission to view global access and entitlement information.";
  const e = err as { message?: string };
  return e?.message ?? "Something went wrong loading this data.";
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const ACCESS_REASON_LABEL: Record<string, string> = {
  internal_unlimited: "Internal Unlimited",
  complimentary_solo: "Complimentary Solo",
  complimentary_team: "Complimentary Team",
  beta_tester: "Beta Tester",
  temporary_access: "Temporary Access",
  support_access: "Support Access",
  enterprise_contract: "Enterprise Contract",
  portal_subscription: "Portal Subscription",
  assigned_licence: "Assigned Licence",
  app_store_subscription: "App Store Subscription",
  play_store_subscription: "Play Store Subscription",
  active_trial: "Active Trial",
  trial: "Active Trial",
  expired: "Expired",
  revoked: "Revoked",
  cancelled: "Cancelled",
  no_entitlement: "No Entitlement",
  none: "No Entitlement",
  needs_review: "Needs Review",
};

export const BILLING_SOURCE_LABEL: Record<string, string> = {
  apple: "Apple App Store",
  app_store: "Apple App Store",
  ios: "Apple App Store",
  google: "Google Play",
  google_play: "Google Play",
  play: "Google Play",
  android: "Google Play",
  stripe: "Portal Billing",
  portal: "Portal Billing",
  manual: "Manual Grant",
  manual_grant: "Manual Grant",
  internal: "Internal Access",
  internal_grant: "Internal Grant",
  licence: "Assigned Licence",
  assigned_licence: "Assigned Licence",
  trial: "Trial",
  none: "No Billing Source",
};

export const PLATFORM_LABEL: Record<string, string> = {
  ios: "iOS",
  apple: "iOS",
  android: "Android",
  google: "Android",
  google_play: "Android",
  web: "Portal",
  portal: "Portal",
  stripe: "Portal",
  none: "None",
};

export const GRANT_TYPES = [
  { value: "internal_unlimited", label: "Internal Unlimited", requiresExpiry: false },
  { value: "complimentary_solo", label: "Complimentary Solo", requiresExpiry: false },
  { value: "complimentary_team", label: "Complimentary Team", requiresExpiry: false },
  { value: "beta_tester", label: "Beta Tester", requiresExpiry: false },
  { value: "temporary_access", label: "Temporary Access", requiresExpiry: true },
  { value: "support_access", label: "Support Access", requiresExpiry: true },
  { value: "enterprise_contract", label: "Enterprise Contract", requiresExpiry: false },
] as const;

export type GrantType = (typeof GRANT_TYPES)[number]["value"];

function humanise(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function labelFor(map: Record<string, string>, raw: unknown, fallback = "—"): string {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const key = String(raw).toLowerCase();
  return map[key] ?? humanise(String(raw));
}

export const accessReasonLabel = (r: unknown) => labelFor(ACCESS_REASON_LABEL, r);
export const billingSourceLabel = (s: unknown) =>
  labelFor(BILLING_SOURCE_LABEL, s, "No Billing Source");
export const platformLabel = (p: unknown) => labelFor(PLATFORM_LABEL, p, "None");
export const grantTypeLabel = (t: unknown) =>
  GRANT_TYPES.find((g) => g.value === String(t))?.label ?? labelFor(ACCESS_REASON_LABEL, t);

/** Server-authoritative lifecycle wording. Never recomputed from browser time. */
export function lifecycleLabel(row: Rec | null | undefined): string {
  const status = String(pick(row, "subscription_status", "status", "lifecycle_status") ?? "")
    .toLowerCase();
  const cancelAtEnd =
    pick(row, "cancel_at_period_end", "cancels_at_period_end", "cancel_at_end") === true;
  const grace =
    pick(row, "in_grace_period", "is_in_grace_period", "grace_period_active") === true;
  if (status === "needs_review") return "Needs Review";
  if (status === "expired") return "Expired";
  if (status === "revoked") return "Revoked";
  if (grace) return "Active — billing grace period";
  if (cancelAtEnd && (status === "active" || status === "trialing"))
    return "Active — cancels at period end";
  if (status === "trialing") return "Trial";
  if (!status) return "—";
  return humanise(status);
}

/** Locale date-time with timezone clarity. */
export function fmtDateTime(iso: unknown): string {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function fmtDateOnly(iso: unknown): string {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Query keys                                                          */
/* ------------------------------------------------------------------ */

export const AE_KEYS = {
  root: ["admin", "access-entitlements"] as const,
  monitor: ["admin", "access-entitlements", "monitor"] as const,
  alerts: (includeAcknowledged: boolean, limit: number) =>
    ["admin", "access-entitlements", "alerts", includeAcknowledged, limit] as const,
  users: (params: AccessUsersParams) =>
    ["admin", "access-entitlements", "users", params] as const,
  usersAll: ["admin", "access-entitlements", "users"] as const,
  detail: (userId: string) => ["admin", "access-entitlements", "detail", userId] as const,
  history: (userId: string) => ["admin", "access-entitlements", "history", userId] as const,
  grants: ["admin", "access-entitlements", "grants"] as const,
};

/* ------------------------------------------------------------------ */
/* Billing health monitor (SQL 139)                                    */
/* ------------------------------------------------------------------ */

export interface BillingMonitor extends Rec {
  needs_review?: number;
  failed_events?: number;
  unknown_products?: number;
  unresolved_users?: number;
  ownership_conflicts?: number;
  sync_delays?: number;
  expiring_soon?: number;
  recent_changes?: number;
}

export function useBillingMonitor() {
  return useQuery({
    queryKey: AE_KEYS.monitor,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<BillingMonitor> =>
      asObject(await adminRpc("admin_store_billing_monitor")) ?? {},
  });
}

/* ------------------------------------------------------------------ */
/* Billing alerts                                                      */
/* ------------------------------------------------------------------ */

export interface BillingAlert extends Rec {
  id?: string;
  severity?: string;
  alert_type?: string;
  created_at?: string;
  acknowledged_at?: string | null;
}

export function alertId(a: Rec): string {
  return String(pick(a, "alert_id", "id") ?? "");
}

export function alertSeverity(a: Rec): "critical" | "warning" | "info" {
  const s = String(pick(a, "severity", "level", "alert_severity") ?? "info").toLowerCase();
  if (s.startsWith("crit") || s === "error" || s === "high") return "critical";
  if (s.startsWith("warn") || s === "medium") return "warning";
  return "info";
}

export function useBillingAlerts(opts: { includeAcknowledged: boolean; limit?: number }) {
  const limit = opts.limit ?? 100;
  return useQuery({
    queryKey: AE_KEYS.alerts(opts.includeAcknowledged, limit),
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<BillingAlert[]> =>
      asRows(
        await adminRpc("admin_billing_alerts", {
          p_limit: limit,
          p_include_acknowledged: opts.includeAcknowledged,
        }),
      ),
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { alertId: string }) =>
      adminRpc("admin_acknowledge_billing_alert", { p_alert_id: args.alertId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "access-entitlements", "alerts"] });
      qc.invalidateQueries({ queryKey: AE_KEYS.monitor });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Users & access directory (server paginated / filtered)              */
/* ------------------------------------------------------------------ */

export interface AccessUsersParams {
  search: string;
  limit: number;
  offset: number;
  vineyardId: string | null;
  role: string | null;
  planCode: string | null;
  billingSource: string | null;
}

export interface AccessUserRow extends Rec {
  user_id?: string;
  email?: string;
  full_name?: string;
}

export function userIdOf(row: Rec): string {
  return String(pick(row, "user_id", "id", "auth_user_id") ?? "");
}

export function accessGranted(row: Rec | null | undefined): boolean {
  const v = pick(row, "has_access", "access_granted", "effective_access", "is_active");
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "granted", "active", "yes"].includes(v.toLowerCase());
  return false;
}

export function useAccessUsers(params: AccessUsersParams) {
  return useQuery({
    queryKey: AE_KEYS.users(params),
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ rows: AccessUserRow[]; total: number | null }> => {
      const data = await adminRpc("admin_access_users", {
        p_search: params.search || null,
        p_limit: params.limit,
        p_offset: params.offset,
        p_vineyard_id: params.vineyardId,
        p_role: params.role,
        p_plan_code: params.planCode,
        p_billing_source: params.billingSource,
      });
      const rows = asRows(data);
      const totalRaw = rows.length
        ? pick(rows[0], "total_count", "total_results", "total", "result_count")
        : null;
      return { rows, total: totalRaw == null ? null : num(totalRaw, 0) };
    },
  });
}

/* ------------------------------------------------------------------ */
/* User detail + history                                               */
/* ------------------------------------------------------------------ */

export function useUserAccessDetail(userId: string | null) {
  return useQuery({
    queryKey: AE_KEYS.detail(userId ?? "none"),
    enabled: !!userId,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<Rec | null> =>
      asObject(await adminRpc("admin_user_access_detail", { p_user_id: userId })),
  });
}

export function useUserAccessHistory(userId: string | null) {
  return useQuery({
    queryKey: AE_KEYS.history(userId ?? "none"),
    enabled: !!userId,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<Rec[]> =>
      asRows(await adminRpc("admin_user_access_history", { p_user_id: userId })),
  });
}

/** Detail sections, tolerant to either nested jsonb or flat row shapes. */
export function detailSection(detail: Rec | null | undefined, ...keys: string[]): Rec[] {
  for (const k of keys) {
    const v = detail?.[k];
    if (Array.isArray(v)) return v as Rec[];
    if (v && typeof v === "object") return [v as Rec];
  }
  return [];
}

export function detailObject(detail: Rec | null | undefined, ...keys: string[]): Rec | null {
  for (const k of keys) {
    const v = detail?.[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Rec;
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v[0] as Rec;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Billing grants                                                      */
/* ------------------------------------------------------------------ */

export interface BillingGrantRow extends Rec {
  subscription_id?: string;
  grant_type?: string;
}

export function grantSubscriptionId(g: Rec): string {
  return String(pick(g, "subscription_id", "grant_id", "id") ?? "");
}

export function grantStatus(g: Rec): "active" | "expired" | "revoked" {
  const explicit = String(pick(g, "grant_state", "state") ?? "").toLowerCase();
  if (explicit === "active" || explicit === "expired" || explicit === "revoked") return explicit;
  if (pick(g, "manual_grant_revoked_at", "revoked_at")) return "revoked";
  const status = String(pick(g, "status") ?? "").toLowerCase();
  if (status === "expired") return "expired";
  if (status === "revoked" || status === "cancelled") return "revoked";
  return "active";
}

export function useBillingGrants() {
  return useQuery({
    queryKey: AE_KEYS.grants,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<BillingGrantRow[]> =>
      asRows(await adminRpc("admin_list_billing_grants")),
  });
}

function useAfterMutation() {
  const qc = useQueryClient();
  return (userId?: string | null) => {
    qc.invalidateQueries({ queryKey: AE_KEYS.usersAll });
    qc.invalidateQueries({ queryKey: AE_KEYS.grants });
    qc.invalidateQueries({ queryKey: AE_KEYS.monitor });
    qc.invalidateQueries({ queryKey: ["admin", "access-entitlements", "alerts"] });
    if (userId) {
      qc.invalidateQueries({ queryKey: AE_KEYS.detail(userId) });
      qc.invalidateQueries({ queryKey: AE_KEYS.history(userId) });
    }
  };
}

export function useCreateBillingGrant() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      userId: string;
      grantType: GrantType | string;
      reason: string;
      vineyardId?: string | null;
      startsAt?: string | null;
      expiresAt?: string | null;
    }) =>
      adminRpc("admin_create_billing_grant", {
        p_owner_user_id: args.userId,
        p_grant_type: args.grantType,
        p_reason: args.reason,
        p_vineyard_id: args.vineyardId ?? null,
        p_starts_at: args.startsAt ?? null,
        p_expires_at: args.expiresAt ?? null,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export function useExtendBillingGrant() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      subscriptionId: string;
      reason: string;
      newExpiresAt: string;
      userId?: string | null;
    }) =>
      adminRpc("admin_extend_billing_grant", {
        p_subscription_id: args.subscriptionId,
        p_reason: args.reason,
        p_new_expires_at: args.newExpiresAt,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export function useRevokeBillingGrant() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      subscriptionId: string;
      reason: string;
      revokeLicences?: boolean;
      userId?: string | null;
    }) =>
      adminRpc("admin_revoke_billing_grant", {
        p_subscription_id: args.subscriptionId,
        p_reason: args.reason,
        p_revoke_licences: args.revokeLicences ?? true,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

/* ------------------------------------------------------------------ */
/* Licences                                                            */
/* ------------------------------------------------------------------ */

export function useAssignLicence() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: {
      subscriptionId: string;
      userId: string;
      reason: string;
      vineyardId?: string | null;
    }) =>
      adminRpc("admin_assign_licence", {
        p_subscription_id: args.subscriptionId,
        p_user_id: args.userId,
        p_reason: args.reason,
        p_vineyard_id: args.vineyardId ?? null,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

export function useRemoveLicence() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: { licenceId: string; reason: string; userId?: string | null }) =>
      adminRpc("admin_remove_licence", {
        p_licence_id: args.licenceId,
        p_reason: args.reason,
      }),
    onSuccess: (_d, v) => after(v.userId),
  });
}

/* ------------------------------------------------------------------ */
/* Entitlement refresh                                                 */
/* ------------------------------------------------------------------ */

export function useRefreshUserEntitlement() {
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (args: { userId: string }) =>
      adminRpc("admin_refresh_user_entitlement", { p_user_id: args.userId }),
    onSuccess: (_d, v) => after(v.userId),
  });
}
