// Stage 7B — platform-admin integration detail (/admin/integrations/:clientId).
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminGate, AdminPageHeader } from "./_shared";
import {
  AdminQueryState,
  HealthBadge,
  MetricCard,
} from "@/components/admin/integrations/AdminIntegrationBits";
import { AdminApiMetricsPanel } from "@/components/admin/integrations/AdminApiMetricsPanel";
import { AdminApiRequestsPanel } from "@/components/admin/integrations/AdminApiRequestsPanel";
import { AdminWebhooksTab } from "@/components/admin/integrations/AdminWebhooksPanel";
import { AdminIntegrationAuditPanel } from "@/components/admin/integrations/AdminIntegrationAuditPanel";
import {
  ReactivateIntegrationButton,
  RevokeApiKeyButton,
  SuspendIntegrationButton,
} from "@/components/admin/integrations/AdminIntegrationControls";
import {
  RETENTION_NOTICE,
  formatDateTime,
  formatNumber,
  integrationErrorMessage,
  safeKeyLabel,
  useAdminIntegration,
  useAdminIntegrationDiagnostics,
} from "@/lib/adminIntegrationsQuery";

function DiagnosticsSummary({ clientId }: { clientId: string }) {
  const q = useAdminIntegrationDiagnostics(clientId);
  const d = q.data;
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Support diagnostics</h2>
      <AdminQueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!d}
        emptyTitle="Diagnostics unavailable"
        emptyDescription="No diagnostics were returned for this integration."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="24h API requests" value={formatNumber(d?.api_requests_24h)} />
          <MetricCard label="24h errors" value={formatNumber(d?.api_errors_24h)} />
          <MetricCard label="7d activity" value={formatNumber(d?.api_requests_7d)} />
          <MetricCard label="Rate-limit events" value={formatNumber(d?.rate_limit_events_24h)} />
          <MetricCard label="Active keys" value={formatNumber(d?.active_api_keys)} />
          <MetricCard label="Vineyard grants" value={formatNumber(d?.vineyard_grants)} />
          <MetricCard label="Scopes" value={formatNumber(d?.scope_count)} />
          <MetricCard label="Webhook endpoints" value={formatNumber(d?.webhook_endpoints)} />
          <MetricCard label="Failing endpoints" value={formatNumber(d?.failing_endpoints)} />
          <MetricCard label="Pending deliveries" value={formatNumber(d?.pending_deliveries)} />
        </div>
      </AdminQueryState>
    </div>
  );
}

export default function AdminIntegrationDetailPage() {
  const { clientId = "" } = useParams<{ clientId: string }>();
  const q = useAdminIntegration(clientId);
  const integration = q.data;

  return (
    <AdminGate>
      <div className="p-4 md:p-8">
        <AdminPageHeader
          title={integration?.name ?? "Integration"}
          subtitle="Platform admin view"
          back="/admin/integrations"
          actions={
            integration ? (
              <div className="flex gap-2">
                {integration.status === "active" ? (
                  <SuspendIntegrationButton clientId={clientId} />
                ) : (
                  <ReactivateIntegrationButton clientId={clientId} />
                )}
              </div>
            ) : undefined
          }
        />

        {q.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : q.isError || !integration ? (
          <PortalNotice
            variant="error"
            description={
              q.isError
                ? integrationErrorMessage(q.error)
                : "This integration could not be found."
            }
          />
        ) : (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="flex w-full flex-wrap justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="api">API Activity</TabsTrigger>
              <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
              <TabsTrigger value="access">Access &amp; Keys</TabsTrigger>
              <TabsTrigger value="audit">Audit History</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Integration</dt>
                      <dd className="font-medium">{integration.name}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Integration ID</dt>
                      <dd className="font-mono text-xs">{integration.id}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Customer</dt>
                      <dd>
                        {integration.organisation ??
                          integration.owner_name ??
                          integration.owner_email ??
                          "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd>
                        <Badge variant="outline">{integration.status}</Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Environment</dt>
                      <dd>{integration.environment ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Health</dt>
                      <dd>
                        <HealthBadge
                          health={integration.health}
                          reasons={integration.health_reasons}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Created</dt>
                      <dd>{formatDateTime(integration.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Updated</dt>
                      <dd>{formatDateTime(integration.updated_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Last API activity</dt>
                      <dd>{formatDateTime(integration.last_api_activity_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Last webhook activity</dt>
                      <dd>{formatDateTime(integration.last_webhook_activity_at)}</dd>
                    </div>
                  </dl>
                  {integration.health_reasons.length > 0 && (
                    <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {integration.health_reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <DiagnosticsSummary clientId={clientId} />
              <p className="text-xs text-muted-foreground">{RETENTION_NOTICE}</p>
            </TabsContent>

            <TabsContent value="api" className="space-y-6">
              <AdminApiMetricsPanel clientId={clientId} />
              <AdminApiRequestsPanel clientId={clientId} showIntegrationColumn={false} />
            </TabsContent>

            <TabsContent value="webhooks">
              <AdminWebhooksTab clientId={clientId} />
            </TabsContent>

            <TabsContent value="access" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Vineyard grants</CardTitle>
                </CardHeader>
                <CardContent>
                  {integration.vineyards.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No vineyard grants.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vineyard</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {integration.vineyards.map((v, i) => (
                          <TableRow key={String(v.vineyard_id ?? v.id ?? i)}>
                            <TableCell>{v.vineyard_name ?? v.name ?? "—"}</TableCell>
                            <TableCell>
                              {v.revoked_at ? "Revoked" : (v.status ?? "Granted")}
                            </TableCell>
                            <TableCell>
                              {formatDateTime(v.granted_at ?? v.created_at ?? null)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scopes</CardTitle>
                </CardHeader>
                <CardContent>
                  {integration.scopes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No scopes granted.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scope</TableHead>
                          <TableHead>Label</TableHead>
                          <TableHead>Sensitive</TableHead>
                          <TableHead>Granted</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {integration.scopes.map((s, i) => (
                          <TableRow key={String(s.scope ?? s.id ?? i)}>
                            <TableCell className="font-mono text-xs">
                              {s.scope ?? s.identifier ?? "—"}
                            </TableCell>
                            <TableCell>{s.label ?? s.description ?? "—"}</TableCell>
                            <TableCell>{s.is_sensitive ? "Yes" : "No"}</TableCell>
                            <TableCell>{formatDateTime(s.granted_at ?? null)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">API keys</CardTitle>
                </CardHeader>
                <CardContent>
                  {integration.api_keys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No API keys.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Key</TableHead>
                          <TableHead>Environment</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Last used</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {integration.api_keys.map((k, i) => {
                          const label = safeKeyLabel(k);
                          const revoked = !!k.revoked_at || k.status === "revoked";
                          return (
                            <TableRow key={String(k.id ?? i)}>
                              <TableCell className="font-medium">{label}</TableCell>
                              <TableCell>{k.environment ?? "—"}</TableCell>
                              <TableCell>{formatDateTime(k.created_at ?? null)}</TableCell>
                              <TableCell>{formatDateTime(k.expires_at ?? null)}</TableCell>
                              <TableCell>{formatDateTime(k.last_used_at ?? null)}</TableCell>
                              <TableCell>{revoked ? "Revoked" : "Active"}</TableCell>
                              <TableCell className="text-right">
                                {!revoked && k.id && (
                                  <RevokeApiKeyButton
                                    apiKeyId={String(k.id)}
                                    keyLabel={label}
                                    clientId={clientId}
                                  />
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audit">
              <AdminIntegrationAuditPanel clientId={clientId} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AdminGate>
  );
}
