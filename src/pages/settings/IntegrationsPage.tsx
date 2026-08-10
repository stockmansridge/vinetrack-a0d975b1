// Stage 4 — Integrations & API list.
// All data comes from the canonical integration RPCs; the portal never reads or
// writes the integration tables directly.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, KeyRound, Plug, Plus, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { MetricCard } from "@/components/ui/metric-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVineyard } from "@/context/VineyardContext";
import { IntegrationStatusBadge } from "@/components/integrations/IntegrationStatusBadge";
import { IntegrationEmptyState } from "@/components/integrations/IntegrationEmptyState";
import { CreateIntegrationDialog } from "@/components/integrations/CreateIntegrationDialog";
import {
  formatDate,
  formatDateTime,
  integrationErrorMessage,
  integrationTypeLabel,
  useIntegrationClients,
  useIntegrationCounts,
} from "@/lib/integrationsQuery";

export default function IntegrationsPage() {
  const navigate = useNavigate();
  const { currentRole, loading: rolesLoading } = useVineyard();
  const canManage = currentRole === "owner";
  const clientsQuery = useIntegrationClients(!rolesLoading);
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const counts = useIntegrationCounts(clients);
  const [createOpen, setCreateOpen] = useState(false);

  const activeCount = clients.filter((c) => c.status === "active").length;
  const pausedCount = clients.filter((c) => c.status === "paused").length;
  const revokedCount = clients.filter((c) => c.status === "revoked").length;
  const keyCount = clients.reduce(
    (sum, c) => sum + (c.api_key_count ?? counts[c.id]?.keys ?? 0),
    0,
  );

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Integrations &amp; API</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Connect VineTrack securely with external systems, reporting tools and
            supported industry platforms.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/settings/integrations/docs">
              <BookOpen className="mr-2 h-4 w-4" />
              API documentation
            </Link>
          </Button>
          {!rolesLoading && canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create integration
            </Button>
          )}
        </div>
      </div>

      {rolesLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Active integrations"
              value={activeCount}
              icon={Plug}
              tone="primary"
            />
            <MetricCard label="API keys" value={keyCount} icon={KeyRound} tone="teal" />
            <MetricCard
              label="Paused"
              value={pausedCount}
              icon={ShieldCheck}
              tone="amber"
            />
            <MetricCard
              label="Revoked"
              value={revokedCount}
              icon={ShieldCheck}
              tone="neutral"
            />
          </div>

          {!canManage && (
            <PortalNotice
              variant="info"
              compact
              description="You have view-only access to integrations. Only a Vineyard Owner can create or change API access."
            />
          )}

          <Card>
            <CardContent className="p-0">
              {clientsQuery.isLoading ? (
                <div className="space-y-2 p-6">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : clientsQuery.isError ? (
                <div className="p-6">
                  <PortalNotice
                    variant="error"
                    description={integrationErrorMessage(clientsQuery.error)}
                  />
                </div>
              ) : clients.length === 0 ? (
                <div className="p-6">
                  <IntegrationEmptyState
                    icon={Plug}
                    title="No integrations yet"
                    description="Connect VineTrack with external systems using secure API access."
                    action={
                      canManage ? (
                        <Button onClick={() => setCreateOpen(true)}>
                          <Plus className="mr-2 h-4 w-4" />
                          Create integration
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Integration</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Vineyards</TableHead>
                        <TableHead>Scopes</TableHead>
                        <TableHead>API keys</TableHead>
                        <TableHead>Last activity</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clients.map((c) => {
                        const derived = counts[c.id];
                        return (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer"
                            onClick={() => navigate(`/settings/integrations/${c.id}`)}
                          >
                            <TableCell className="font-medium">
                              {c.name}
                              {c.description && (
                                <div className="text-xs font-normal text-muted-foreground">
                                  {c.description}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{integrationTypeLabel(c.integration_type)}</TableCell>
                            <TableCell>
                              <IntegrationStatusBadge status={c.status} />
                            </TableCell>
                            <TableCell>
                              {c.vineyard_count ?? derived?.vineyards ?? "—"}
                            </TableCell>
                            <TableCell>{c.scope_count ?? derived?.scopes ?? "—"}</TableCell>
                            <TableCell>{c.api_key_count ?? derived?.keys ?? "—"}</TableCell>
                            <TableCell>{formatDateTime(c.last_request_at)}</TableCell>
                            <TableCell>{formatDate(c.created_at)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <CreateIntegrationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/settings/integrations/${id}`)}
      />
    </div>
  );
}
