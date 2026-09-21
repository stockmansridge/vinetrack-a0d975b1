import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { AdminEmpty, AdminError, AdminGate, AdminPageHeader } from "./_shared";
import {
  pageLabel,
  periodLabel,
  rangeForPreset,
  useWebsiteAnalytics,
  type DatePreset,
  type Granularity,
} from "@/lib/websiteAnalytics";

const PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "year", label: "This Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom" },
];

function MetricCard({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string | number;
  secondary?: string;
}) {
  return (
    <Card className="p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {secondary && <div className="text-xs text-muted-foreground mt-0.5">{secondary}</div>}
    </Card>
  );
}

const toDateInput = (iso: string) => iso.slice(0, 10);

export default function AdminWebsiteAnalyticsPage() {
  const [preset, setPreset] = useState<DatePreset>("30d");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const defaultRange = useMemo(() => rangeForPreset("30d"), []);
  const [customFrom, setCustomFrom] = useState(toDateInput(defaultRange.date_from));
  const [customTo, setCustomTo] = useState(toDateInput(defaultRange.date_to));

  const range = useMemo(() => {
    if (preset !== "custom") return rangeForPreset(preset);
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59`);
    return { date_from: from.toISOString(), date_to: to.toISOString() };
  }, [preset, customFrom, customTo]);

  const { data, isLoading, error, refetch, isFetching } = useWebsiteAnalytics({
    range,
    granularity,
  });

  const trafficData = useMemo(
    () =>
      (data?.traffic_series ?? []).map((p) => ({
        label: periodLabel(p.period, granularity),
        "Page Views": p.page_views,
        Sessions: p.sessions,
      })),
    [data, granularity],
  );

  const contactData = useMemo(
    () =>
      (data?.contact_series ?? []).map((p) => ({
        label: periodLabel(p.period, granularity),
        "Demo Requests": p.demo_requests,
        "New Subscribers": p.new_subscribers,
      })),
    [data, granularity],
  );

  const summary = data?.summary;
  const pending = data?.meta?.traffic_table_pending;

  return (
    <AdminGate>
      <AdminPageHeader
        title="Website Analytics"
        subtitle="Traffic, enquiries and subscriber activity from vinetrack.com.au"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Card className="p-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={preset === p.value ? "default" : "outline"}
                onClick={() => setPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 w-40"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 w-40"
              />
            </div>
          )}
          <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <SelectTrigger className="h-9 w-32 ml-auto">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <AdminError error={error} />
      {pending && (
        <Card className="p-3 mb-3 text-sm text-muted-foreground">
          Traffic recording is not switched on in the main database yet, so page views and
          sessions will read zero. Enquiry and subscriber figures below are live.
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
        <MetricCard label="Page Views" value={summary?.page_views ?? 0} />
        <MetricCard label="Sessions" value={summary?.sessions ?? 0} />
        <MetricCard
          label="New Contacts"
          value={summary?.new_contacts ?? 0}
          secondary={`Conversion rate ${
            summary?.conversion_rate === null || summary?.conversion_rate === undefined
              ? "—"
              : `${summary.conversion_rate}%`
          }`}
        />
        <MetricCard label="Demo Requests" value={summary?.demo_requests ?? 0} />
        <MetricCard label="New Subscribers" value={summary?.new_subscribers ?? 0} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
        <Card className="p-3">
          <div className="text-sm font-medium mb-2">Website Traffic</div>
          <div className="h-64">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-2">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trafficData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" fontSize={11} tickMargin={6} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="Page Views"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="Sessions"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-medium">New Contacts</div>
            <div className="text-xs text-muted-foreground">
              {summary?.new_contacts ?? 0} distinct people
            </div>
          </div>
          <div className="h-64">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-2">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={contactData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" fontSize={11} tickMargin={6} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="Demo Requests"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="New Subscribers"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 text-sm font-medium border-b">Top Pages</div>
        {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && (data?.pages ?? []).length === 0 && (
          <AdminEmpty>No page views recorded in this period.</AdminEmpty>
        )}
        {!isLoading && (data?.pages ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Page</th>
                  <th className="text-right font-medium px-3 py-2">Views</th>
                  <th className="text-right font-medium px-3 py-2">Sessions</th>
                  <th className="text-right font-medium px-3 py-2">% of Views</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(data?.pages ?? []).map((p) => (
                  <tr key={p.page_path} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <div>{pageLabel(p.page_path)}</div>
                      <div className="text-[11px] text-muted-foreground break-all">
                        {p.page_path}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{p.page_views}</td>
                    <td className="px-3 py-2 text-right">{p.sessions}</td>
                    <td className="px-3 py-2 text-right">{p.percentage_of_views}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminGate>
  );
}
