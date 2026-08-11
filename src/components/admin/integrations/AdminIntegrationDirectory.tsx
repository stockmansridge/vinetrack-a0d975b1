// Stage 7B — global integration directory (admin_list_integrations).
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminQueryState, HealthBadge, KeysetPager } from "./AdminIntegrationBits";
import { useKeysetPager } from "./useKeysetPager";
import {
  ADMIN_PAGE_SIZE,
  formatDateTime,
  formatNumber,
  nextCursor,
  useAdminIntegrations,
  type AdminIntegrationFilters,
  type AdminIntegrationRow,
} from "@/lib/adminIntegrationsQuery";

const ALL = "__all__";

export function AdminIntegrationDirectory({
  onRowsChange,
}: {
  onRowsChange?: (rows: AdminIntegrationRow[]) => void;
}) {
  const pager = useKeysetPager();
  const [status, setStatus] = useState(ALL);
  const [environment, setEnvironment] = useState(ALL);
  const [health, setHealth] = useState(ALL);
  const [activity, setActivity] = useState(ALL);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [rateLimitedOnly, setRateLimitedOnly] = useState(false);
  const [createdFrom, setCreatedFrom] = useState("");
  const [lastUsedFrom, setLastUsedFrom] = useState("");

  const filters: AdminIntegrationFilters = {
    status: status === ALL ? null : status,
    environment: environment === ALL ? null : environment,
    health: health === ALL ? null : health,
    activity: activity === ALL ? null : activity,
    ownerQuery: ownerQuery.trim() || null,
    errorsOnly,
    rateLimitedOnly,
    createdFrom: createdFrom ? new Date(createdFrom).toISOString() : null,
    lastUsedFrom: lastUsedFrom ? new Date(lastUsedFrom).toISOString() : null,
  };

  const q = useAdminIntegrations(filters, pager.cursor);
  const rows = q.data ?? [];
  const cursor = rows.length >= ADMIN_PAGE_SIZE ? nextCursor(rows) : null;
  if (onRowsChange && q.data) onRowsChange(q.data);

  const change = (fn: () => void) => {
    fn();
    pager.reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">All integrations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => change(() => setStatus(v))}>
              <SelectTrigger className="w-36" aria-label="Status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Environment</Label>
            <Select value={environment} onValueChange={(v) => change(() => setEnvironment(v))}>
              <SelectTrigger className="w-36" aria-label="Environment filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All environments</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="test">Test</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Health</Label>
            <Select value={health} onValueChange={(v) => change(() => setHealth(v))}>
              <SelectTrigger className="w-36" aria-label="Health filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All health</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Activity</Label>
            <Select value={activity} onValueChange={(v) => change(() => setActivity(v))}>
              <SelectTrigger className="w-36" aria-label="Activity filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any activity</SelectItem>
                <SelectItem value="active">Recently active</SelectItem>
                <SelectItem value="idle">Idle</SelectItem>
                <SelectItem value="never">Never used</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="owner-query">
              Customer
            </Label>
            <Input
              id="owner-query"
              className="w-52"
              placeholder="Name or email"
              value={ownerQuery}
              onChange={(e) => change(() => setOwnerQuery(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="created-from">
              Created from
            </Label>
            <Input
              id="created-from"
              type="date"
              className="w-40"
              value={createdFrom}
              onChange={(e) => change(() => setCreatedFrom(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="last-used-from">
              Last used from
            </Label>
            <Input
              id="last-used-from"
              type="date"
              className="w-40"
              value={lastUsedFrom}
              onChange={(e) => change(() => setLastUsedFrom(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="dir-errors-only"
              checked={errorsOnly}
              onCheckedChange={(v) => change(() => setErrorsOnly(v))}
            />
            <Label htmlFor="dir-errors-only" className="text-xs">
              Errors only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="dir-rate-limited"
              checked={rateLimitedOnly}
              onCheckedChange={(v) => change(() => setRateLimitedOnly(v))}
            />
            <Label htmlFor="dir-rate-limited" className="text-xs">
              Recently rate limited
            </Label>
          </div>
        </div>

        <AdminQueryState
          isLoading={q.isLoading}
          isError={q.isError}
          error={q.error}
          isEmpty={rows.length === 0}
          emptyTitle="No integrations"
          emptyDescription="No integrations matched these filters."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Integration</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Vineyards</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>API keys</TableHead>
                  <TableHead>Endpoints</TableHead>
                  <TableHead>Last API</TableHead>
                  <TableHead>Last webhook</TableHead>
                  <TableHead>API errors</TableHead>
                  <TableHead>Webhook failures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link className="text-primary hover:underline" to={`/admin/integrations/${r.id}`}>
                        {r.name}
                      </Link>
                      {r.environment && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {r.environment}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.organisation ?? r.owner_name ?? r.owner_email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={r.health} reasons={r.health_reasons} />
                    </TableCell>
                    <TableCell>{formatNumber(r.vineyard_grants)}</TableCell>
                    <TableCell>{formatNumber(r.scope_count)}</TableCell>
                    <TableCell>{formatNumber(r.api_key_count)}</TableCell>
                    <TableCell>{formatNumber(r.webhook_endpoint_count)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(r.last_api_activity_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(r.last_webhook_activity_at)}
                    </TableCell>
                    <TableCell>{formatNumber(r.api_errors_24h)}</TableCell>
                    <TableCell>{formatNumber(r.webhook_failures_24h)}</TableCell>
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
