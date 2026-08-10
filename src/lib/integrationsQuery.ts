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
