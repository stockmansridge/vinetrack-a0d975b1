// Stage 7B — webhook health: metrics, endpoint diagnostics, delivery diagnostics.
// Signing secrets and receiver response bodies are never fetched or rendered.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminQueryState, KeysetPager, MetricCard } from "./AdminIntegrationBits";
import { useKeysetPager } from "./useKeysetPager";
import { EndpointStatusButton } from "./AdminIntegrationControls";
import {
  ADMIN_PAGE_SIZE,
  METRIC_WINDOWS,
  formatDateTime,
  formatNumber,
  formatPercent,
  nextCursor,
  useAdminWebhookDeliveries,
  useAdminWebhookEndpoints,
  useAdminWebhookMetrics,
  type MetricsWindow,
} from "@/lib/adminIntegrationsQuery";
import { useWebhookDelivery } from "@/lib/integrationsQuery";

const ALL = "__all__";

export function AdminWebhookMetricsPanel({ clientId = null }: { clientId?: string | null }) {
  const [window, setWindow] = useState<MetricsWindow>("24h");
  const q = useAdminWebhookMetrics(window, clientId);
  const m = q.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Webhook health</h2>
        <Select value={window} onValueChange={(v) => setWindow(v as MetricsWindow)}>
          <SelectTrigger className="w-40" aria-label="Webhook metrics window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_WINDOWS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <AdminQueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!m}
        emptyTitle="Metrics unavailable"
        emptyDescription="No webhook metrics were returned for this window."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Delivered" value={formatNumber(m?.delivered)} />
          <MetricCard label="Failed" value={formatNumber(m?.failed)} />
          <MetricCard label="Pending" value={formatNumber(m?.pending)} />
          <MetricCard label="Delivering" value={formatNumber(m?.delivering)} />
          <MetricCard label="Retry scheduled" value={formatNumber(m?.retry_scheduled)} />
          <MetricCard label="Cancelled" value={formatNumber(m?.cancelled)} />
          <MetricCard
            label="Auto-disabled endpoints"
            value={formatNumber(m?.auto_disabled_endpoints)}
          />
          <MetricCard label="Success rate" value={formatPercent(m?.success_rate)} />
          <MetricCard label="Average attempts" value={formatNumber(m?.average_attempts)} />
          <MetricCard
            label="Oldest pending"
            value={<span className="text-base">{formatDateTime(m?.oldest_pending_at)}</span>}
          />
        </div>
      </AdminQueryState>
    </div>
  );
}

export function AdminWebhookEndpointsPanel({
  clientId = null,
  showIntegrationColumn = true,
}: {
  clientId?: string | null;
  showIntegrationColumn?: boolean;
}) {
  const pager = useKeysetPager();
  const [failingOnly, setFailingOnly] = useState(false);
  const q = useAdminWebhookEndpoints({ clientId, failingOnly }, pager.cursor);
  const rows = q.data ?? [];
  const cursor = rows.length >= ADMIN_PAGE_SIZE ? nextCursor(rows) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Webhook endpoints</CardTitle>
        <div className="flex items-center gap-2">
          <Switch
            id="failing-only"
            checked={failingOnly}
            onCheckedChange={(v) => {
              setFailingOnly(v);
              pager.reset();
            }}
          />
          <Label htmlFor="failing-only" className="text-xs">
            Failing only
          </Label>
        </div>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isLoading={q.isLoading}
          isError={q.isError}
          error={q.error}
          isEmpty={rows.length === 0}
          emptyTitle="No webhook endpoints"
          emptyDescription="No endpoints matched these filters."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {showIntegrationColumn && <TableHead>Integration</TableHead>}
                  {showIntegrationColumn && <TableHead>Customer</TableHead>}
                  <TableHead>Endpoint</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Subscriptions</TableHead>
                  <TableHead>Consecutive failures</TableHead>
                  <TableHead>Last success</TableHead>
                  <TableHead>Last failure</TableHead>
                  <TableHead>Disabled reason</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    {showIntegrationColumn && <TableCell>{e.integration_name ?? "—"}</TableCell>}
                    {showIntegrationColumn && <TableCell>{e.owner_name ?? "—"}</TableCell>}
                    <TableCell className="font-medium">{e.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.url ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell>{formatNumber(e.subscription_count)}</TableCell>
                    <TableCell>{formatNumber(e.consecutive_failures)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(e.last_success_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(e.last_failure_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.disabled_reason ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <EndpointStatusButton
                        endpointId={e.id}
                        endpointLabel={e.name ?? "endpoint"}
                        status={e.status}
                        clientId={e.client_id ?? clientId ?? undefined}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <KeysetPager
            page={pager.page}
            hasNext={!!cursor}
            onPrev={pager.prev}
            onNext={() => pager.next(cursor)}
          />
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}

export function AdminWebhookDeliveriesPanel({
  clientId = null,
}: {
  clientId?: string | null;
}) {
  const pager = useKeysetPager();
  const [status, setStatus] = useState(ALL);
  const [selected, setSelected] = useState<{ id: string; clientId: string | null } | null>(
    null,
  );
  const q = useAdminWebhookDeliveries(
    { clientId, status: status === ALL ? null : status },
    pager.cursor,
  );
  const rows = q.data ?? [];
  const cursor = rows.length >= ADMIN_PAGE_SIZE ? nextCursor(rows) : null;
  const detail = useWebhookDelivery(
    selected?.clientId ?? clientId ?? undefined,
    selected?.id ?? null,
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Webhook deliveries</CardTitle>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            pager.reset();
          }}
        >
          <SelectTrigger className="w-44" aria-label="Delivery status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="delivering">Delivering</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isLoading={q.isLoading}
          isError={q.isError}
          error={q.error}
          isEmpty={rows.length === 0}
          emptyTitle="No webhook activity"
          emptyDescription="No deliveries matched these filters."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Delivery ID</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Integration</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Vineyard</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Next retry</TableHead>
                  <TableHead>Replay of</TableHead>
                  <TableHead>Test</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow
                    key={d.id}
                    className="cursor-pointer"
                    onClick={() => setSelected({ id: d.id, clientId: d.client_id })}
                  >
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(d.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.id}</TableCell>
                    <TableCell>{d.event_type ?? "—"}</TableCell>
                    <TableCell>{d.integration_name ?? "—"}</TableCell>
                    <TableCell>{d.endpoint_name ?? "—"}</TableCell>
                    <TableCell>{d.vineyard_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{d.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell>{formatNumber(d.attempts)}</TableCell>
                    <TableCell className="font-mono text-xs">{d.http_status ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.error_category ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(d.next_retry_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.replay_of_delivery_id ?? "—"}
                    </TableCell>
                    <TableCell>{d.is_test ? "Test" : "Live"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <KeysetPager
            page={pager.page}
            hasNext={!!cursor}
            onPrev={pager.prev}
            onNext={() => pager.next(cursor)}
          />
        </AdminQueryState>
      </CardContent>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Delivery detail</SheetTitle>
            <SheetDescription className="font-mono text-xs">{selected?.id}</SheetDescription>
          </SheetHeader>
          {detail.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : detail.data ? (
            <div className="mt-4 space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">Event</dt>
                <dd>{detail.data.event_type ?? "—"}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{detail.data.status ?? "—"}</dd>
                <dt className="text-muted-foreground">Attempts</dt>
                <dd>{detail.data.attempts.length}</dd>
              </dl>
              <div>
                <p className="mb-1 font-medium">Attempt history</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {detail.data.attempts.map((a, i) => (
                    <li key={i}>
                      {formatDateTime(a.attempted_at)} · HTTP {a.http_status ?? "—"} ·{" "}
                      {a.error_category ?? "no error"}
                    </li>
                  ))}
                  {detail.data.attempts.length === 0 && <li>No attempts recorded yet.</li>}
                </ul>
              </div>
              {detail.data.payload && (
                <div>
                  <p className="mb-1 font-medium">Event payload</p>
                  <pre className="max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(detail.data.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Delivery details are unavailable.
            </p>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

export function AdminWebhooksTab({ clientId = null }: { clientId?: string | null }) {
  return (
    <div className="space-y-6">
      <AdminWebhookMetricsPanel clientId={clientId} />
      <AdminWebhookEndpointsPanel clientId={clientId} showIntegrationColumn={!clientId} />
      <AdminWebhookDeliveriesPanel clientId={clientId} />
    </div>
  );
}

