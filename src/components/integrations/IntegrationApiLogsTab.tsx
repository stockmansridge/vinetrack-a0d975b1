import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { IntegrationEmptyState } from "./IntegrationEmptyState";
import {
  API_REQUEST_LOG_GAP_MESSAGE,
  API_REQUEST_LOG_RPC_AVAILABLE,
} from "@/lib/integrationsQuery";

/**
 * API request logs.
 *
 * Stage 2 created public.integration_api_requests, but no management read RPC
 * exists yet. The portal will not query the protected table directly and will
 * not add SQL, so this tab reports the gap until Rork ships the RPC.
 */
export function IntegrationApiLogsTab() {
  if (API_REQUEST_LOG_RPC_AVAILABLE) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">API logs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PortalNotice
          variant="info"
          title="Request logs are temporarily unavailable"
          description={`A backend read function is required before request logs can be shown in the portal. ${API_REQUEST_LOG_GAP_MESSAGE}`}
        />
        <IntegrationEmptyState
          icon={Activity}
          title="No requests shown"
          description="No API requests have been recorded yet, or request logs cannot be read from the portal."
        />
      </CardContent>
    </Card>
  );
}
