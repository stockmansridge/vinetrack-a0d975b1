// Stage 4 — Integrations & API management (portal surface only).
//
// Every read and write in this module goes through the canonical integration
// RPCs that already exist on the shared VineTrack backend (SQL 172 / Stage 2).
// The portal NEVER inserts, updates or deletes integration tables directly and
// never derives authority locally — the RPCs are the authority. Role checks in
// the UI only decide which controls are *rendered*; the backend still decides
// what is allowed.
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

// ---------------------------------------------------------------------------
// Types (defensive — RPC payload shapes are normalised, never assumed)
// ---------------------------------------------------------------------------

export type IntegrationStatus = "active" | "paused" | "revoked" | string;

export interface IntegrationClient {
  id: string;
  name: string;
  description: string | null;
  integration_type: string;
  status: IntegrationStatus;
  created_at: string | null;
  updated_at: string | null;
  paused_at: string | null;
  revoked_at: string | null;
  last_request_at: string | null;
  vineyard_count: number | null;
  scope_count: number | null;
  api_key_count: number | null;
  raw: Record<string, unknown>;
}

export interface IntegrationVineyardGrant {
  vineyard_id: string;
  vineyard_name: string | null;
  granted_at: string | null;
  granted_by_name: string | null;
  revoked_at: string | null;
}

export interface IntegrationScopeRow {
  scope: string;
  module: string;
  access: "read" | "write" | string;
  is_sensitive: boolean;
  description: string | null;
  granted: boolean;
  granted_at: string | null;
}

export interface IntegrationApiKey {
  id: string;
  name: string | null;
  key_prefix: string | null;
  environment: string | null;
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface IntegrationAuditEntry {
  id: string;
  created_at: string | null;
  action: string;
  actor: string | null;
  vineyard_id: string | null;
  vineyard_name: string | null;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Query keys — scoped by integration client id so mutations invalidate narrowly
// ---------------------------------------------------------------------------

export const INTEGRATION_KEYS = {
  root: ["integrations"] as const,
  clients: ["integrations", "clients"] as const,
  catalog: ["integrations", "scope-catalog"] as const,
  client: (id: string) => ["integrations", "client", id] as const,
  vineyards: (id: string) => ["integrations", "client", id, "vineyards"] as const,
  scopes: (id: string) => ["integrations", "client", id, "scopes"] as const,
  keys: (id: string) => ["integrations", "client", id, "api-keys"] as const,
  audit: (id: string) => ["integrations", "client", id, "audit"] as const,
  requests: (id: string) => ["integrations", "client", id, "api-requests"] as const,
};

// ---------------------------------------------------------------------------
// Error mapping — backend codes → portal-safe copy (raw text kept for console)
// ---------------------------------------------------------------------------

export const INTEGRATION_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Your session has expired. Please sign in again.",
  authentication_required: "Your session has expired. Please sign in again.",
  not_authorised: "You do not have permission to perform this action.",
  not_authorized: "You do not have permission to perform this action.",
  owner_required: "Only a Vineyard Owner can manage integrations.",
  integration_not_found:
    "This integration could not be found or you no longer have access.",
  client_not_found:
    "This integration could not be found or you no longer have access.",
  invalid_scope: "That API permission is not available.",
  scope_not_found: "That API permission is not available.",
  write_scopes_not_available:
    "Write permissions are not available — the VineTrack API is read-only.",
  invalid_status: "That integration status change is not supported.",
  integration_revoked:
    "This integration has been revoked and can no longer be changed.",
  vineyard_not_found: "That vineyard could not be found.",
  vineyard_not_granted: "That vineyard is not granted to this integration.",
  api_key_not_found: "That API key could not be found.",
  invalid_environment: "That API key environment is not available.",
  invalid_name: "Please enter a valid name.",
  invalid_integration_type: "That integration type is not supported.",
};

const GENERIC_INTEGRATION_ERROR =
  "Something went wrong. Please try again shortly.";

export function integrationErrorMessage(input: unknown): string {
  const raw =
    typeof input === "string"
      ? input
      : input && typeof input === "object" && "message" in input
        ? String((input as { message?: unknown }).message ?? "")
        : "";
  if (!raw) return GENERIC_INTEGRATION_ERROR;
  const key = raw.trim().toLowerCase();
  if (INTEGRATION_ERROR_MESSAGES[key]) return INTEGRATION_ERROR_MESSAGES[key];
  for (const [code, message] of Object.entries(INTEGRATION_ERROR_MESSAGES)) {
    if (key.includes(code)) return message;
  }
  if (/failed to fetch|networkerror|network request failed/i.test(raw)) {
    return "Network error. Check your connection and try again.";
  }
  // Never surface Postgres internals / stack traces to the portal user.
  if (/^(pgrst|22|23|42|p0)/i.test(key) || /\bsql\b|function|relation/i.test(key)) {
    return GENERIC_INTEGRATION_ERROR;
  }
  return raw.length <= 140 ? raw : GENERIC_INTEGRATION_ERROR;
}

// ---------------------------------------------------------------------------
// Presentation helpers (labels only — never an alternative source of truth)
// ---------------------------------------------------------------------------

export const INTEGRATION_TYPE_LABELS: Record<string, string> = {
  custom_api: "Custom API",
  custom_webhook: "Custom Webhook",
  managed_integration: "Managed Integration",
};

export function integrationTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return INTEGRATION_TYPE_LABELS[value] ?? titleise(value);
}

export const SCOPE_MODULE_GROUPS: { id: string; label: string; modules: string[] }[] = [
  { id: "vineyard", label: "Vineyard", modules: ["vineyard_structure"] },
  {
    id: "operations",
    label: "Operations",
    modules: [
      "trips",
      "sprays",
      "fuel",
      "equipment",
      "work",
      "pruning",
      "irrigation",
      "growth",
      "yield",
      "pins",
    ],
  },
  { id: "environment", label: "Environment", modules: ["environment"] },
  { id: "sensitive", label: "Sensitive", modules: ["sensitive"] },
];

export const SCOPE_LABELS: Record<string, string> = {
  "vineyards:read": "Vineyards — Read",
  "blocks:read": "Blocks — Read",
  "trips:read": "Trips — Read",
  "sprays:read": "Spray Records — Read",
  "fuel:read": "Fuel — Read",
  "equipment:read": "Equipment — Read",
  "work_tasks:read": "Work Tasks — Read",
  "pruning:read": "Pruning — Read",
  "irrigation:read": "Irrigation — Read",
  "growth_stages:read": "Growth Stages — Read",
  "yield:read": "Yield — Read",
  "pins:read": "Pins — Read",
  "weather:read": "Weather — Read",
  "rainfall:read": "Rainfall — Read",
  "disease_risk:read": "Disease Risk — Read",
  "labour:read": "Labour — Read",
  "costs:read": "Costs — Read",
  "team:read": "Team — Read",
};

export function scopeLabel(scope: string): string {
  if (SCOPE_LABELS[scope]) return SCOPE_LABELS[scope];
  const [resource, access] = scope.split(":");
  return `${titleise(resource ?? scope)} — ${titleise(access ?? "")}`.trim();
}

/** Sensitive scopes never imply resource access on their own. */
export const SENSITIVE_SCOPE_NOTES: Record<string, string> = {
  "costs:read":
    "Allows approved monetary fields such as fuel purchase costs and operational cost values. Does not grant access to a resource on its own.",
  "labour:read":
    "Allows approved worker/operator identity fields attached to operational records the integration can already read.",
  "team:read":
    "Reserved for future team-level integration access. Does not grant resource access on its own.",
};

/** Sensitive scopes gate approved cost/labour/team fields, not resources. */
export function isSensitiveScope(scope: string): boolean {
  return Object.prototype.hasOwnProperty.call(SENSITIVE_SCOPE_NOTES, scope);
}

/** The external API is read-only; write scopes exist in the catalog but cannot be granted. */
export function isWriteScope(scope: string): boolean {
  return scope.split(":")[1] === "write";
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "integration.created": "Integration created",
  "integration.updated": "Integration updated",
  "integration.paused": "Integration paused",
  "integration.reactivated": "Integration reactivated",
  "integration.revoked": "Integration revoked",
  "api_key.created": "API key created",
  "api_key.revoked": "API key revoked",
  "scope.granted": "Permission granted",
  "scope.revoked": "Permission removed",
  "vineyard_access.granted": "Vineyard access granted",
  "vineyard_access.revoked": "Vineyard access removed",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? titleise(action.replace(/[._]/g, " "));
}

export function titleise(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

const asArray = (data: unknown): Record<string, any>[] => {
  if (Array.isArray(data)) return data as Record<string, any>[];
  if (data && typeof data === "object") return [data as Record<string, any>];
  return [];
};

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "string" && v !== "" && !isNaN(Number(v)) ? Number(v) : null;

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

export function normaliseClient(row: Record<string, any>): IntegrationClient {
  return {
    id: String(row.id ?? row.client_id ?? row.integration_client_id ?? ""),
    name: String(row.name ?? row.integration_name ?? "Untitled integration"),
    description: str(row.description),
    integration_type: String(row.integration_type ?? row.type ?? "custom_api"),
    status: String(row.status ?? "active"),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    paused_at: str(row.paused_at),
    revoked_at: str(row.revoked_at),
    last_request_at:
      str(row.last_request_at) ??
      str(row.last_api_activity_at) ??
      str(row.last_used_at) ??
      null,
    vineyard_count: num(row.vineyard_count ?? row.vineyards_count ?? row.granted_vineyards),
    scope_count: num(row.scope_count ?? row.scopes_count ?? row.granted_scopes),
    api_key_count: num(row.api_key_count ?? row.api_keys_count ?? row.active_api_keys),
    raw: row,
  };
}

function normaliseGrant(row: Record<string, any>): IntegrationVineyardGrant {
  return {
    vineyard_id: String(row.vineyard_id ?? row.id ?? ""),
    vineyard_name: str(row.vineyard_name ?? row.name),
    granted_at: str(row.granted_at ?? row.created_at),
    granted_by_name: str(row.granted_by_name ?? row.granted_by_email ?? row.granted_by),
    revoked_at: str(row.revoked_at),
  };
}

/** True when the RPC row carries an explicit granted flag. */
function grantedFlag(row: Record<string, any>): boolean | null {
  if (typeof row.granted === "boolean") return row.granted;
  if (typeof row.is_granted === "boolean") return row.is_granted;
  if ("granted_at" in row) return !!row.granted_at && !row.revoked_at;
  return null;
}

export function normaliseScopeRows(
  rpcRows: Record<string, any>[],
  catalog: Record<string, any>[],
): IntegrationScopeRow[] {
  const catalogById = new Map<string, Record<string, any>>();
  for (const c of catalog) if (c.scope) catalogById.set(String(c.scope), c);

  const byScope = new Map<string, IntegrationScopeRow>();
  const put = (row: Record<string, any>, granted: boolean) => {
    const scope = String(row.scope ?? "");
    if (!scope) return;
    const cat = catalogById.get(scope) ?? {};
    const existing = byScope.get(scope);
    byScope.set(scope, {
      scope,
      module: String(row.module ?? cat.module ?? "other"),
      access: String(row.access ?? cat.access ?? (scope.endsWith(":write") ? "write" : "read")),
      is_sensitive: Boolean(row.is_sensitive ?? cat.is_sensitive ?? false),
      description: str(row.description) ?? str(cat.description),
      granted: granted || Boolean(existing?.granted),
      granted_at: str(row.granted_at) ?? existing?.granted_at ?? null,
    });
  };

  for (const c of catalog) put(c, false);
  for (const r of rpcRows) {
    const flag = grantedFlag(r);
    // No explicit flag ⇒ the RPC returns granted scopes only.
    put(r, flag === null ? true : flag);
  }
  return [...byScope.values()].sort((a, b) => a.scope.localeCompare(b.scope));
}

function normaliseApiKey(row: Record<string, any>): IntegrationApiKey {
  return {
    id: String(row.id ?? row.key_id ?? row.api_key_id ?? ""),
    name: str(row.name ?? row.key_name),
    key_prefix: str(row.key_prefix ?? row.prefix),
    environment: str(row.environment),
    created_at: str(row.created_at),
    expires_at: str(row.expires_at),
    last_used_at: str(row.last_used_at),
    revoked_at: str(row.revoked_at),
  };
}

function normaliseAudit(row: Record<string, any>, i: number): IntegrationAuditEntry {
  return {
    id: String(row.id ?? `${row.created_at ?? ""}-${i}`),
    created_at: str(row.created_at),
    action: String(row.action ?? "unknown"),
    actor:
      str(row.actor_name) ??
      str(row.actor_email) ??
      str(row.actor_full_name) ??
      str(row.actor_user_id),
    vineyard_id: str(row.vineyard_id),
    vineyard_name: str(row.vineyard_name),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    // Developer diagnostics keep raw context; the UI shows mapped copy only.
    console.error(`[integrations] ${fn} failed`, error);
    throw error;
  }
  return data;
}

export function useIntegrationClients(enabled = true) {
  return useQuery({
    queryKey: INTEGRATION_KEYS.clients,
    enabled,
    queryFn: async () => asArray(await rpc("integration_list_clients")).map(normaliseClient),
  });
}

export function useIntegrationClient(clientId: string | undefined) {
  const list = useIntegrationClients(!!clientId);
  const client = list.data?.find((c) => c.id === clientId) ?? null;
  return { ...list, client };
}

/** Canonical scope catalogue. Read directly from the catalogue table when RLS
 *  permits; if it does not, the grant RPC response is the only source and the
 *  UI degrades to showing granted scopes only. */
export function useScopeCatalog() {
  return useQuery({
    queryKey: INTEGRATION_KEYS.catalog,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_scope_catalog" as never)
        .select("scope, module, access, is_sensitive, description");
      if (error) {
        console.warn("[integrations] scope catalogue unreadable", error);
        return [] as Record<string, any>[];
      }
      return asArray(data);
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useIntegrationVineyards(clientId: string | undefined) {
  return useQuery({
    queryKey: INTEGRATION_KEYS.vineyards(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async () =>
      asArray(await rpc("integration_list_vineyard_grants", { p_client_id: clientId }))
        .map(normaliseGrant)
        .filter((g) => !g.revoked_at),
  });
}

export function useIntegrationScopes(clientId: string | undefined) {
  const catalog = useScopeCatalog();
  const query = useQuery({
    queryKey: INTEGRATION_KEYS.scopes(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async () => asArray(await rpc("integration_list_scopes", { p_client_id: clientId })),
  });
  const rows = normaliseScopeRows(query.data ?? [], catalog.data ?? []);
  return {
    ...query,
    rows,
    catalogAvailable: (catalog.data ?? []).length > 0,
    isLoading: query.isLoading || catalog.isLoading,
  };
}

export function useIntegrationApiKeys(clientId: string | undefined) {
  return useQuery({
    queryKey: INTEGRATION_KEYS.keys(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async () =>
      asArray(await rpc("integration_list_api_keys", { p_client_id: clientId })).map(
        normaliseApiKey,
      ),
  });
}

export function useIntegrationAudit(clientId: string | undefined, limit = 100) {
  return useQuery({
    queryKey: [...INTEGRATION_KEYS.audit(clientId ?? ""), limit],
    enabled: !!clientId,
    queryFn: async () =>
      asArray(
        await rpc("integration_audit_history", { p_client_id: clientId, p_limit: limit }),
      ).map(normaliseAudit),
  });
}

/** Per-client key/scope/vineyard counts for the list + summary cards.
 *  Only used when the list RPC does not already return aggregates. */
export function useIntegrationCounts(clients: IntegrationClient[]) {
  const ids = clients.map((c) => c.id).filter(Boolean);
  const results = useQueries({
    queries: ids.flatMap((id) => [
      {
        queryKey: INTEGRATION_KEYS.keys(id),
        queryFn: async () =>
          asArray(await rpc("integration_list_api_keys", { p_client_id: id })).map(
            normaliseApiKey,
          ),
      },
      {
        queryKey: INTEGRATION_KEYS.vineyards(id),
        queryFn: async () =>
          asArray(await rpc("integration_list_vineyard_grants", { p_client_id: id }))
            .map(normaliseGrant)
            .filter((g) => !g.revoked_at),
      },
      {
        queryKey: INTEGRATION_KEYS.scopes(id),
        queryFn: async () =>
          asArray(await rpc("integration_list_scopes", { p_client_id: id })),
      },
    ]),
  });

  const counts: Record<
    string,
    { keys: number | null; vineyards: number | null; scopes: number | null }
  > = {};
  ids.forEach((id, i) => {
    const keys = results[i * 3]?.data as IntegrationApiKey[] | undefined;
    const vines = results[i * 3 + 1]?.data as IntegrationVineyardGrant[] | undefined;
    const scopeRows = results[i * 3 + 2]?.data as Record<string, any>[] | undefined;
    counts[id] = {
      keys: keys ? keys.filter((k) => !k.revoked_at).length : null,
      vineyards: vines ? vines.length : null,
      scopes: scopeRows
        ? normaliseScopeRows(scopeRows, []).filter((s) => s.granted).length
        : null,
    };
  });
  return counts;
}

// ---------------------------------------------------------------------------
// Mutations — all through RPCs, all invalidating only integration queries
// ---------------------------------------------------------------------------

export function useCreateIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      integrationType: string;
      description?: string | null;
    }) => {
      const data = await rpc("integration_create_client", {
        p_name: input.name.trim(),
        p_integration_type: input.integrationType,
        p_description: input.description?.trim() || null,
      });
      const row = asArray(data)[0];
      return row ? normaliseClient(row) : null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
    },
  });
}

export function useUpdateIntegration(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description: string | null }) =>
      rpc("integration_update_client", {
        p_client_id: clientId,
        p_name: input.name.trim(),
        p_description: input.description?.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.audit(clientId) });
    },
  });
}

export type IntegrationStatusAction = "pause" | "reactivate" | "revoke";

export function useSetIntegrationStatus(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: IntegrationStatusAction) =>
      rpc("integration_set_status", { p_client_id: clientId, p_action: action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.audit(clientId) });
    },
  });
}

export function useGrantVineyard(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vineyardId: string) =>
      rpc("integration_grant_vineyard", {
        p_client_id: clientId,
        p_vineyard_id: vineyardId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.vineyards(clientId) });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.audit(clientId) });
    },
  });
}

export function useRevokeVineyard(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vineyardId: string) =>
      rpc("integration_revoke_vineyard", {
        p_client_id: clientId,
        p_vineyard_id: vineyardId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.vineyards(clientId) });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.audit(clientId) });
    },
  });
}

export function useSetScope(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scope: string; granted: boolean }) => {
      if (input.scope.endsWith(":write")) {
        // Hard requirement: the public API is read-only in Stage 4.
        throw new Error("write_scopes_not_available");
      }
      return rpc(
        input.granted ? "integration_grant_scope" : "integration_revoke_scope",
        { p_client_id: clientId, p_scope: input.scope },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.scopes(clientId) });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.audit(clientId) });
    },
  });
}

export function useCreateApiKey(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      environment: string;
      expiresAt: string | null;
    }) => {
      const data = await rpc("integration_create_api_key", {
        p_client_id: clientId,
        p_name: input.name.trim(),
        p_environment: input.environment,
        p_expires_at: input.expiresAt,
      });
      const row = asArray(data)[0] ?? {};
      const secret =
        str(row.secret) ??
        str(row.api_key) ??
        str(row.plaintext_key) ??
        str(row.key) ??
        null;
      return { secret, key: normaliseApiKey(row) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.keys(clientId) });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.audit(clientId) });
    },
  });
}

export function useRevokeApiKey(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (keyId: string) =>
      rpc("integration_revoke_api_key", { p_client_id: clientId, p_key_id: keyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.keys(clientId) });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.clients });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.audit(clientId) });
    },
  });
}

// ---------------------------------------------------------------------------
// API request logs — SQL 177 (integration_list_api_requests)
// ---------------------------------------------------------------------------
//
// Live signature (verified against the shared backend):
//   integration_list_api_requests(
//     p_client_id uuid,
//     p_from timestamptz, p_to timestamptz,
//     p_status_code int, p_vineyard_id uuid, p_api_key_id uuid,
//     p_error_only boolean,
//     p_limit int,
//     p_before_created_at timestamptz, p_before_id uuid
//   )
// Keyset pagination: pass the last row's created_at + id as the "before" cursor.
// The portal never reads public.integration_api_requests directly.

export const API_REQUEST_LOG_RPC = "integration_list_api_requests";
export const API_REQUEST_PAGE_SIZE = 100;

export interface IntegrationApiRequest {
  id: string;
  created_at: string | null;
  method: string | null;
  endpoint: string | null;
  vineyard_id: string | null;
  vineyard_name: string | null;
  api_key_id: string | null;
  api_key_name: string | null;
  api_key_prefix: string | null;
  status_code: number | null;
  duration_ms: number | null;
  error_code: string | null;
}

export interface ApiRequestCursor {
  created_at: string;
  id: string;
}

export interface ApiRequestFilters {
  from?: string | null;
  to?: string | null;
  statusCode?: number | null;
  vineyardId?: string | null;
  apiKeyId?: string | null;
  errorOnly?: boolean;
}

export function normaliseApiRequest(row: Record<string, any>): IntegrationApiRequest {
  return {
    id: String(row.id ?? row.request_id ?? ""),
    created_at: str(row.created_at) ?? str(row.requested_at) ?? str(row.occurred_at),
    method: str(row.method) ?? str(row.http_method),
    endpoint: str(row.endpoint) ?? str(row.path) ?? str(row.route),
    vineyard_id: str(row.vineyard_id),
    vineyard_name: str(row.vineyard_name),
    api_key_id: str(row.api_key_id),
    api_key_name: str(row.api_key_name) ?? str(row.key_name),
    api_key_prefix: str(row.api_key_prefix) ?? str(row.key_prefix),
    status_code: num(row.status_code ?? row.http_status ?? row.response_status),
    duration_ms: num(row.duration_ms ?? row.response_time_ms ?? row.latency_ms),
    error_code: str(row.error_code) ?? str(row.error),
  };
}

/** Compact status tone. Expected permission failures are not catastrophic. */
export function apiStatusTone(
  status: number | null,
): "success" | "warning" | "error" | "neutral" {
  if (status === null) return "neutral";
  if (status >= 200 && status < 300) return "success";
  if (status >= 400 && status < 500) return "warning";
  if (status >= 500) return "error";
  return "neutral";
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Cursor for the next keyset page, or null when the page was not full. */
export function nextApiRequestCursor(
  rows: IntegrationApiRequest[],
  limit: number,
): ApiRequestCursor | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  if (!last?.created_at || !last.id) return null;
  return { created_at: last.created_at, id: last.id };
}

export function apiRequestRpcArgs(
  clientId: string,
  filters: ApiRequestFilters,
  cursor: ApiRequestCursor | null,
  limit = API_REQUEST_PAGE_SIZE,
): Record<string, unknown> {
  return {
    p_client_id: clientId,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_status_code: filters.statusCode ?? null,
    p_vineyard_id: filters.vineyardId || null,
    p_api_key_id: filters.apiKeyId || null,
    p_error_only: filters.errorOnly ?? false,
    p_limit: limit,
    p_before_created_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
  };
}

export function useIntegrationApiRequests(
  clientId: string | undefined,
  filters: ApiRequestFilters,
  cursor: ApiRequestCursor | null,
  limit = API_REQUEST_PAGE_SIZE,
) {
  return useQuery({
    queryKey: [
      ...INTEGRATION_KEYS.requests(clientId ?? ""),
      filters,
      cursor,
      limit,
    ],
    enabled: !!clientId,
    queryFn: async () =>
      asArray(
        await rpc(API_REQUEST_LOG_RPC, apiRequestRpcArgs(clientId!, filters, cursor, limit)),
      ).map(normaliseApiRequest),
  });
}


// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Stage 5B — Webhook management (SQL 5A RPC contract)
// ---------------------------------------------------------------------------
//
// Every read/write goes through the integration_* webhook RPCs. The portal
// never touches webhook_endpoints / webhook_deliveries / webhook_subscriptions
// directly, never calls the service-role dispatcher RPCs
// (integration_webhook_claim_deliveries, integration_webhook_get_endpoint_secret,
// integration_webhook_record_attempt) and never reads a signing secret.
// Plaintext signing secrets returned by create/rotate live ONLY in transient
// component state — they are never written into the React Query cache.

export type WebhookEndpointStatus = "active" | "paused" | "disabled" | string;
export type WebhookDeliveryStatus =
  | "pending"
  | "delivering"
  | "delivered"
  | "failed"
  | "cancelled"
  | string;

export interface WebhookEndpoint {
  id: string;
  name: string | null;
  url: string | null;
  status: WebhookEndpointStatus;
  signing_secret_prefix: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  paused_at: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
  subscription_count: number | null;
}

export interface WebhookSubscription {
  id: string;
  endpoint_id: string | null;
  event_type: string;
  vineyard_id: string | null;
  vineyard_name: string | null;
  is_active: boolean;
  created_at: string | null;
}

export interface WebhookDelivery {
  id: string;
  public_id: string | null;
  event_id: string | null;
  event_type: string | null;
  endpoint_id: string | null;
  endpoint_name: string | null;
  vineyard_id: string | null;
  vineyard_name: string | null;
  status: WebhookDeliveryStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error_code: string | null;
  is_test: boolean;
  replay_of: string | null;
  replay_of_public_id: string | null;
  api_version: string | null;
  created_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  payload: unknown;
  attempts: WebhookDeliveryAttempt[];
}

export interface WebhookDeliveryAttempt {
  id: string;
  attempt_number: number | null;
  attempted_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  http_status: number | null;
  error_category: string | null;
  error_detail: string | null;
}

export const WEBHOOK_KEYS = {
  endpoints: (clientId: string) =>
    ["integrations", clientId, "webhooks"] as const,
  endpoint: (clientId: string, endpointId: string) =>
    ["integrations", clientId, "webhooks", endpointId] as const,
  subscriptions: (clientId: string, endpointId: string) =>
    ["integrations", clientId, "webhooks", endpointId, "subscriptions"] as const,
  deliveries: (clientId: string) =>
    ["integrations", clientId, "webhooks", "deliveries"] as const,
  delivery: (clientId: string, deliveryId: string) =>
    ["integrations", clientId, "webhooks", "delivery", deliveryId] as const,
};

// --- Event catalogue -------------------------------------------------------
// Values are the exact backend identifiers from
// public.integration_webhook_event_catalog. The catalogue table is also read at
// runtime where RLS permits; this constant is the presentation fallback and the
// source of the customer-facing grouping.

export interface WebhookEventDefinition {
  event: string;
  module: string;
  label: string;
  description: string;
  scope: string | null;
  is_system?: boolean;
}

export const WEBHOOK_EVENT_CATALOG: WebhookEventDefinition[] = [
  { event: "block.created", module: "structure", label: "Block created", description: "Sent when a block is added to a vineyard.", scope: "blocks:read" },
  { event: "block.updated", module: "structure", label: "Block updated", description: "Sent when block details or boundaries change.", scope: "blocks:read" },
  { event: "trip.created", module: "trips", label: "Trip created", description: "Sent when a field trip is created.", scope: "trips:read" },
  { event: "trip.updated", module: "trips", label: "Trip updated", description: "Sent when a field trip is materially updated.", scope: "trips:read" },
  { event: "trip.completed", module: "trips", label: "Trip completed", description: "Sent when a field trip is completed.", scope: "trips:read" },
  { event: "spray_job.created", module: "sprays", label: "Spray job created", description: "Sent when a spray job is created.", scope: "sprays:read" },
  { event: "spray_job.updated", module: "sprays", label: "Spray job updated", description: "Sent when a spray job is materially updated.", scope: "sprays:read" },
  { event: "spray_job.completed", module: "sprays", label: "Spray job completed", description: "Sent when a spray job is completed.", scope: "sprays:read" },
  { event: "fuel_log.created", module: "fuel", label: "Fuel log created", description: "Sent when a fuel log entry is recorded.", scope: "fuel:read" },
  { event: "fuel_log.updated", module: "fuel", label: "Fuel log updated", description: "Sent when a fuel log entry is updated.", scope: "fuel:read" },
  { event: "fuel_purchase.created", module: "fuel", label: "Fuel purchase recorded", description: "Sent when a fuel purchase is recorded.", scope: "fuel:read" },
  { event: "work_task.created", module: "work", label: "Work task created", description: "Sent when a work task is created.", scope: "work_tasks:read" },
  { event: "work_task.updated", module: "work", label: "Work task updated", description: "Sent when a work task is updated.", scope: "work_tasks:read" },
  { event: "work_task.completed", module: "work", label: "Work task completed", description: "Sent when a work task is completed.", scope: "work_tasks:read" },
  { event: "pruning_activity.created", module: "pruning", label: "Pruning activity created", description: "Sent when pruning work is recorded.", scope: "pruning:read" },
  { event: "pruning_activity.updated", module: "pruning", label: "Pruning activity updated", description: "Sent when a pruning activity is updated.", scope: "pruning:read" },
  { event: "irrigation_record.created", module: "irrigation", label: "Irrigation record created", description: "Sent when an irrigation record is created.", scope: "irrigation:read" },
  { event: "irrigation_record.updated", module: "irrigation", label: "Irrigation record updated", description: "Sent when an irrigation record is updated.", scope: "irrigation:read" },
  { event: "irrigation_record.completed", module: "irrigation", label: "Irrigation record completed", description: "Sent when an irrigation record is completed.", scope: "irrigation:read" },
  { event: "growth_stage.recorded", module: "growth", label: "Growth stage recorded", description: "Sent when a growth stage observation is recorded.", scope: "growth_stages:read" },
  { event: "yield_record.created", module: "yield", label: "Yield record created", description: "Sent when a yield record is created.", scope: "yield:read" },
  { event: "yield_record.updated", module: "yield", label: "Yield record updated", description: "Sent when a yield record is updated.", scope: "yield:read" },
  { event: "pin.created", module: "pins", label: "Pin created", description: "Sent when a pin, repair or observation is created.", scope: "pins:read" },
  { event: "pin.updated", module: "pins", label: "Pin updated", description: "Sent when a pin is updated.", scope: "pins:read" },
  { event: "pin.resolved", module: "pins", label: "Pin resolved", description: "Sent when a pin is resolved or completed.", scope: "pins:read" },
];

export const WEBHOOK_MODULE_LABELS: Record<string, string> = {
  structure: "Vineyard structure",
  trips: "Operational activity",
  sprays: "Spraying",
  fuel: "Fuel",
  work: "Operational activity",
  pruning: "Pruning",
  irrigation: "Irrigation",
  growth: "Growth",
  yield: "Yield",
  pins: "Pins",
  system: "System",
};

const WEBHOOK_MODULE_ORDER = [
  "structure",
  "trips",
  "work",
  "sprays",
  "fuel",
  "pruning",
  "irrigation",
  "growth",
  "yield",
  "pins",
];

/** Customer-facing event label; falls back to a humanised identifier. */
export function webhookEventLabel(event: string): string {
  const def = WEBHOOK_EVENT_CATALOG.find((e) => e.event === event);
  if (def) return def.label;
  return titleise(event.replace(/[._]/g, " "));
}

export function webhookEventScope(event: string): string | null {
  return WEBHOOK_EVENT_CATALOG.find((e) => e.event === event)?.scope ?? null;
}

/** Events grouped for the subscription picker, in a stable display order. */
export function groupedWebhookEvents(): { group: string; events: WebhookEventDefinition[] }[] {
  const groups: { group: string; events: WebhookEventDefinition[] }[] = [];
  const seen = new Map<string, WebhookEventDefinition[]>();
  const ordered = [...WEBHOOK_EVENT_CATALOG].sort(
    (a, b) =>
      WEBHOOK_MODULE_ORDER.indexOf(a.module) - WEBHOOK_MODULE_ORDER.indexOf(b.module),
  );
  for (const def of ordered) {
    const label = WEBHOOK_MODULE_LABELS[def.module] ?? titleise(def.module);
    if (!seen.has(label)) {
      const list: WebhookEventDefinition[] = [];
      seen.set(label, list);
      groups.push({ group: label, events: list });
    }
    seen.get(label)!.push(def);
  }
  return groups;
}

// --- Normalisers -----------------------------------------------------------

function normaliseEndpoint(row: Record<string, any>): WebhookEndpoint {
  const status = String(
    row.status ?? (row.disabled_at ? "disabled" : row.paused_at ? "paused" : "active"),
  );
  return {
    id: String(row.id ?? row.endpoint_id ?? ""),
    name: str(row.name ?? row.endpoint_name),
    url: str(row.url ?? row.endpoint_url),
    status,
    signing_secret_prefix: str(row.signing_secret_prefix ?? row.secret_prefix),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    last_success_at: str(row.last_success_at),
    last_failure_at: str(row.last_failure_at),
    consecutive_failures: num(row.consecutive_failures) ?? 0,
    paused_at: str(row.paused_at),
    disabled_at: str(row.disabled_at),
    disabled_reason: str(row.disabled_reason),
    subscription_count: num(
      row.subscription_count ?? row.subscriptions_count ?? row.active_subscriptions,
    ),
  };
}

function normaliseSubscription(row: Record<string, any>): WebhookSubscription {
  return {
    id: String(row.id ?? row.subscription_id ?? ""),
    endpoint_id: str(row.webhook_endpoint_id ?? row.endpoint_id),
    event_type: String(row.event_type ?? row.event ?? ""),
    vineyard_id: str(row.vineyard_id),
    vineyard_name: str(row.vineyard_name),
    is_active: row.is_active === undefined ? true : Boolean(row.is_active),
    created_at: str(row.created_at),
  };
}

function normaliseAttempt(row: Record<string, any>, i: number): WebhookDeliveryAttempt {
  return {
    id: String(row.id ?? `${row.attempt_number ?? i}`),
    attempt_number: num(row.attempt_number) ?? i + 1,
    attempted_at: str(row.attempted_at ?? row.created_at),
    finished_at: str(row.finished_at),
    duration_ms: num(row.duration_ms),
    http_status: num(row.http_status ?? row.status_code),
    error_category: str(row.error_category),
    error_detail: str(row.error_detail ?? row.error_message),
  };
}

export function normaliseDelivery(row: Record<string, any>): WebhookDelivery {
  const attempts = Array.isArray(row.attempts)
    ? (row.attempts as Record<string, any>[]).map(normaliseAttempt)
    : [];
  return {
    id: String(row.id ?? row.delivery_id ?? ""),
    public_id: str(row.public_id ?? row.delivery_public_id),
    event_id: str(row.event_id ?? row.event_public_id),
    event_type: str(row.event_type ?? row.event),
    endpoint_id: str(row.endpoint_id ?? row.webhook_endpoint_id),
    endpoint_name: str(row.endpoint_name),
    vineyard_id: str(row.vineyard_id),
    vineyard_name: str(row.vineyard_name),
    status: String(row.status ?? "pending"),
    attempt_count: num(row.attempt_count) ?? 0,
    next_attempt_at: str(row.next_attempt_at),
    last_status_code: num(row.last_status_code ?? row.http_status),
    last_error_code: str(row.last_error_code ?? row.error_code),
    is_test: Boolean(row.is_test),
    replay_of: str(row.replay_of),
    replay_of_public_id: str(row.replay_of_public_id),
    api_version: str(row.api_version ?? row.event_api_version),
    created_at: str(row.created_at),
    delivered_at: str(row.delivered_at),
    failed_at: str(row.failed_at),
    payload: row.payload ?? row.event_payload ?? row.envelope ?? null,
    attempts,
  };
}

/** Customer-friendly delivery status. Pending with attempts = retry scheduled. */
export function webhookDeliveryStatusLabel(d: {
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
}): string {
  if (d.status === "pending" && d.attempt_count > 0) return "Retry scheduled";
  switch (d.status) {
    case "pending":
      return "Pending";
    case "delivering":
      return "Delivering";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return titleise(d.status);
  }
}

export function webhookDeliveryTone(
  status: string,
): "success" | "warning" | "error" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "failed") return "error";
  if (status === "pending" || status === "delivering") return "warning";
  return "neutral";
}

export function webhookEndpointStatusOf(e: WebhookEndpoint): WebhookEndpointStatus {
  return e.status;
}

/** Basic client-side URL check. Backend validation remains authoritative. */
export function isValidWebhookUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

// --- Reads -----------------------------------------------------------------

export function useWebhookEndpoints(clientId: string | undefined) {
  return useQuery({
    queryKey: WEBHOOK_KEYS.endpoints(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async () =>
      asArray(
        await rpc("integration_list_webhook_endpoints", { p_client_id: clientId }),
      ).map(normaliseEndpoint),
  });
}

export function useWebhookEndpoint(
  clientId: string | undefined,
  endpointId: string | undefined,
) {
  return useQuery({
    queryKey: WEBHOOK_KEYS.endpoint(clientId ?? "", endpointId ?? ""),
    enabled: !!clientId && !!endpointId,
    queryFn: async () => {
      const row = asArray(
        await rpc("integration_get_webhook_endpoint", { p_endpoint_id: endpointId }),
      )[0];
      return row ? normaliseEndpoint(row) : null;
    },
  });
}

export function useWebhookSubscriptions(
  clientId: string | undefined,
  endpointId: string | undefined,
) {
  return useQuery({
    queryKey: WEBHOOK_KEYS.subscriptions(clientId ?? "", endpointId ?? ""),
    enabled: !!clientId && !!endpointId,
    queryFn: async () =>
      asArray(
        await rpc("integration_list_webhook_subscriptions", {
          p_endpoint_id: endpointId,
        }),
      ).map(normaliseSubscription),
  });
}

export interface WebhookDeliveryFilters {
  endpointId?: string | null;
  eventType?: string | null;
  status?: string | null;
  vineyardId?: string | null;
  from?: string | null;
  to?: string | null;
}

export const WEBHOOK_DELIVERY_PAGE_SIZE = 50;

export function webhookDeliveryRpcArgs(
  clientId: string,
  filters: WebhookDeliveryFilters,
  cursor: ApiRequestCursor | null,
  limit = WEBHOOK_DELIVERY_PAGE_SIZE,
): Record<string, unknown> {
  return {
    p_client_id: clientId,
    p_endpoint_id: filters.endpointId || null,
    p_event_type: filters.eventType || null,
    p_status: filters.status || null,
    p_vineyard_id: filters.vineyardId || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_limit: limit,
    p_before_created_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
  };
}

export function nextWebhookDeliveryCursor(
  rows: WebhookDelivery[],
  limit: number,
): ApiRequestCursor | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  if (!last?.created_at || !last.id) return null;
  return { created_at: last.created_at, id: last.id };
}

export function useWebhookDeliveries(
  clientId: string | undefined,
  filters: WebhookDeliveryFilters,
  cursor: ApiRequestCursor | null,
  limit = WEBHOOK_DELIVERY_PAGE_SIZE,
) {
  return useQuery({
    queryKey: [...WEBHOOK_KEYS.deliveries(clientId ?? ""), filters, cursor, limit],
    enabled: !!clientId,
    queryFn: async () =>
      asArray(
        await rpc(
          "integration_list_webhook_deliveries",
          webhookDeliveryRpcArgs(clientId!, filters, cursor, limit),
        ),
      ).map(normaliseDelivery),
  });
}

export function useWebhookDelivery(
  clientId: string | undefined,
  deliveryId: string | null,
) {
  return useQuery({
    queryKey: WEBHOOK_KEYS.delivery(clientId ?? "", deliveryId ?? ""),
    enabled: !!clientId && !!deliveryId,
    queryFn: async () => {
      const row = asArray(
        await rpc("integration_get_webhook_delivery", { p_delivery_id: deliveryId }),
      )[0];
      return row ? normaliseDelivery(row) : null;
    },
  });
}

// --- Mutations -------------------------------------------------------------

/** Extracts the one-time plaintext signing secret from an RPC response.
 *  The caller must keep it in transient state only. */
function extractSigningSecret(row: Record<string, any>): string | null {
  return (
    str(row.signing_secret) ??
    str(row.secret) ??
    str(row.plaintext_secret) ??
    str(row.webhook_secret) ??
    null
  );
}

function useWebhookInvalidate(clientId: string) {
  const qc = useQueryClient();
  return (endpointId?: string) => {
    qc.invalidateQueries({ queryKey: WEBHOOK_KEYS.endpoints(clientId) });
    if (endpointId) {
      qc.invalidateQueries({ queryKey: WEBHOOK_KEYS.endpoint(clientId, endpointId) });
    }
  };
}

export function useCreateWebhookEndpoint(clientId: string) {
  const invalidate = useWebhookInvalidate(clientId);
  return useMutation({
    mutationFn: async (input: { name: string; url: string }) => {
      const row = asArray(
        await rpc("integration_create_webhook_endpoint", {
          p_client_id: clientId,
          p_url: input.url.trim(),
          p_name: input.name.trim(),
        }),
      )[0] ?? {};
      // The secret is returned to the caller only — never cached.
      return { endpoint: normaliseEndpoint(row), secret: extractSigningSecret(row) };
    },
    onSuccess: () => invalidate(),
  });
}

export function useUpdateWebhookEndpoint(clientId: string) {
  const invalidate = useWebhookInvalidate(clientId);
  return useMutation({
    mutationFn: async (input: { endpointId: string; name: string; url: string }) =>
      rpc("integration_update_webhook_endpoint", {
        p_endpoint_id: input.endpointId,
        p_url: input.url.trim(),
        p_name: input.name.trim(),
      }),
    onSuccess: (_d, v) => invalidate(v.endpointId),
  });
}

export function useSetWebhookEndpointStatus(clientId: string) {
  const invalidate = useWebhookInvalidate(clientId);
  return useMutation({
    mutationFn: async (input: { endpointId: string; status: WebhookEndpointStatus }) =>
      rpc("integration_set_webhook_endpoint_status", {
        p_endpoint_id: input.endpointId,
        p_status: input.status,
      }),
    onSuccess: (_d, v) => invalidate(v.endpointId),
  });
}

export function useDeleteWebhookEndpoint(clientId: string) {
  const invalidate = useWebhookInvalidate(clientId);
  return useMutation({
    mutationFn: async (endpointId: string) =>
      rpc("integration_delete_webhook_endpoint", { p_endpoint_id: endpointId }),
    onSuccess: () => invalidate(),
  });
}

export function useRotateWebhookSecret(clientId: string) {
  const invalidate = useWebhookInvalidate(clientId);
  return useMutation({
    mutationFn: async (endpointId: string) => {
      const row = asArray(
        await rpc("integration_rotate_webhook_secret", { p_endpoint_id: endpointId }),
      )[0] ?? {};
      return { endpoint: normaliseEndpoint(row), secret: extractSigningSecret(row) };
    },
    onSuccess: (_d, endpointId) => invalidate(endpointId),
  });
}

export function useSendTestWebhook(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (endpointId: string) => {
      const row = asArray(
        await rpc("integration_send_test_webhook", { p_endpoint_id: endpointId }),
      )[0] ?? {};
      return {
        deliveryId: str(row.id ?? row.delivery_id),
        publicId: str(row.public_id ?? row.delivery_public_id),
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOK_KEYS.deliveries(clientId) });
      qc.invalidateQueries({ queryKey: WEBHOOK_KEYS.endpoints(clientId) });
    },
  });
}

export function useCreateWebhookSubscription(clientId: string, endpointId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventType: string; vineyardId: string }) =>
      rpc("integration_create_webhook_subscription", {
        p_endpoint_id: endpointId,
        p_event_type: input.eventType,
        p_vineyard_id: input.vineyardId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: WEBHOOK_KEYS.subscriptions(clientId, endpointId),
      });
      qc.invalidateQueries({ queryKey: WEBHOOK_KEYS.endpoints(clientId) });
    },
  });
}

export function useDeleteWebhookSubscription(clientId: string, endpointId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (subscriptionId: string) =>
      rpc("integration_delete_webhook_subscription", {
        p_subscription_id: subscriptionId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: WEBHOOK_KEYS.subscriptions(clientId, endpointId),
      });
      qc.invalidateQueries({ queryKey: WEBHOOK_KEYS.endpoints(clientId) });
    },
  });
}

export function useReplayWebhookDelivery(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const row = asArray(
        await rpc("integration_replay_webhook_delivery", { p_delivery_id: deliveryId }),
      )[0] ?? {};
      return { publicId: str(row.public_id), id: str(row.id) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOK_KEYS.deliveries(clientId) });
    },
  });
}
