// Stage 7B — API request diagnostics (admin_list_integration_api_requests).
// Safe fields only: never headers, key values, hashes or request/response bodies.
import { useState } from "react";
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
import { cn } from "@/lib/utils";
import { AdminQueryState, KeysetPager } from "./AdminIntegrationBits";
import { useKeysetPager } from "./useKeysetPager";
import {
  ADMIN_PAGE_SIZE,
  PUBLIC_API_RATE_LIMIT,
  formatDateTime,
  formatDuration,
  nextCursor,
  safeKeyLabel,
  useAdminApiRequests,
  type AdminApiRequestFilters,
} from "@/lib/adminIntegrationsQuery";

const ALL = "__all__";

function statusClasses(status: number | null): string {
  if (status == null) return "border-border bg-muted text-muted-foreground";
  if (status >= 500) return "border-destructive/40 bg-destructive/10 text-destructive";
  if (status === 429)
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  if (status >= 400) return "border-destructive/30 bg-destructive/5 text-destructive";
  return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
}

export function AdminApiRequestsPanel({
  clientId = null,
  showIntegrationColumn = true,
}: {
  clientId?: string | null;
  showIntegrationColumn?: boolean;
}) {
  const pager = useKeysetPager();
  const [statusClass, setStatusClass] = useState<string>(ALL);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [rateLimitedOnly, setRateLimitedOnly] = useState(false);
  const [path, setPath] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters: AdminApiRequestFilters = {
    clientId,
    statusClass: statusClass === ALL ? null : statusClass,
    errorsOnly,
    rateLimitedOnly,
    path: path.trim() || null,
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(to).toISOString() : null,
  };

  const q = useAdminApiRequests(filters, pager.cursor);
  const rows = q.data ?? [];
  const cursor = rows.length >= ADMIN_PAGE_SIZE ? nextCursor(rows) : null;

  const change = (fn: () => void) => {
    fn();
    pager.reset();
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">API requests</CardTitle>
        <p className="text-xs text-muted-foreground">
          Rate limit: {PUBLIC_API_RATE_LIMIT}. 429 responses indicate rate limiting.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Status class</Label>
            <Select
              value={statusClass}
              onValueChange={(v) => change(() => setStatusClass(v))}
            >
              <SelectTrigger className="w-36" aria-label="Status class">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="2xx">2xx</SelectItem>
                <SelectItem value="4xx">4xx</SelectItem>
                <SelectItem value="5xx">5xx</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="api-path">
              Route contains
            </Label>
            <Input
              id="api-path"
              className="w-52"
              value={path}
              onChange={(e) => change(() => setPath(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="api-from">
              From
            </Label>
            <Input
              id="api-from"
              type="date"
              className="w-40"
              value={from}
              onChange={(e) => change(() => setFrom(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="api-to">
              To
            </Label>
            <Input
              id="api-to"
              type="date"
              className="w-40"
              value={to}
              onChange={(e) => change(() => setTo(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="errors-only"
              checked={errorsOnly}
              onCheckedChange={(v) => change(() => setErrorsOnly(v))}
            />
            <Label htmlFor="errors-only" className="text-xs">
              Errors only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="rate-limited-only"
              checked={rateLimitedOnly}
              onCheckedChange={(v) => change(() => setRateLimitedOnly(v))}
            />
            <Label htmlFor="rate-limited-only" className="text-xs">
              Rate limited only
            </Label>
          </div>
        </div>

        <AdminQueryState
          isLoading={q.isLoading}
          isError={q.isError}
          error={q.error}
          isEmpty={rows.length === 0}
          emptyTitle="No API activity"
          emptyDescription="No API requests matched these filters."
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Request ID</TableHead>
                  {showIntegrationColumn && <TableHead>Integration</TableHead>}
                  <TableHead>API key</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Vineyard</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(r.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.request_id ?? "—"}</TableCell>
                    {showIntegrationColumn && (
                      <TableCell>{r.integration_name ?? "—"}</TableCell>
                    )}
                    <TableCell>
                      {safeKeyLabel({ name: r.api_key_name, key_prefix: r.api_key_prefix })}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.method ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.path ?? "—"}</TableCell>
                    <TableCell>{r.vineyard_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("font-mono", statusClasses(r.status_code))}
                      >
                        {r.status_code ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDuration(r.duration_ms)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.error_code ?? "—"}
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
