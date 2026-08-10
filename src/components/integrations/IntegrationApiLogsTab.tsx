// Stage 4B — API request logs backed by the SQL 177 RPC
// integration_list_api_requests. The portal never reads
// public.integration_api_requests directly and never renders secrets,
// hashes, headers or request/response bodies.
import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalNotice } from "@/components/ui/PortalNotice";
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
import { cn } from "@/lib/utils";
import { IntegrationEmptyState } from "./IntegrationEmptyState";
import {
  API_REQUEST_PAGE_SIZE,
  apiStatusTone,
  formatDateTime,
  formatDuration,
  nextApiRequestCursor,
  useIntegrationApiKeys,
  useIntegrationApiRequests,
  useIntegrationVineyards,
  type ApiRequestCursor,
  type ApiRequestFilters,
  type IntegrationApiRequest,
} from "@/lib/integrationsQuery";

const ALL = "__all__";

const TONE_CLASSES: Record<string, string> = {
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  error:
    "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function ApiStatusBadge({ status }: { status: number | null }) {
  const tone = apiStatusTone(status);
  return (
    <Badge variant="outline" className={cn("font-mono font-medium", TONE_CLASSES[tone])}>
      {status ?? "—"}
    </Badge>
  );
}

/** Safe API key label — name and prefix only, never a hash or secret. */
export function apiKeyLabel(row: {
  api_key_name: string | null;
  api_key_prefix: string | null;
}): string {
  if (row.api_key_name && row.api_key_prefix) {
    return `${row.api_key_name} · ${row.api_key_prefix}`;
  }
  return row.api_key_name ?? row.api_key_prefix ?? "—";
}

export function IntegrationApiLogsTab({ clientId }: { clientId: string }) {
  const [filters, setFilters] = useState<ApiRequestFilters>({
    from: null,
    to: null,
    statusCode: null,
    vineyardId: null,
    apiKeyId: null,
    errorOnly: false,
  });
  // Retained cursor history so Previous works without offset pagination.
  const [cursorStack, setCursorStack] = useState<(ApiRequestCursor | null)[]>([null]);
  const [selected, setSelected] = useState<IntegrationApiRequest | null>(null);

  const cursor = cursorStack[cursorStack.length - 1] ?? null;
  const logs = useIntegrationApiRequests(clientId, filters, cursor, API_REQUEST_PAGE_SIZE);
  const vineyards = useIntegrationVineyards(clientId);
  const keys = useIntegrationApiKeys(clientId);

  const rows = logs.data ?? [];
  const nextCursor = useMemo(
    () => nextApiRequestCursor(rows, API_REQUEST_PAGE_SIZE),
    [rows],
  );

  /** Filter changes always reset keyset pagination. */
  const patchFilters = (patch: Partial<ApiRequestFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursorStack([null]);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API logs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="log-from">From</Label>
              <Input
                id="log-from"
                type="date"
                value={filters.from ? filters.from.slice(0, 10) : ""}
                onChange={(e) =>
                  patchFilters({
                    from: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-to">To</Label>
              <Input
                id="log-to"
                type="date"
                value={filters.to ? filters.to.slice(0, 10) : ""}
                onChange={(e) =>
                  patchFilters({
                    to: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-status">Status code</Label>
              <Input
                id="log-status"
                inputMode="numeric"
                placeholder="e.g. 200"
                value={filters.statusCode ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  patchFilters({ statusCode: v === "" ? null : Number(v) || null });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vineyard</Label>
              <Select
                value={filters.vineyardId ?? ALL}
                onValueChange={(v) => patchFilters({ vineyardId: v === ALL ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All vineyards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All vineyards</SelectItem>
                  {(vineyards.data ?? []).map((v) => (
                    <SelectItem key={v.vineyard_id} value={v.vineyard_id}>
                      {v.vineyard_name ?? v.vineyard_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>API key</Label>
              <Select
                value={filters.apiKeyId ?? ALL}
                onValueChange={(v) => patchFilters({ apiKeyId: v === ALL ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All keys" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All keys</SelectItem>
                  {(keys.data ?? []).map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name ?? "Key"}
                      {k.key_prefix ? ` · ${k.key_prefix}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch
                id="log-errors-only"
                checked={!!filters.errorOnly}
                onCheckedChange={(checked) => patchFilters({ errorOnly: checked })}
              />
              <Label htmlFor="log-errors-only">Errors only</Label>
            </div>
          </div>

          {logs.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : logs.isError ? (
            <div className="space-y-3">
              <PortalNotice
                variant="error"
                description="API request logs could not be loaded."
              />
              <Button variant="outline" onClick={() => logs.refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <IntegrationEmptyState
              icon={Activity}
              title="No API requests"
              description="No API requests match the selected filters."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date / time</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Vineyard</TableHead>
                      <TableHead>API key</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer"
                        onClick={() => setSelected(row)}
                      >
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(row.created_at)}
                        </TableCell>
                        <TableCell className="font-mono text-xs uppercase">
                          {row.method ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.endpoint ?? "—"}
                        </TableCell>
                        <TableCell>{row.vineyard_name ?? (row.vineyard_id ? "Vineyard" : "—")}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {apiKeyLabel(row)}
                        </TableCell>
                        <TableCell>
                          <ApiStatusBadge status={row.status_code} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDuration(row.duration_ms)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.error_code ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Showing {rows.length} request{rows.length === 1 ? "" : "s"}, newest
                  first.
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
                    onClick={() =>
                      nextCursor && setCursorStack((s) => [...s, nextCursor])
                    }
                  >
                    Next page
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>API request</SheetTitle>
            <SheetDescription>
              Request metadata only — headers, keys and payloads are never stored or
              shown.
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <dl className="mt-6 space-y-3 text-sm">
              {[
                ["Request ID", <code className="font-mono text-xs">{selected.id}</code>],
                ["Date / time", formatDateTime(selected.created_at)],
                ["Method", selected.method ?? "—"],
                ["Endpoint", selected.endpoint ?? "—"],
                ["Vineyard", selected.vineyard_name ?? "—"],
                ["Vineyard ID", selected.vineyard_id ?? "—"],
                ["API key", apiKeyLabel(selected)],
                ["HTTP status", <ApiStatusBadge status={selected.status_code} />],
                ["Duration", formatDuration(selected.duration_ms)],
                ["Error code", selected.error_code ?? "—"],
              ].map(([label, value], i) => (
                <div key={i} className="flex items-start justify-between gap-4">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label as string}
                  </dt>
                  <dd className="text-right">{value as React.ReactNode}</dd>
                </div>
              ))}
            </dl>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
