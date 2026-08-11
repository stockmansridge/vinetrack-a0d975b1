// Stage 7B — global/per-integration API metrics (admin_integration_api_metrics).
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminQueryState, MetricCard } from "./AdminIntegrationBits";
import {
  METRIC_WINDOWS,
  formatDuration,
  formatNumber,
  useAdminApiMetrics,
  type MetricsWindow,
} from "@/lib/adminIntegrationsQuery";

export function AdminApiMetricsPanel({ clientId = null }: { clientId?: string | null }) {
  const [window, setWindow] = useState<MetricsWindow>("24h");
  const metrics = useAdminApiMetrics(window, clientId, "hour");
  const m = metrics.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">API metrics</h2>
        <Select value={window} onValueChange={(v) => setWindow(v as MetricsWindow)}>
          <SelectTrigger className="w-40" aria-label="Metrics window">
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
        isLoading={metrics.isLoading}
        isError={metrics.isError}
        error={metrics.error}
        isEmpty={!m}
        emptyTitle="Metrics unavailable"
        emptyDescription="No API metrics were returned for this window."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Total requests" value={formatNumber(m?.total_requests)} />
          <MetricCard label="2xx" value={formatNumber(m?.success_2xx)} />
          <MetricCard label="4xx" value={formatNumber(m?.client_4xx)} />
          <MetricCard label="5xx" value={formatNumber(m?.server_5xx)} />
          <MetricCard label="429 rate limited" value={formatNumber(m?.rate_limited_429)} />
          <MetricCard label="Unauthenticated" value={formatNumber(m?.unauthenticated)} />
          <MetricCard label="Average duration" value={formatDuration(m?.avg_duration_ms)} />
          <MetricCard label="p95 duration" value={formatDuration(m?.p95_duration_ms)} />
          <MetricCard label="Unique integrations" value={formatNumber(m?.unique_integrations)} />
          <MetricCard label="Unique API keys" value={formatNumber(m?.unique_api_keys)} />
        </div>

        {!!m?.buckets.length && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Request volume</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={m.buckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="hsl(var(--primary))"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Status classes</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={m.buckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="success" stackId="s" fill="hsl(var(--primary))" />
                    <Bar dataKey="client_errors" stackId="s" fill="hsl(var(--muted-foreground))" />
                    <Bar dataKey="server_errors" stackId="s" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}
      </AdminQueryState>
    </div>
  );
}
