import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IntegrationEmptyState } from "./IntegrationEmptyState";
import {
  auditActionLabel,
  formatDateTime,
  integrationErrorMessage,
  useIntegrationAudit,
} from "@/lib/integrationsQuery";

const SAFE_META_KEYS = ["scope", "environment", "name", "key_name", "status", "action"];

function safeMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "—";
  const parts = SAFE_META_KEYS.filter((k) => metadata[k] != null).map(
    (k) => `${k.replace(/_/g, " ")}: ${String(metadata[k])}`,
  );
  return parts.length ? parts.join(" · ") : "—";
}

export function IntegrationAuditTab({ clientId }: { clientId: string }) {
  const audit = useIntegrationAudit(clientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit history</CardTitle>
      </CardHeader>
      <CardContent>
        {audit.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : audit.isError ? (
          <PortalNotice
            variant="error"
            description={integrationErrorMessage(audit.error)}
          />
        ) : (audit.data ?? []).length === 0 ? (
          <IntegrationEmptyState
            icon={History}
            title="No history yet"
            description="Changes to this integration will be recorded here."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date / time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Vineyard</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(audit.data ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(entry.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {auditActionLabel(entry.action)}
                    </TableCell>
                    <TableCell>{entry.actor ?? "—"}</TableCell>
                    <TableCell>{entry.vineyard_name ?? (entry.vineyard_id ? "Vineyard" : "—")}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {safeMetadata(entry.metadata)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
