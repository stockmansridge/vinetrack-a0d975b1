import { useMemo, useState } from "react";
import { Send, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { IntegrationEmptyState } from "./IntegrationEmptyState";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/dateFormat";
import { useToast } from "@/hooks/use-toast";
import {
  groupedWebhookEvents,
  integrationErrorMessage,
  nextWebhookDeliveryCursor,
  useReplayWebhookDelivery,
  useWebhookDeliveries,
  useWebhookDelivery,
  webhookDeliveryStatusLabel,
  webhookDeliveryTone,
  webhookEventLabel,
  WEBHOOK_DELIVERY_PAGE_SIZE,
  type ApiRequestCursor,
  type WebhookDelivery,
  type WebhookDeliveryFilters,
} from "@/lib/integrationsQuery";

const TONE_CLASS: Record<string, string> = {
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  error:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function DeliveryStatusBadge({ delivery }: { delivery: WebhookDelivery }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-medium", TONE_CLASS[webhookDeliveryTone(delivery.status)])}
    >
      {webhookDeliveryStatusLabel(delivery)}
    </Badge>
  );
}

export function WebhookDeliveriesPanel({
  clientId,
  endpointId,
  canManage,
  showEndpointColumn = false,
}: {
  clientId: string;
  endpointId?: string;
  canManage: boolean;
  showEndpointColumn?: boolean;
}) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<WebhookDeliveryFilters>({});
  const [cursorStack, setCursorStack] = useState<(ApiRequestCursor | null)[]>([null]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const effective = useMemo<WebhookDeliveryFilters>(
    () => ({ ...filters, endpointId: endpointId ?? filters.endpointId ?? null }),
    [filters, endpointId],
  );
  const cursor = cursorStack[cursorStack.length - 1] ?? null;
  const deliveries = useWebhookDeliveries(clientId, effective, cursor);
  const rows = deliveries.data ?? [];
  const nextCursor = nextWebhookDeliveryCursor(rows, WEBHOOK_DELIVERY_PAGE_SIZE);
  const replay = useReplayWebhookDelivery(clientId);

  const patch = (next: Partial<WebhookDeliveryFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setCursorStack([null]);
  };

  const doReplay = async (delivery: WebhookDelivery) => {
    try {
      await replay.mutateAsync(delivery.id);
      toast({
        title: "Delivery replayed",
        description: "A new delivery has been queued with the original payload.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not replay delivery",
        description: integrationErrorMessage(e),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="delivery-event">Event</Label>
          <Select
            value={filters.eventType ?? "all"}
            onValueChange={(v) => patch({ eventType: v === "all" ? null : v })}
          >
            <SelectTrigger id="delivery-event">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">All events</SelectItem>
              {groupedWebhookEvents().map((group) => (
                <SelectGroup key={group.group}>
                  <SelectLabel>{group.group}</SelectLabel>
                  {group.events.map((e) => (
                    <SelectItem key={e.event} value={e.event}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery-status">Status</Label>
          <select
            id="delivery-status"
            aria-label="Status"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={filters.status ?? ""}
            onChange={(e) => patch({ status: e.target.value || null })}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="delivering">Delivering</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery-from">From</Label>
          <Input
            id="delivery-from"
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => patch({ from: e.target.value || null })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery-to">To</Label>
          <Input
            id="delivery-to"
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => patch({ to: e.target.value || null })}
          />
        </div>
      </div>

      {deliveries.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : deliveries.isError ? (
        <div className="space-y-3">
          <PortalNotice
            variant="error"
            description="Webhook deliveries could not be loaded."
          />
          <Button variant="outline" onClick={() => deliveries.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <IntegrationEmptyState
          icon={Send}
          title="No deliveries"
          description="No webhook deliveries match the selected filters."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date / time</TableHead>
                  <TableHead>Event</TableHead>
                  {showEndpointColumn && <TableHead>Endpoint</TableHead>}
                  <TableHead>Vineyard</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Last response</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(row.id)}
                  >
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {row.event_type ? webhookEventLabel(row.event_type) : "—"}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {row.event_type ?? ""}
                        </span>
                        {row.is_test && (
                          <Badge variant="outline" className="text-[10px]">
                            Test
                          </Badge>
                        )}
                        {row.replay_of && (
                          <Badge variant="outline" className="text-[10px]">
                            Replay
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    {showEndpointColumn && (
                      <TableCell>{row.endpoint_name ?? "—"}</TableCell>
                    )}
                    <TableCell>{row.vineyard_name ?? "—"}</TableCell>
                    <TableCell>
                      <DeliveryStatusBadge delivery={row} />
                    </TableCell>
                    <TableCell>{row.attempt_count}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.last_status_code ?? row.last_error_code ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Showing {rows.length} deliver{rows.length === 1 ? "y" : "ies"}, newest first.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursorStack.length <= 1}
                onClick={() => setCursorStack((s) => s.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!nextCursor}
                onClick={() => nextCursor && setCursorStack((s) => [...s, nextCursor])}
              >
                Next page
              </Button>
            </div>
          </div>
        </>
      )}

      <WebhookDeliveryDetailSheet
        clientId={clientId}
        deliveryId={selectedId}
        canManage={canManage}
        onClose={() => setSelectedId(null)}
        onReplay={doReplay}
        replaying={replay.isPending}
      />
    </div>
  );
}

function WebhookDeliveryDetailSheet({
  clientId,
  deliveryId,
  canManage,
  onClose,
  onReplay,
  replaying,
}: {
  clientId: string;
  deliveryId: string | null;
  canManage: boolean;
  onClose: () => void;
  onReplay: (d: WebhookDelivery) => void;
  replaying: boolean;
}) {
  const query = useWebhookDelivery(clientId, deliveryId);
  const delivery = query.data ?? null;

  return (
    <Sheet open={!!deliveryId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Webhook delivery</SheetTitle>
          <SheetDescription>
            Delivery metadata, attempt history and the exact event payload sent.
          </SheetDescription>
        </SheetHeader>

        {query.isLoading ? (
          <div className="mt-6 space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : query.isError || !delivery ? (
          <PortalNotice
            className="mt-6"
            variant="error"
            description="This delivery could not be loaded."
          />
        ) : (
          <div className="mt-6 space-y-6">
            <dl className="space-y-3 text-sm">
              {[
                ["Delivery ID", delivery.public_id ?? delivery.id],
                ["Event ID", delivery.event_id ?? "—"],
                [
                  "Event",
                  delivery.event_type ? webhookEventLabel(delivery.event_type) : "—",
                ],
                ["Endpoint", delivery.endpoint_name ?? "—"],
                ["Vineyard", delivery.vineyard_name ?? "—"],
                ["Status", <DeliveryStatusBadge delivery={delivery} />],
                ["Attempts", String(delivery.attempt_count)],
                [
                  "Next attempt",
                  delivery.next_attempt_at ? formatDateTime(delivery.next_attempt_at) : "—",
                ],
                ["Created", formatDateTime(delivery.created_at)],
                [
                  "Delivered",
                  delivery.delivered_at ? formatDateTime(delivery.delivered_at) : "—",
                ],
                ["API version", delivery.api_version ?? "—"],
                ["Test event", delivery.is_test ? "Yes" : "No"],
                ["Replay of", delivery.replay_of_public_id ?? delivery.replay_of ?? "—"],
              ].map(([label, value], i) => (
                <div key={i} className="flex items-start justify-between gap-4">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label as string}
                  </dt>
                  <dd className="break-all text-right">{value as React.ReactNode}</dd>
                </div>
              ))}
            </dl>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Attempt history</h4>
              {delivery.attempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attempts recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {delivery.attempts.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{a.attempt_number ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatDateTime(a.attempted_at)}
                          </TableCell>
                          <TableCell>{a.http_status ?? "—"}</TableCell>
                          <TableCell>
                            {a.duration_ms == null ? "—" : `${a.duration_ms} ms`}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {a.error_category ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Event payload</h4>
              <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">
                {delivery.payload
                  ? JSON.stringify(delivery.payload, null, 2)
                  : "Payload not available."}
              </pre>
            </div>

            {canManage && (
              <Button
                variant="outline"
                disabled={replaying}
                onClick={() => onReplay(delivery)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Replay delivery
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
