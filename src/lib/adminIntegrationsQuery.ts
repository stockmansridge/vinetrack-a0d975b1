// Stage 7B — Platform admin integration observability query layer.
//
// Every read and write goes through the Stage 7A admin_* RPCs on the shared
// VineTrack backend. The portal never reads integration tables directly, never
// calls service-role-only functions, and never renders API key values, hashes,
// signing secrets, authorization headers or request/response bodies. The
// backend is the sole authority for admin access and for health classification
// — the portal only presents backend-provided values.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { integrationErrorMessage } from "@/lib/integrationsQuery";

export { integrationErrorMessage };

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const ADMIN_PAGE_SIZE = 50;

export type AdminHealth = "healthy" | "warning" | "critical" | "inactive" | string;

export interface KeysetCursor {
  createdAt: string;
  id: string;
}

export const ADMIN_INTEGRATION_KEYS = {
  root: ["admin", "integrations"] as const,
  list: (filters: unknown, cursor: unknown) =>
    ["admin", "integrations", filters, cursor] as const,
  detail: (clientId: string) => ["admin", "integration", clientId] as const,
  diagnostics: (clientId: string) =>
    ["admin", "integration", "diagnostics", clientId] as const,
  apiMetrics: (window: string, clientId: string | null, breakdown: string | null) =>
    ["admin", "integrations", "api-metrics", window, clientId, breakdown] as const,
  apiRequests: (filters: unknown, cursor: unknown) =>
    ["admin", "integrations", "api-requests", filters, cursor] as const,
  webhookMetrics: (window: string, clientId: string | null) =>
    ["admin", "integrations", "webhook-metrics", window, clientId] as const,
  webhookEndpoints: (filters: unknown, cursor: unknown) =>
    ["admin", "integrations", "webhook-endpoints", filters, cursor] as const,
  webhookDeliveries: (filters: unknown, cursor: unknown) =>
    ["admin", "integrations", "webhook-deliveries", filters, cursor] as const,
  audit: (filters: unknown, cursor: unknown) =>
    ["admin", "integrations", "audit", filters, cursor] as const,
};

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new Error(error.message ?? "rpc_failed");
  return data;
}

/** Stage 7A RPCs return jsonb — accept an array, a `{ rows: [] }` envelope or
 *  any of the common list keys without assuming one shape. */
export function asRows(data: unknown): Record<string, any>[] {
  if (Array.isArray(data)) return data as Record<string, any>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["rows", "items", "data", "results", "records", "entries"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, any>[];
    }
  }
  return [];
}

/** Single-object jsonb payloads (`admin_get_integration`, metrics). */
export function asObject(data: unknown): Record<string, any> {
  if (Array.isArray(data)) return (data[0] as Record<string, any>) ?? {};
  if (data && typeof data === "object") {
    const obj = data as Record<string, any>;
    if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
      return obj.data as Record<string, any>;
    }
    return obj;
  }
  return {};
}

export const num = (v: unknown): number | null =>
  typeof v === "number"
    ? v
    : typeof v === "string" && v !== "" && !isNaN(Number(v))
      ? Number(v)
      : null;

export const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

export const bool = (v: unknown): boolean => v === true || v === "true";

/** Backend-provided health reasons, whatever key/shape they arrive in. */
export function healthReasons(row: Record<string, any>): string[] {
  const raw =
    row.health_reasons ?? row.reasons ?? row.health_signals ?? row.signals ?? null;
  if (Array.isArray(raw)) {
    return raw
      .map((r) =>
        typeof r === "string"
          ? r
          : r && typeof r === "object"
            ? String(
                (r as any).message ??
                  (r as any).reason ??
                  (r as any).label ??
                  (r as any).code ??
                  "",
              )
            : "",
      )
      .filter(Boolean);
  }
  const single = str(row.health_reason);
  return single ? [single] : [];
}

/** Keyset cursor from the final row of the previous page — never offsets. */
export function nextCursor(rows: Record<string, any>[]): KeysetCursor | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const createdAt = str(last.created_at) ?? str(last.created);
  const id = str(last.id);
  if (!createdAt || !id) return null;
  return { createdAt, id };
}

function cursorArgs(cursor: KeysetCursor | null) {
  return {
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Integration directory
// ---------------------------------------------------------------------------

export interface AdminIntegrationRow {
  id: string;
  name: string;
  status: string;
  environment: string | null;
  integration_type: string | null;
  health: AdminHealth;
  health_reasons: string[];
  owner_name: string | null;
  owner_email: string | null;
  organisation: string | null;
  vineyard_grants: number | null;
  scope_count: number | null;
  api_key_count: number | null;
  webhook_endpoint_count: number | null;
  last_api_activity_at: string | null;
  last_webhook_activity_at: string | null;
  api_errors_24h: number | null;
  webhook_failures_24h: number | null;
  rate_limited_24h: number | null;
  created_at: string | null;
  raw: Record<string, any>;
}

export function normaliseAdminIntegration(row: Record<string, any>): AdminIntegrationRow {
  return {
    id: String(row.id ?? row.client_id ?? ""),
    name: String(row.name ?? row.integration_name ?? "Untitled integration"),
    status: String(row.status ?? "unknown"),
    environment: str(row.environment),
    integration_type: str(row.integration_type ?? row.type),
    health: String(row.health ?? row.health_status ?? "inactive"),
    health_reasons: healthReasons(row),
    owner_name: str(row.owner_name ?? row.owner_full_name ?? row.customer_name),
    owner_email: str(row.owner_email ?? row.customer_email),
    organisation: str(row.organisation ?? row.organisation_name ?? row.customer),
    vineyard_grants: num(row.vineyard_grants ?? row.vineyard_count ?? row.granted_vineyards),
    scope_count: num(row.scope_count ?? row.scopes),
    api_key_count: num(row.active_api_keys ?? row.api_key_count),
    webhook_endpoint_count: num(row.webhook_endpoints ?? row.webhook_endpoint_count),
    last_api_activity_at: str(row.last_api_activity_at ?? row.last_request_at),
    last_webhook_activity_at: str(row.last_webhook_activity_at ?? row.last_webhook_at),
    api_errors_24h: num(row.api_errors_24h ?? row.recent_api_errors ?? row.error_count_24h),
    webhook_failures_24h: num(
      row.webhook_failures_24h ?? row.recent_webhook_failures ?? row.failed_deliveries_24h,
    ),
    rate_limited_24h: num(row.rate_limited_24h ?? row.rate_limit_events_24h),
    created_at: str(row.created_at),
    raw: row,
  };
}

export interface AdminIntegrationFilters {
  status?: string | null;
  environment?: string | null;
  ownerUserId?: string | null;
  ownerQuery?: string | null;
  vineyardId?: string | null;
  activity?: string | null;
  health?: string | null;
  errorsOnly?: boolean;
  rateLimitedOnly?: boolean;
  createdFrom?: string | null;
  createdTo?: string | null;
  lastUsedFrom?: string | null;
  lastUsedTo?: string | null;
}

export function adminIntegrationsArgs(
  filters: AdminIntegrationFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return {
    p_status: filters.status ?? null,
    p_environment: filters.environment ?? null,
    p_owner_user_id: filters.ownerUserId ?? null,
    p_owner_query: filters.ownerQuery ?? null,
    p_vineyard_id: filters.vineyardId ?? null,
    p_activity: filters.activity ?? null,
    p_health: filters.health ?? null,
    p_errors_only: filters.errorsOnly ? true : null,
    p_rate_limited_only: filters.rateLimitedOnly ? true : null,
    p_created_from: filters.createdFrom ?? null,
    p_created_to: filters.createdTo ?? null,
    p_last_used_from: filters.lastUsedFrom ?? null,
    p_last_used_to: filters.lastUsedTo ?? null,
    p_limit: limit,
    ...cursorArgs(cursor),
  };
}

export function useAdminIntegrations(
  filters: AdminIntegrationFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.list(filters, cursor),
    queryFn: async () =>
      asRows(await rpc("admin_list_integrations", adminIntegrationsArgs(filters, cursor, limit)))
        .map(normaliseAdminIntegration),
  });
}

// ---------------------------------------------------------------------------
// Integration detail + diagnostics
// ---------------------------------------------------------------------------

export interface AdminIntegrationDetail extends AdminIntegrationRow {
  description: string | null;
  updated_at: string | null;
  vineyards: Record<string, any>[];
  scopes: Record<string, any>[];
  api_keys: Record<string, any>[];
  webhook_endpoints: Record<string, any>[];
}

function listField(obj: Record<string, any>, ...keys: string[]): Record<string, any>[] {
  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, any>[];
  }
  return [];
}

export function normaliseAdminIntegrationDetail(
  data: unknown,
): AdminIntegrationDetail | null {
  const obj = asObject(data);
  const base = (obj.integration && typeof obj.integration === "object"
    ? (obj.integration as Record<string, any>)
    : obj) as Record<string, any>;
  if (!base || (!base.id && !base.client_id)) return null;
  return {
    ...normaliseAdminIntegration(base),
    description: str(base.description),
    updated_at: str(base.updated_at),
    vineyards: listField(obj, "vineyards", "vineyard_grants", "grants"),
    scopes: listField(obj, "scopes", "granted_scopes"),
    api_keys: listField(obj, "api_keys", "keys"),
    webhook_endpoints: listField(obj, "webhook_endpoints", "endpoints"),
  };
}

export function useAdminIntegration(clientId: string | undefined) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.detail(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async () =>
      normaliseAdminIntegrationDetail(
        await rpc("admin_get_integration", { p_client_id: clientId }),
      ),
  });
}

export interface AdminDiagnostics {
  api_requests_24h: number | null;
  api_errors_24h: number | null;
  api_requests_7d: number | null;
  rate_limit_events_24h: number | null;
  active_api_keys: number | null;
  vineyard_grants: number | null;
  scope_count: number | null;
  webhook_endpoints: number | null;
  failing_endpoints: number | null;
  pending_deliveries: number | null;
  health: AdminHealth | null;
  health_reasons: string[];
  raw: Record<string, any>;
}

export function normaliseDiagnostics(data: unknown): AdminDiagnostics {
  const obj = asObject(data);
  const src = (obj.diagnostics && typeof obj.diagnostics === "object"
    ? (obj.diagnostics as Record<string, any>)
    : obj) as Record<string, any>;
  const api = (src.api && typeof src.api === "object" ? src.api : src) as Record<string, any>;
  const hooks = (src.webhooks && typeof src.webhooks === "object" ? src.webhooks : src) as Record<
    string,
    any
  >;
  return {
    api_requests_24h: num(api.api_requests_24h ?? api.requests_24h ?? api.total_requests_24h),
    api_errors_24h: num(api.api_errors_24h ?? api.errors_24h),
    api_requests_7d: num(api.api_requests_7d ?? api.requests_7d ?? api.activity_7d),
    rate_limit_events_24h: num(
      api.rate_limit_events_24h ?? api.rate_limited_24h ?? api.rate_limit_events,
    ),
    active_api_keys: num(src.active_api_keys ?? src.api_key_count),
    vineyard_grants: num(src.vineyard_grants ?? src.vineyard_count),
    scope_count: num(src.scope_count ?? src.scopes),
    webhook_endpoints: num(hooks.webhook_endpoints ?? hooks.endpoint_count ?? hooks.endpoints),
    failing_endpoints: num(hooks.failing_endpoints ?? hooks.endpoints_failing),
    pending_deliveries: num(
      hooks.pending_deliveries ?? hooks.pending ?? hooks.retrying_deliveries,
    ),
    health: str(src.health ?? src.health_status),
    health_reasons: healthReasons(src),
    raw: src,
  };
}

export function useAdminIntegrationDiagnostics(clientId: string | undefined) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.diagnostics(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async () =>
      normaliseDiagnostics(
        await rpc("admin_get_integration_diagnostics", { p_client_id: clientId }),
      ),
  });
}

// ---------------------------------------------------------------------------
// API metrics
// ---------------------------------------------------------------------------

export type MetricsWindow = "24h" | "7d" | "30d";

export const METRIC_WINDOWS: { value: MetricsWindow; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export interface ApiMetricsBucket {
  bucket: string;
  total: number;
  errors: number;
  success: number;
  client_errors: number;
  server_errors: number;
  rate_limited: number;
}

export interface AdminApiMetrics {
  total_requests: number | null;
  success_2xx: number | null;
  client_4xx: number | null;
  server_5xx: number | null;
  rate_limited_429: number | null;
  unauthenticated: number | null;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  unique_integrations: number | null;
  unique_api_keys: number | null;
  buckets: ApiMetricsBucket[];
  raw: Record<string, any>;
}

export function normaliseApiMetrics(data: unknown): AdminApiMetrics {
  const obj = asObject(data);
  const totals = (obj.totals && typeof obj.totals === "object" ? obj.totals : obj) as Record<
    string,
    any
  >;
  const buckets = listField(obj, "buckets", "series", "timeline", "breakdown").map((b) => ({
    bucket: String(b.bucket ?? b.bucket_start ?? b.period ?? b.time ?? ""),
    total: num(b.total ?? b.total_requests ?? b.requests) ?? 0,
    errors: num(b.errors ?? b.error_count) ?? 0,
    success: num(b.success_2xx ?? b.status_2xx ?? b.success) ?? 0,
    client_errors: num(b.client_4xx ?? b.status_4xx) ?? 0,
    server_errors: num(b.server_5xx ?? b.status_5xx) ?? 0,
    rate_limited: num(b.rate_limited_429 ?? b.status_429 ?? b.rate_limited) ?? 0,
  }));
  return {
    total_requests: num(totals.total_requests ?? totals.requests ?? totals.total),
    success_2xx: num(totals.success_2xx ?? totals.status_2xx),
    client_4xx: num(totals.client_4xx ?? totals.status_4xx),
    server_5xx: num(totals.server_5xx ?? totals.status_5xx),
    rate_limited_429: num(totals.rate_limited_429 ?? totals.status_429 ?? totals.rate_limited),
    unauthenticated: num(totals.unauthenticated ?? totals.unauthenticated_failures),
    avg_duration_ms: num(totals.avg_duration_ms ?? totals.average_duration_ms),
    p95_duration_ms: num(totals.p95_duration_ms),
    unique_integrations: num(totals.unique_integrations),
    unique_api_keys: num(totals.unique_api_keys),
    buckets,
    raw: obj,
  };
}

export function useAdminApiMetrics(
  window: MetricsWindow,
  clientId: string | null = null,
  groupBy: string | null = "hour",
) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.apiMetrics(window, clientId, groupBy),
    queryFn: async () =>
      normaliseApiMetrics(
        await rpc("admin_integration_api_metrics", {
          p_window: window,
          p_client_id: clientId,
          p_group_by: groupBy,
        }),
      ),
  });
}

// ---------------------------------------------------------------------------
// API request diagnostics
// ---------------------------------------------------------------------------

export interface AdminApiRequest {
  id: string;
  created_at: string | null;
  request_id: string | null;
  client_id: string | null;
  integration_name: string | null;
  api_key_name: string | null;
  api_key_prefix: string | null;
  method: string | null;
  path: string | null;
  vineyard_name: string | null;
  status_code: number | null;
  duration_ms: number | null;
  error_code: string | null;
}

export function normaliseAdminApiRequest(row: Record<string, any>): AdminApiRequest {
  return {
    id: String(row.id ?? ""),
    created_at: str(row.created_at),
    request_id: str(row.request_id),
    client_id: str(row.client_id ?? row.integration_client_id),
    integration_name: str(row.integration_name ?? row.client_name ?? row.name),
    api_key_name: str(row.api_key_name),
    api_key_prefix: str(row.api_key_prefix),
    method: str(row.method),
    path: str(row.path ?? row.endpoint ?? row.route),
    vineyard_name: str(row.vineyard_name),
    status_code: num(row.status_code ?? row.status),
    duration_ms: num(row.duration_ms),
    error_code: str(row.error_code ?? row.error),
  };
}

export interface AdminApiRequestFilters {
  clientId?: string | null;
  apiKeyId?: string | null;
  vineyardId?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  statusClass?: string | null;
  errorsOnly?: boolean;
  rateLimitedOnly?: boolean;
  unauthenticatedOnly?: boolean;
  from?: string | null;
  to?: string | null;
}

export function adminApiRequestsArgs(
  filters: AdminApiRequestFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return {
    p_client_id: filters.clientId ?? null,
    p_api_key_id: filters.apiKeyId ?? null,
    p_vineyard_id: filters.vineyardId ?? null,
    p_method: filters.method ?? null,
    p_path: filters.path ?? null,
    p_status_code: filters.statusCode ?? null,
    p_status_class: filters.statusClass ?? null,
    p_errors_only: filters.errorsOnly ? true : null,
    p_rate_limited_only: filters.rateLimitedOnly ? true : null,
    p_unauthenticated_only: filters.unauthenticatedOnly ? true : null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: limit,
    ...cursorArgs(cursor),
  };
}

export function useAdminApiRequests(
  filters: AdminApiRequestFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.apiRequests(filters, cursor),
    queryFn: async () =>
      asRows(
        await rpc("admin_list_integration_api_requests", adminApiRequestsArgs(filters, cursor, limit)),
      ).map(normaliseAdminApiRequest),
  });
}

// ---------------------------------------------------------------------------
// Webhook metrics / endpoints / deliveries
// ---------------------------------------------------------------------------

export interface AdminWebhookMetrics {
  delivered: number | null;
  failed: number | null;
  pending: number | null;
  delivering: number | null;
  retry_scheduled: number | null;
  cancelled: number | null;
  auto_disabled_endpoints: number | null;
  success_rate: number | null;
  average_attempts: number | null;
  oldest_pending_at: string | null;
  raw: Record<string, any>;
}

export function normaliseWebhookMetrics(data: unknown): AdminWebhookMetrics {
  const obj = asObject(data);
  const t = (obj.totals && typeof obj.totals === "object" ? obj.totals : obj) as Record<string, any>;
  return {
    delivered: num(t.delivered),
    failed: num(t.failed),
    pending: num(t.pending),
    delivering: num(t.delivering),
    retry_scheduled: num(t.retry_scheduled ?? t.retrying),
    cancelled: num(t.cancelled),
    auto_disabled_endpoints: num(t.auto_disabled_endpoints ?? t.auto_disabled),
    success_rate: num(t.success_rate),
    average_attempts: num(t.average_attempts ?? t.avg_attempts),
    oldest_pending_at: str(t.oldest_pending_at ?? t.oldest_pending_delivery_at),
    raw: obj,
  };
}

export function useAdminWebhookMetrics(
  window: MetricsWindow,
  clientId: string | null = null,
) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.webhookMetrics(window, clientId),
    queryFn: async () =>
      normaliseWebhookMetrics(
        await rpc("admin_webhook_metrics", { p_window: window, p_client_id: clientId }),
      ),
  });
}

export interface AdminWebhookEndpoint {
  id: string;
  created_at: string | null;
  client_id: string | null;
  integration_name: string | null;
  owner_name: string | null;
  name: string | null;
  /** Safe representation returned by the RPC — never rebuilt in the portal. */
  url: string | null;
  status: string | null;
  subscription_count: number | null;
  consecutive_failures: number | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  disabled_reason: string | null;
}

export function normaliseWebhookEndpoint(row: Record<string, any>): AdminWebhookEndpoint {
  return {
    id: String(row.id ?? row.endpoint_id ?? ""),
    created_at: str(row.created_at),
    client_id: str(row.client_id),
    integration_name: str(row.integration_name ?? row.client_name),
    owner_name: str(row.owner_name ?? row.customer_name ?? row.organisation),
    name: str(row.name ?? row.endpoint_name),
    url: str(row.url ?? row.safe_url ?? row.url_display ?? row.hostname ?? row.host),
    status: str(row.status),
    subscription_count: num(row.subscription_count ?? row.subscriptions ?? row.event_count),
    consecutive_failures: num(row.consecutive_failures ?? row.failure_count),
    last_success_at: str(row.last_success_at),
    last_failure_at: str(row.last_failure_at),
    disabled_reason: str(row.disabled_reason ?? row.disabled_at_reason),
  };
}

export interface AdminEndpointFilters {
  clientId?: string | null;
  status?: string | null;
  failingOnly?: boolean;
  includeDeleted?: boolean;
}

export function adminEndpointsArgs(
  filters: AdminEndpointFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return {
    p_client_id: filters.clientId ?? null,
    p_status: filters.status ?? null,
    p_failing_only: filters.failingOnly ? true : null,
    p_include_deleted: filters.includeDeleted ? true : null,
    p_limit: limit,
    ...cursorArgs(cursor),
  };
}

export function useAdminWebhookEndpoints(
  filters: AdminEndpointFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.webhookEndpoints(filters, cursor),
    queryFn: async () =>
      asRows(
        await rpc("admin_list_webhook_endpoints", adminEndpointsArgs(filters, cursor, limit)),
      ).map(normaliseWebhookEndpoint),
  });
}

export interface AdminWebhookDelivery {
  id: string;
  created_at: string | null;
  event_type: string | null;
  client_id: string | null;
  integration_name: string | null;
  endpoint_name: string | null;
  vineyard_name: string | null;
  status: string | null;
  attempts: number | null;
  http_status: number | null;
  error_category: string | null;
  next_retry_at: string | null;
  replay_of_delivery_id: string | null;
  is_test: boolean;
}

export function normaliseWebhookDelivery(row: Record<string, any>): AdminWebhookDelivery {
  return {
    id: String(row.id ?? row.delivery_id ?? ""),
    created_at: str(row.created_at),
    event_type: str(row.event_type ?? row.event),
    client_id: str(row.client_id),
    integration_name: str(row.integration_name ?? row.client_name),
    endpoint_name: str(row.endpoint_name ?? row.endpoint),
    vineyard_name: str(row.vineyard_name),
    status: str(row.status),
    attempts: num(row.attempts ?? row.attempt_count),
    http_status: num(row.http_status ?? row.response_status ?? row.status_code),
    error_category: str(row.error_category ?? row.error),
    next_retry_at: str(row.next_retry_at ?? row.next_attempt_at),
    replay_of_delivery_id: str(row.replay_of_delivery_id ?? row.replay_of),
    is_test: bool(row.is_test),
  };
}

export interface AdminDeliveryFilters {
  clientId?: string | null;
  endpointId?: string | null;
  eventType?: string | null;
  status?: string | null;
  vineyardId?: string | null;
  isTest?: boolean | null;
  from?: string | null;
  to?: string | null;
}

export function adminDeliveriesArgs(
  filters: AdminDeliveryFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return {
    p_client_id: filters.clientId ?? null,
    p_endpoint_id: filters.endpointId ?? null,
    p_event_type: filters.eventType ?? null,
    p_status: filters.status ?? null,
    p_vineyard_id: filters.vineyardId ?? null,
    p_is_test: filters.isTest ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: limit,
    ...cursorArgs(cursor),
  };
}

export function useAdminWebhookDeliveries(
  filters: AdminDeliveryFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.webhookDeliveries(filters, cursor),
    queryFn: async () =>
      asRows(
        await rpc("admin_list_webhook_deliveries", adminDeliveriesArgs(filters, cursor, limit)),
      ).map(normaliseWebhookDelivery),
  });
}

// ---------------------------------------------------------------------------
// Audit history
// ---------------------------------------------------------------------------

export interface AdminAuditEntry {
  id: string;
  created_at: string | null;
  action: string;
  actor: string | null;
  actor_type: string | null;
  integration_name: string | null;
  client_id: string | null;
  target: string | null;
  summary: string | null;
  metadata: Record<string, any> | null;
}

const SAFE_SUMMARY_KEYS = [
  "reason",
  "scope",
  "environment",
  "name",
  "key_name",
  "key_prefix",
  "status",
  "action",
  "endpoint_name",
  "vineyard_name",
];

export function safeAuditSummary(entry: AdminAuditEntry): string {
  if (entry.summary) return entry.summary;
  const meta = entry.metadata;
  if (!meta) return "—";
  const parts = SAFE_SUMMARY_KEYS.filter((k) => meta[k] != null).map(
    (k) => `${k.replace(/_/g, " ")}: ${String(meta[k])}`,
  );
  return parts.length ? parts.join(" · ") : "—";
}

export function normaliseAdminAudit(row: Record<string, any>): AdminAuditEntry {
  return {
    id: String(row.id ?? ""),
    created_at: str(row.created_at),
    action: String(row.action ?? "unknown"),
    actor: str(row.actor ?? row.actor_email ?? row.actor_name),
    actor_type: str(row.actor_type),
    integration_name: str(row.integration_name ?? row.client_name),
    client_id: str(row.client_id),
    target: str(row.target ?? row.target_label ?? row.target_type),
    summary: str(row.summary ?? row.safe_summary),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, any>)
        : null,
  };
}

export interface AdminAuditFilters {
  clientId?: string | null;
  action?: string | null;
  actorUserId?: string | null;
  vineyardId?: string | null;
  from?: string | null;
  to?: string | null;
}

export function adminAuditArgs(
  filters: AdminAuditFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return {
    p_client_id: filters.clientId ?? null,
    p_action: filters.action ?? null,
    p_actor_user_id: filters.actorUserId ?? null,
    p_vineyard_id: filters.vineyardId ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: limit,
    ...cursorArgs(cursor),
  };
}

export function useAdminIntegrationAudit(
  filters: AdminAuditFilters,
  cursor: KeysetCursor | null,
  limit = ADMIN_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ADMIN_INTEGRATION_KEYS.audit(filters, cursor),
    queryFn: async () =>
      asRows(await rpc("admin_list_integration_audit", adminAuditArgs(filters, cursor, limit))).map(
        normaliseAdminAudit,
      ),
  });
}

// ---------------------------------------------------------------------------
// Admin controls (high impact — always behind a confirmation dialog)
// ---------------------------------------------------------------------------

function useAdminInvalidate() {
  const qc = useQueryClient();
  return (clientId?: string | null) => {
    qc.invalidateQueries({ queryKey: ADMIN_INTEGRATION_KEYS.root });
    if (clientId) {
      qc.invalidateQueries({ queryKey: ADMIN_INTEGRATION_KEYS.detail(clientId) });
      qc.invalidateQueries({ queryKey: ADMIN_INTEGRATION_KEYS.diagnostics(clientId) });
    }
  };
}

export function useAdminSuspendIntegration() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (args: { clientId: string; reason: string }) =>
      rpc("admin_suspend_integration", {
        p_client_id: args.clientId,
        p_reason: args.reason || null,
      }),
    onSuccess: (_d, vars) => invalidate(vars.clientId),
  });
}

export function useAdminReactivateIntegration() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (args: { clientId: string }) =>
      rpc("admin_reactivate_integration", { p_client_id: args.clientId }),
    onSuccess: (_d, vars) => invalidate(vars.clientId),
  });
}

export function useAdminRevokeApiKey() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (args: { apiKeyId: string; reason: string; clientId?: string }) =>
      rpc("admin_revoke_integration_api_key", {
        p_api_key_id: args.apiKeyId,
        p_reason: args.reason || null,
      }),
    onSuccess: (_d, vars) => invalidate(vars.clientId),
  });
}

export function useAdminSetEndpointStatus() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (args: {
      endpointId: string;
      status: string;
      reason: string;
      clientId?: string;
    }) =>
      rpc("admin_set_webhook_endpoint_status", {
        p_endpoint_id: args.endpointId,
        p_status: args.status,
        p_reason: args.reason || null,
      }),
    onSuccess: (_d, vars) => invalidate(vars.clientId),
  });
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export const HEALTH_LABELS: Record<string, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
  inactive: "Inactive",
};

export function healthLabel(health: string | null | undefined): string {
  if (!health) return "Unknown";
  return HEALTH_LABELS[health] ?? health;
}

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

export function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

/** Safe API key label — name and prefix only. Never a value or hash. */
export function safeKeyLabel(row: {
  name?: string | null;
  key_name?: string | null;
  key_prefix?: string | null;
  prefix?: string | null;
}): string {
  const name = row.name ?? row.key_name ?? null;
  const prefix = row.key_prefix ?? row.prefix ?? null;
  if (name && prefix) return `${name} · ${prefix}`;
  return name ?? prefix ?? "API key";
}

/** Public API rate limit — displayed for context only; not configurable here. */
export const PUBLIC_API_RATE_LIMIT = "300 requests / minute / API key";

export const RETENTION_NOTICE =
  "Integration log retention policy is not yet configured.";
