// Phase 2F — vineyard-scoped access.
//
// Access is resolved PER VINEYARD by the shared backend (SQL 155–158). The
// portal never recomputes entitlement: every boolean, reason code, source and
// billing-authority flag below is read straight from the server payload.
//
//   get_my_vineyard_access_matrix()            -> account summary + rows
//   get_my_vineyard_access(p_vineyard_id)      -> single row
//   admin_explain_vineyard_access(p_user_id, p_vineyard_id) -> System Admin only
//
// Strict guards: a missing required field raises instead of silently
// degrading to "no access".

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";

/* ------------------------------------------------------------------ */
/* Transport + guards                                                  */
/* ------------------------------------------------------------------ */

async function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    iosSupabase as unknown as {
      rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc(name, args ?? {});
  if (error) throw error;
  return data as T;
}

export class VineyardAccessContractError extends Error {
  constructor(fn: string, detail: string) {
    super(`${fn} returned an unexpected payload (${detail}). The backend contract has changed.`);
    this.name = "VineyardAccessContractError";
  }
}

function obj(fn: string, v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new VineyardAccessContractError(fn, "expected an object");
  return v as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type MembershipRole = "owner" | "manager" | "supervisor" | "operator" | string;

/** Server reason codes for vineyard-level access decisions. */
export type VineyardAccessReason =
  | "no_vineyard_entitlement"
  | "owner_plan_not_vineyard_funding"
  | "expired"
  | "revoked"
  | "billing_attention_required"
  | string;

export interface VineyardAccessRow {
  vineyard_id: string;
  vineyard_name: string | null;
  membership_role: MembershipRole | null;
  has_vineyard_access: boolean;
  can_enter_vineyard: boolean;
  vineyard_access_reason: VineyardAccessReason | null;
  vineyard_access_source: string | null;
  plan_code: string | null;
  subscription_status: string | null;
  starts_at: string | null;
  expires_at: string | null;
  is_trial: boolean;
  is_vineyard_wide: boolean;
  is_billing_owner: boolean;
  can_manage_billing: boolean;
  is_billing_authority: boolean;
  requires_billing_attention: boolean;
  last_verified_at: string | null;
}

export interface VineyardAccountAccessSummary {
  has_any_accessible_vineyard: boolean;
  accessible_vineyard_count: number;
  pending_invitation_count: number;
  can_create_vineyard: boolean;
  account_access_state: string | null;
}

export interface VineyardAccessMatrix {
  summary: VineyardAccountAccessSummary;
  vineyards: VineyardAccessRow[];
}

function readRow(fn: string, raw: unknown): VineyardAccessRow {
  const r = obj(fn, raw);
  const id = str(r.vineyard_id);
  if (!id) throw new VineyardAccessContractError(fn, "vineyard_id must be a uuid string");
  const flag = (key: string, fallback = false): boolean =>
    typeof r[key] === "boolean" ? (r[key] as boolean) : fallback;
  const hasAccess = flag("has_vineyard_access", true);
  return {
    vineyard_id: id,
    vineyard_name: str(r.vineyard_name),
    membership_role: str(r.membership_role),
    has_vineyard_access: hasAccess,
    can_enter_vineyard: flag("can_enter_vineyard", hasAccess),
    vineyard_access_reason: str(r.vineyard_access_reason),
    vineyard_access_source: str(r.vineyard_access_source),
    plan_code: str(r.plan_code),
    subscription_status: str(r.subscription_status),
    starts_at: str(r.starts_at),
    expires_at: str(r.expires_at),
    is_trial: flag("is_trial"),
    is_vineyard_wide: flag("is_vineyard_wide"),
    is_billing_owner: flag("is_billing_owner"),
    can_manage_billing: flag("can_manage_billing"),
    is_billing_authority: flag("is_billing_authority"),
    requires_billing_attention: flag("requires_billing_attention"),
    last_verified_at: str(r.last_verified_at),
  };
}


function optBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function optNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readMatrix(fn: string, raw: unknown): VineyardAccessMatrix {
  const root = obj(fn, raw);

  // The account summary may arrive inline on the root object or nested under
  // one of several wrapper keys depending on the backend revision. Rows are
  // always authoritative, so anything the summary omits is derived from them
  // rather than failing the whole page.
  const nested = ["summary", "account", "account_summary"]
    .map((k) => root[k])
    .find((v) => v && typeof v === "object" && !Array.isArray(v)) as
    | Record<string, unknown>
    | undefined;
  const s: Record<string, unknown> = { ...root, ...(nested ?? {}) };

  const list = root.vineyards ?? root.rows ?? root.items ?? nested?.vineyards ?? [];
  if (!Array.isArray(list)) throw new VineyardAccessContractError(fn, "expected a vineyards array");
  const vineyards = list.map((r) => readRow(fn, r));
  const accessible = vineyards.filter((v) => v.can_enter_vineyard).length;

  return {
    summary: {
      has_any_accessible_vineyard:
        optBool(s.has_any_accessible_vineyard) ?? accessible > 0,
      accessible_vineyard_count: optNum(s.accessible_vineyard_count) ?? accessible,
      pending_invitation_count: optNum(s.pending_invitation_count) ?? 0,
      can_create_vineyard: optBool(s.can_create_vineyard) ?? false,
      account_access_state:
        str(s.account_access_state) ?? (accessible > 0 ? "active" : "no_access"),
    },
    vineyards,
  };
}


/* ------------------------------------------------------------------ */
/* Query keys                                                          */
/* ------------------------------------------------------------------ */

export const VINEYARD_ACCESS_KEYS = {
  root: ["vineyard-access"] as const,
  matrix: ["vineyard-access", "matrix"] as const,
  one: (vineyardId: string | null | undefined) => ["vineyard-access", vineyardId ?? null] as const,
  adminExplain: (userId: string, vineyardId: string) =>
    ["admin", "vineyard-access", userId, vineyardId] as const,
};

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export function useVineyardAccessMatrix() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...VINEYARD_ACCESS_KEYS.matrix, user?.id ?? null],
    enabled: !!user,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<VineyardAccessMatrix> =>
      readMatrix("get_my_vineyard_access_matrix", await rpc("get_my_vineyard_access_matrix")),
  });
}

export function useVineyardAccess(vineyardId: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...VINEYARD_ACCESS_KEYS.one(vineyardId), user?.id ?? null],
    enabled: !!user && !!vineyardId,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<VineyardAccessRow> => {
      const fn = "get_my_vineyard_access";
      const data = await rpc(fn, { p_vineyard_id: vineyardId });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new VineyardAccessContractError(fn, "no row returned");
      return readRow(fn, row);
    },
  });
}

/** System Admin diagnostics for one user × vineyard (never rendered to customers). */
export function useAdminExplainVineyardAccess(
  userId: string | null | undefined,
  vineyardId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: VINEYARD_ACCESS_KEYS.adminExplain(userId ?? "", vineyardId ?? ""),
    enabled: enabled && !!userId && !!vineyardId,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<Record<string, unknown>> =>
      obj(
        "admin_explain_vineyard_access",
        await rpc("admin_explain_vineyard_access", {
          p_user_id: userId,
          p_vineyard_id: vineyardId,
        }),
      ),
  });
}

/**
 * Refetch every query that can change when access changes: vineyard matrix,
 * selected-vineyard access, shared entitlement, pending invitations and
 * billing summaries.
 */
export function useRefreshVineyardAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const keys = [
        VINEYARD_ACCESS_KEYS.root,
        ["vinetrack", "access"],
        ["pending-invites"],
        ["invitations"],
        ["customer-billing"],
        ["memberships"],
      ];
      await Promise.allSettled(
        keys.map((k) => qc.refetchQueries({ queryKey: k as unknown as string[], type: "active" })),
      );
      // Anything cached but inactive should still be considered stale.
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown as string[] }));
      return true;
    },
  });
}

/** Invalidate vineyard-scoped access after an admin grant mutation. */
export function invalidateVineyardAccessCaches(
  qc: ReturnType<typeof useQueryClient>,
  opts?: { userId?: string | null; vineyardId?: string | null },
) {
  qc.invalidateQueries({ queryKey: VINEYARD_ACCESS_KEYS.root });
  qc.invalidateQueries({ queryKey: ["vinetrack", "access"] });
  qc.invalidateQueries({ queryKey: ["memberships"] });
  qc.invalidateQueries({ queryKey: ["customer-billing"] });
  if (opts?.userId && opts?.vineyardId)
    qc.invalidateQueries({
      queryKey: VINEYARD_ACCESS_KEYS.adminExplain(opts.userId, opts.vineyardId),
    });
  if (opts?.vineyardId) qc.invalidateQueries({ queryKey: ["team-members", opts.vineyardId] });
}

/* ------------------------------------------------------------------ */
/* Display helpers (wording only — never entitlement logic)            */
/* ------------------------------------------------------------------ */

export type VineyardAccessState =
  | "accessible"
  | "trial"
  | "restricted"
  | "billing_attention"
  | "expired";

/** Derived purely from server booleans / reason codes for badge display. */
export function vineyardAccessState(row: VineyardAccessRow): VineyardAccessState {
  if (row.can_enter_vineyard) {
    if (row.requires_billing_attention) return "billing_attention";
    if (row.is_trial) return "trial";
    return "accessible";
  }
  if (row.vineyard_access_reason === "expired") return "expired";
  if (row.vineyard_access_reason === "billing_attention_required") return "billing_attention";
  return "restricted";
}

export const VINEYARD_ACCESS_STATE_LABEL: Record<VineyardAccessState, string> = {
  accessible: "Accessible",
  trial: "Trial",
  restricted: "Restricted",
  billing_attention: "Billing attention",
  expired: "Expired",
};

export const VINEYARD_ACCESS_REASON_LABEL: Record<string, string> = {
  no_vineyard_entitlement: "No active plan covers this vineyard",
  owner_plan_not_vineyard_funding: "Your plan does not fund this vineyard",
  expired: "This vineyard's plan has expired",
  revoked: "Access to this vineyard was revoked",
  billing_attention_required: "This vineyard's billing needs attention",
};

export function vineyardAccessReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  return (
    VINEYARD_ACCESS_REASON_LABEL[reason] ??
    reason.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
