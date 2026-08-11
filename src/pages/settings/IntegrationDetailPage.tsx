// Stage 4 — Integration detail (Overview / Vineyards / Permissions / API Keys /
// API Logs / Audit History / Webhooks).
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { useVineyard } from "@/context/VineyardContext";
import { IntegrationStatusBadge } from "@/components/integrations/IntegrationStatusBadge";
import { IntegrationOverviewTab } from "@/components/integrations/IntegrationOverviewTab";
import { IntegrationVineyardsTab } from "@/components/integrations/IntegrationVineyardsTab";
import { IntegrationPermissionsTab } from "@/components/integrations/IntegrationPermissionsTab";
import { IntegrationApiKeysTab } from "@/components/integrations/IntegrationApiKeysTab";
import { IntegrationApiLogsTab } from "@/components/integrations/IntegrationApiLogsTab";
import { IntegrationAuditTab } from "@/components/integrations/IntegrationAuditTab";
import { IntegrationWebhooksTab } from "@/components/integrations/IntegrationWebhooksTab";
import {
  integrationErrorMessage,
  integrationTypeLabel,
  useIntegrationApiKeys,
  useIntegrationClient,
  useIntegrationScopes,
  useIntegrationVineyards,
} from "@/lib/integrationsQuery";

export default function IntegrationDetailPage() {
  // Route is declared as /settings/integrations/:clientId — read that param.
  const params = useParams<{ clientId?: string; id?: string }>();
  const clientId = params.clientId ?? params.id ?? "";
  const { currentRole, loading: rolesLoading } = useVineyard();
  const canManage = currentRole === "owner";
  const [tab, setTab] = useState("overview");

  const { client, isLoading, isError, error } = useIntegrationClient(clientId);
  const vineyards = useIntegrationVineyards(clientId);
  const scopes = useIntegrationScopes(clientId);
  const keys = useIntegrationApiKeys(clientId);

  if (isLoading || rolesLoading) {
    return (
      <div className="space-y-4 p-4 md:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !client) {
    return (
      <div className="space-y-4 p-4 md:p-8">
        <Button variant="ghost" asChild>
          <Link to="/settings/integrations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to integrations
          </Link>
        </Button>
        <PortalNotice
          variant="error"
          description={
            isError
              ? integrationErrorMessage(error)
              : "This integration could not be found or you no longer have access."
          }
        />
      </div>
    );
  }

  const revoked = client.status === "revoked";

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link to="/settings/integrations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Integrations &amp; API
          </Link>
        </Button>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
              <IntegrationStatusBadge status={client.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {integrationTypeLabel(client.integration_type)}
              {client.description ? ` · ${client.description}` : ""}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/settings/integrations/docs">
              <BookOpen className="mr-2 h-4 w-4" />
              API documentation
            </Link>
          </Button>
        </div>
      </div>

      {revoked && (
        <PortalNotice
          variant="warning"
          title="This integration has been revoked"
          description="Its API access is permanently disabled. Revocation is terminal and cannot be undone."
        />
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vineyards">Vineyards</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="logs">API Logs</TabsTrigger>
          <TabsTrigger value="audit">Audit History</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <IntegrationOverviewTab
            client={client}
            canManage={canManage}
            vineyardCount={vineyards.data ? vineyards.data.length : null}
            scopeCount={
              scopes.isLoading ? null : scopes.rows.filter((s) => s.granted).length
            }
            apiKeys={keys.data}
          />
        </TabsContent>
        <TabsContent value="vineyards">
          <IntegrationVineyardsTab clientId={clientId} canManage={canManage && !revoked} />
        </TabsContent>
        <TabsContent value="permissions">
          <IntegrationPermissionsTab
            clientId={clientId}
            canManage={canManage}
            disabled={revoked}
          />
        </TabsContent>
        <TabsContent value="keys">
          <IntegrationApiKeysTab
            clientId={clientId}
            canManage={canManage}
            disabled={revoked}
          />
        </TabsContent>
        <TabsContent value="logs">
          <IntegrationApiLogsTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="audit">
          <IntegrationAuditTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="webhooks">
          <IntegrationWebhooksTab
            clientId={clientId}
            canManage={canManage}
            disabled={revoked}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
