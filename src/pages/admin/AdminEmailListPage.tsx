import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  AdminEmpty,
  AdminError,
  AdminGate,
  AdminPageHeader,
  formatDate,
} from "./_shared";
import {
  downloadEmailListCsv,
  filterSubscribers,
  useEmailListSubscribers,
  useSetSubscriberStatus,
  type SubscriberStatus,
} from "@/lib/emailListAdmin";

function sourceLabel(source: string): string {
  switch (source) {
    case "website_newsletter":
      return "Website newsletter";
    case "website_demo_opt_in":
      return "Demo opt-in";
    case "manual":
      return "Manual";
    default:
      return source;
  }
}

function statusClass(status: string) {
  return status === "subscribed"
    ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
    : "bg-muted text-muted-foreground border-border";
}

export default function AdminEmailListPage() {
  const { data = [], isLoading, error, refetch, isFetching } = useEmailListSubscribers();
  const statusMut = useSetSubscriberStatus();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");

  const sources = useMemo(
    () => Array.from(new Set(data.map((r) => r.source).filter(Boolean))).sort(),
    [data],
  );

  const filtered = useMemo(
    () => filterSubscribers(data, { search, status, source }),
    [data, search, status, source],
  );

  const totals = useMemo(() => {
    let subscribed = 0;
    let unsubscribed = 0;
    for (const r of data) {
      if (r.status === "subscribed") subscribed += 1;
      else if (r.status === "unsubscribed") unsubscribed += 1;
    }
    return { total: data.length, subscribed, unsubscribed };
  }, [data]);

  const changeStatus = (id: string, next: SubscriberStatus) => {
    statusMut.mutate(
      { id, status: next },
      {
        onSuccess: () => toast.success(`Marked as ${next}`),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not update the subscriber."),
      },
    );
  };

  return (
    <AdminGate>
      <AdminPageHeader
        title="Email List"
        subtitle="VineTrack website subscribers and marketing contacts"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (filtered.length === 0) {
                  toast.error("There is nothing to export in the current view.");
                  return;
                }
                downloadEmailListCsv(filtered);
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
          <div className="text-2xl font-semibold">{totals.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Subscribed</div>
          <div className="text-2xl font-semibold">{totals.subscribed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Unsubscribed</div>
          <div className="text-2xl font-semibold">{totals.unsubscribed}</div>
        </Card>
      </div>

      <Card className="p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Search email, first name, last name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 max-w-sm"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="subscribed">Subscribed</SelectItem>
              <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
            </SelectContent>
          </Select>
          {sources.length > 0 && (
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} of {data.length}
          </span>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <AdminError error={error} />
        {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && !error && filtered.length === 0 && (
          <AdminEmpty>No subscribers match the current filters.</AdminEmpty>
        )}
        {!isLoading && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2">Email</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Source</th>
                  <th className="text-left font-medium px-3 py-2">Subscribed</th>
                  <th className="text-left font-medium px-3 py-2">Unsubscribed</th>
                  <th className="text-right font-medium px-3 py-2">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
                  const isSubscribed = r.status === "subscribed";
                  return (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2 break-all">{r.email}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] border ${statusClass(r.status)}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs">{sourceLabel(r.source)}</span>
                        {r.source_page && (
                          <div className="text-[11px] text-muted-foreground break-all">
                            {r.source_page}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{formatDate(r.subscribed_at)}</td>
                      <td className="px-3 py-2 text-xs">{formatDate(r.unsubscribed_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={statusMut.isPending}
                          onClick={() =>
                            changeStatus(r.id, isSubscribed ? "unsubscribed" : "subscribed")
                          }
                        >
                          {isSubscribed ? "Unsubscribe" : "Resubscribe"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminGate>
  );
}
