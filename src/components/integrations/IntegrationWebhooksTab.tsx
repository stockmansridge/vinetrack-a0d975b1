import { useState } from "react";
import {
  Webhook,
  Plus,
  Send,
  RefreshCw,
  Pencil,
  Trash2,
  Pause,
  Play,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { IntegrationEmptyState } from "./IntegrationEmptyState";
import { WebhookEndpointDialog } from "./WebhookEndpointDialog";
import { WebhookSecretDialog } from "./WebhookSecretDialog";
import { WebhookSubscriptionsPanel } from "./WebhookSubscriptionsPanel";
import { WebhookDeliveriesPanel } from "./WebhookDeliveriesPanel";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/dateFormat";
import { useToast } from "@/hooks/use-toast";
import {
  integrationErrorMessage,
  useDeleteWebhookEndpoint,
  useRotateWebhookSecret,
  useSendTestWebhook,
  useSetWebhookEndpointStatus,
  useWebhookEndpoints,
  type WebhookEndpoint,
} from "@/lib/integrationsQuery";

const ENDPOINT_STATUS_STYLE: Record<string, string> = {
  active:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  paused:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  disabled:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
};

function EndpointStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        ENDPOINT_STATUS_STYLE[status] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export function IntegrationWebhooksTab({
  clientId,
  canManage = false,
  disabled = false,
}: {
  clientId: string;
  canManage?: boolean;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const endpoints = useWebhookEndpoints(clientId);
  const setStatus = useSetWebhookEndpointStatus(clientId);
  const sendTest = useSendTestWebhook(clientId);
  const rotate = useRotateWebhookSecret(clientId);
  const remove = useDeleteWebhookEndpoint(clientId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [selected, setSelected] = useState<WebhookEndpoint | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WebhookEndpoint | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<WebhookEndpoint | null>(null);

  // Transient one-time secret — component state only, never cached or persisted.
  const [secret, setSecret] = useState<string | null>(null);
  const [secretEndpointName, setSecretEndpointName] = useState<string | null>(null);
  const [secretRotated, setSecretRotated] = useState(false);

  const rows = endpoints.data ?? [];
  const readOnly = !canManage || disabled;

  const toggleStatus = async (endpoint: WebhookEndpoint) => {
    const next = endpoint.status === "active" ? "paused" : "active";
    try {
      await setStatus.mutateAsync({ endpointId: endpoint.id, status: next });
      toast({ title: next === "paused" ? "Endpoint paused" : "Endpoint resumed" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not update endpoint",
        description: integrationErrorMessage(e),
      });
    }
  };

  const test = async (endpoint: WebhookEndpoint) => {
    try {
      const res = await sendTest.mutateAsync(endpoint.id);
      toast({
        title: "Test event queued",
        description: res.publicId
          ? `Delivery ${res.publicId} — check the Deliveries tab for the result.`
          : "Check the Deliveries tab for the result.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not send test event",
        description: integrationErrorMessage(e),
      });
    }
  };

  const doRotate = async (endpoint: WebhookEndpoint) => {
    setConfirmRotate(null);
    try {
      const res = await rotate.mutateAsync(endpoint.id);
      setSecretEndpointName(endpoint.name);
      setSecretRotated(true);
      setSecret(res.secret);
      // Drop the secret from the mutation result cache immediately — it now
      // lives only in this component's transient state.
      rotate.reset();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not rotate signing secret",
        description: integrationErrorMessage(e),
      });
    }
  };

  const doDelete = async (endpoint: WebhookEndpoint) => {
    setConfirmDelete(null);
    try {
      await remove.mutateAsync(endpoint.id);
      if (selected?.id === endpoint.id) setSelected(null);
      toast({ title: "Endpoint deleted" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not delete endpoint",
        description: integrationErrorMessage(e),
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Webhook endpoints</CardTitle>
            <p className="text-sm text-muted-foreground">
              VineTrack POSTs signed JSON events to your HTTPS endpoints and retries
              automatically when a delivery fails.
            </p>
          </div>
          {canManage && (
            <Button
              disabled={disabled}
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add endpoint
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {endpoints.isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : endpoints.isError ? (
            <div className="space-y-3">
              <PortalNotice
                variant="error"
                description="Webhook endpoints could not be loaded."
              />
              <Button variant="outline" onClick={() => endpoints.refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <IntegrationEmptyState
              icon={Webhook}
              title="No webhook endpoints"
              description="Add an endpoint to receive VineTrack events in real time instead of polling the API."
            />
          ) : (
            rows.map((endpoint) => (
              <div
                key={endpoint.id}
                className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 space-y-1 text-left"
                  onClick={() => setSelected(endpoint)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{endpoint.name ?? "Untitled endpoint"}</span>
                    <EndpointStatusBadge status={endpoint.status} />
                    {endpoint.consecutive_failures > 0 && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        {endpoint.consecutive_failures} consecutive failures
                      </Badge>
                    )}
                  </div>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {endpoint.url ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {endpoint.subscription_count ?? 0} subscription
                    {endpoint.subscription_count === 1 ? "" : "s"}
                    {endpoint.last_success_at
                      ? ` · Last success ${formatDateTime(endpoint.last_success_at)}`
                      : ""}
                  </p>
                </button>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled || sendTest.isPending}
                      onClick={() => test(endpoint)}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Send test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled || endpoint.status === "disabled"}
                      onClick={() => toggleStatus(endpoint)}
                    >
                      {endpoint.status === "active" ? (
                        <>
                          <Pause className="mr-2 h-4 w-4" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          Resume
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => {
                        setEditing(endpoint);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled || rotate.isPending}
                      onClick={() => setConfirmRotate(endpoint)}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Rotate secret
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setConfirmDelete(endpoint)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <WebhookDeliveriesPanel
            clientId={clientId}
            canManage={!readOnly}
            showEndpointColumn
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verifying deliveries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Every request includes <code className="font-mono">X-VineTrack-Signature</code>,{" "}
            <code className="font-mono">X-VineTrack-Timestamp</code> and{" "}
            <code className="font-mono">X-VineTrack-Delivery</code> headers.
          </p>
          <p>
            Compute an HMAC-SHA256 of{" "}
            <code className="font-mono">{"{timestamp}.{raw body}"}</code> using your signing
            secret, compare it with the signature using a constant-time comparison, and
            reject requests whose timestamp is more than five minutes old.
          </p>
          <p>
            Respond with a 2xx status as soon as you have stored the event. Deliveries are
            retried with exponential backoff, so your handler must be idempotent on the
            delivery ID.
          </p>
        </CardContent>
      </Card>

      <WebhookEndpointDialog
        clientId={clientId}
        open={dialogOpen}
        endpoint={editing}
        onOpenChange={setDialogOpen}
        onCreated={(newSecret, created) => {
          setSecretEndpointName(created.name);
          setSecretRotated(false);
          setSecret(newSecret);
        }}
      />

      <WebhookSecretDialog
        secret={secret}
        endpointName={secretEndpointName}
        rotated={secretRotated}
        onDismiss={() => {
          setSecret(null);
          setSecretEndpointName(null);
        }}
      />

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{selected?.name ?? "Webhook endpoint"}</SheetTitle>
            <SheetDescription className="break-all font-mono text-xs">
              {selected?.url ?? ""}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <Tabs defaultValue="subscriptions" className="mt-6 space-y-4">
              <TabsList>
                <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
                <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              <TabsContent value="subscriptions">
                <WebhookSubscriptionsPanel
                  clientId={clientId}
                  endpointId={selected.id}
                  canManage={canManage}
                  disabled={disabled}
                />
              </TabsContent>
              <TabsContent value="deliveries">
                <WebhookDeliveriesPanel
                  clientId={clientId}
                  endpointId={selected.id}
                  canManage={!readOnly}
                />
              </TabsContent>
              <TabsContent value="details">
                <dl className="space-y-3 text-sm">
                  {[
                    ["Status", <EndpointStatusBadge status={selected.status} />],
                    ["Signing secret", selected.signing_secret_prefix ?? "Hidden"],
                    ["Created", formatDateTime(selected.created_at)],
                    [
                      "Last success",
                      selected.last_success_at
                        ? formatDateTime(selected.last_success_at)
                        : "—",
                    ],
                    [
                      "Last failure",
                      selected.last_failure_at
                        ? formatDateTime(selected.last_failure_at)
                        : "—",
                    ],
                    ["Consecutive failures", String(selected.consecutive_failures)],
                    ["Disabled reason", selected.disabled_reason ?? "—"],
                  ].map(([label, value], i) => (
                    <div key={i} className="flex items-start justify-between gap-4">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {label as string}
                      </dt>
                      <dd className="break-all text-right">{value as React.ReactNode}</dd>
                    </div>
                  ))}
                </dl>
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!confirmRotate}
        onOpenChange={(open) => !open && setConfirmRotate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the signing secret?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret stops working immediately. The new secret is shown once
              and must be updated in your receiving system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRotate && doRotate(confirmRotate)}>
              Rotate secret
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this webhook endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              All subscriptions on this endpoint are removed and no further events will
              be delivered. Existing delivery history is retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && doDelete(confirmDelete)}>
              Delete endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
