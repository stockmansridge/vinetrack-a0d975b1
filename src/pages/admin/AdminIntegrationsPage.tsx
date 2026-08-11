// Stage 7B — platform-admin integration dashboard (/admin/integrations).
// Health classification, metrics and filtering all come from the Stage 7A RPCs.
import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminGate, AdminPageHeader } from "./_shared";
import { MetricCard } from "@/components/admin/integrations/AdminIntegrationBits";
import { AdminIntegrationDirectory } from "@/components/admin/integrations/AdminIntegrationDirectory";
import { AdminApiMetricsPanel } from "@/components/admin/integrations/AdminApiMetricsPanel";
import { AdminApiRequestsPanel } from "@/components/admin/integrations/AdminApiRequestsPanel";
import { AdminWebhooksTab } from "@/components/admin/integrations/AdminWebhooksPanel";
import { AdminIntegrationAuditPanel } from "@/components/admin/integrations/AdminIntegrationAuditPanel";
import { BetaAdminBanner } from "@/components/BetaAdminBanner";
import {
  RETENTION_NOTICE,
  formatNumber,
  useAdminApiMetrics,
  useAdminIntegrations,
  useAdminWebhookMetrics,
} from "@/lib/adminIntegrationsQuery";

function SummaryCards() {
  const list = useAdminIntegrations({}, null, 200);
  const api = useAdminApiMetrics("24h", null, "hour");
  const hooks = useAdminWebhookMetrics("24h", null);

  const counts = useMemo(() => {
    const rows = list.data ?? [];
    const by = (h: string) => rows.filter((r) => r.health === h).length;
    return {
      total: rows.length,
      healthy: by("healthy"),
      warning: by("warning"),
      critical: by("critical"),
      inactive: by("inactive"),
    };
  }, [list.data]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard label="Total integrations" value={formatNumber(counts.total)} />
      <MetricCard label="Healthy" value={formatNumber(counts.healthy)} />
      <MetricCard label="Warning" value={formatNumber(counts.warning)} />
      <MetricCard label="Critical" value={formatNumber(counts.critical)} />
      <MetricCard label="Inactive" value={formatNumber(counts.inactive)} />
      <MetricCard label="API requests — 24h" value={formatNumber(api.data?.total_requests)} />
      <MetricCard
        label="API errors — 24h"
        value={formatNumber(
          api.data ? (api.data.client_4xx ?? 0) + (api.data.server_5xx ?? 0) : null,
        )}
      />
      <MetricCard label="Rate limited — 24h" value={formatNumber(api.data?.rate_limited_429)} />
      <MetricCard label="Webhook failures — 24h" value={formatNumber(hooks.data?.failed)} />
      <MetricCard
        label="Auto-disabled endpoints"
        value={formatNumber(hooks.data?.auto_disabled_endpoints)}
      />
    </div>
  );
}

export default function AdminIntegrationsPage() {
  return (
    <AdminGate>
      <div className="p-4 md:p-8">
        <AdminPageHeader
          title="Integrations"
          subtitle="Platform-wide integration health, API activity and webhook diagnostics"
        />
        <BetaAdminBanner />

        <div className="space-y-6">
          <SummaryCards />

          <Tabs defaultValue="directory" className="space-y-4">
            <TabsList className="flex w-full flex-wrap justify-start">
              <TabsTrigger value="directory">Directory</TabsTrigger>
              <TabsTrigger value="api">API activity</TabsTrigger>
              <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
              <TabsTrigger value="audit">Audit history</TabsTrigger>
            </TabsList>

            <TabsContent value="directory">
              <AdminIntegrationDirectory />
            </TabsContent>
            <TabsContent value="api" className="space-y-6">
              <AdminApiMetricsPanel />
              <AdminApiRequestsPanel />
            </TabsContent>
            <TabsContent value="webhooks">
              <AdminWebhooksTab />
            </TabsContent>
            <TabsContent value="audit">
              <AdminIntegrationAuditPanel />
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">{RETENTION_NOTICE}</p>
        </div>
      </div>
    </AdminGate>
  );
}
