import { Webhook } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IntegrationEmptyState } from "./IntegrationEmptyState";

export function IntegrationWebhooksTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Webhooks</CardTitle>
      </CardHeader>
      <CardContent>
        <IntegrationEmptyState
          icon={Webhook}
          title="Webhooks"
          description="Webhook delivery management will be added in the next integration stage."
        />
      </CardContent>
    </Card>
  );
}
