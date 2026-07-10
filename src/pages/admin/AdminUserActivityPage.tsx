import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { iosSupabase } from "@/integrations/ios-supabase/client";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useColumnOrder } from "@/lib/userTablePreferencesQuery";
import { useSortableTable } from "@/lib/useSortableTable";
import { DraggableHeaderCell } from "@/components/table/DraggableHeaderCell";
import { ReorderableHead } from "@/components/table/ReorderableHead";
import { ColumnSettingsMenu } from "@/components/table/ColumnSettingsMenu";
import {
  AdminGate,
  AdminPageHeader,
  AdminError,
  AdminEmpty,
  formatDate,
  formatRelative,
} from "./_shared";

interface UserActivityRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  account_created_at: string | null;
  last_sign_in_at: string | null;
  vineyard_ids: string[] | null;
  vineyard_names: string[] | null;
  roles: string[] | null;
  app_platform: string | null;
  app_version: string | null;
  app_build: string | null;
  device_model: string | null;
  os_version: string | null;
  status: string | null;
}

interface ActivityColumn {
  key: ActivitySortKey;
  label: string;
  render: (row: UserActivityRow) => React.ReactNode;
  className?: string;
  locked?: "start" | "end";
  sortable?: boolean;
}

type ActivitySortKey =
  | "user"
  | "email"
  | "vineyards"
  | "roles"
  | "account_created"
  | "last_login"
  | "app"
  | "platform"
  | "device"
  | "os"
  | "status";

type LastLoginFilter =
  | "all"
  | "today"
  | "7d"
  | "30d"
  | "never"
  | "inactive30"
  | "inactive90";


const STATUS_LABELS: Record<string, string> = {
  never: "Never logged in",
  active_recent: "Active",
  active_30d: "Active 30d",
  inactive_30d: "Inactive 30d+",
  inactive_90d: "Inactive 90d+",
};

function statusClass(s: string | null | undefined) {
  switch ((s ?? "").toLowerCase()) {
    case "active_recent":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "active_30d":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
    case "inactive_30d":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30";
    case "inactive_90d":
      return "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";
    case "never":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

async function fetchUserActivity(): Promise<UserActivityRow[]> {
  const { data, error } = await (iosSupabase as any).rpc(
    "admin_list_user_login_activity",
  );
  if (error) throw error;
  return (data ?? []) as UserActivityRow[];
}

function appVersionDisplay(r: UserActivityRow): string {
  if (!r.app_version && !r.app_build) return "Unknown";
  if (r.app_version && r.app_build) return `${r.app_version} (${r.app_build})`;
  return r.app_version ?? r.app_build ?? "Unknown";
}

function isWithin(iso: string | null, days: number): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() <= days * 24 * 60 * 60 * 1000;
}

function isOlderThan(iso: string | null, days: number): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > days * 24 * 60 * 60 * 1000;
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(rows: UserActivityRow[]) {
  const headers = [
    "user_id",
    "display_name",
    "email",
    "vineyards",
    "roles",
    "account_created_at",
    "last_sign_in_at",
    "app_platform",
    "app_version",
    "app_build",
    "device_model",
    "os_version",
    "status",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.user_id,
        r.display_name ?? "",
        r.email ?? "",
        (r.vineyard_names ?? []).join("; "),
        (r.roles ?? []).join("; "),
        r.account_created_at ?? "",
        r.last_sign_in_at ?? "",
        r.app_platform ?? "",
        r.app_version ?? "",
        r.app_build ?? "",
        r.device_model ?? "",
        r.os_version ?? "",
        r.status ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `user-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "good" | "warn" | "bad" | "muted";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-orange-600 dark:text-orange-400"
        : tone === "bad"
          ? "text-red-600 dark:text-red-400"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <Card className="p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}

const ACTIVITY_COLUMNS: ActivityColumn[] = [
  {
    key: "user",
    label: "User",
    sortable: true,
    render: (r) => (
      <div>
        <div className="font-medium truncate max-w-[200px]">
          {r.display_name || r.email || "—"}
        </div>
        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
          {r.user_id}
        </div>
      </div>
    ),
  },
  {
    key: "email",
    label: "Email",
    sortable: true,
    render: (r) => (
      <span className="truncate block max-w-[220px]">{r.email ?? "—"}</span>
    ),
  },
  {
    key: "vineyards",
    label: "Vineyards",
    sortable: true,
    render: (r) => {
      const label = (r.vineyard_names ?? []).join(", ") || "—";
      return (
        <span className="block max-w-[220px] truncate" title={label}>
          {label}
        </span>
      );
    },
  },
  {
    key: "roles",
    label: "Roles",
    sortable: true,
    render: (r) => <span>{(r.roles ?? []).join(", ") || "—"}</span>,
  },
  {
    key: "account_created",
    label: "Account created",
    className: "whitespace-nowrap",
    sortable: true,
    render: (r) => formatDate(r.account_created_at),
  },
  {
    key: "last_login",
    label: "Last login",
    className: "whitespace-nowrap",
    sortable: true,
    render: (r) =>
      r.last_sign_in_at ? (
        <div>
          <div>{formatDate(r.last_sign_in_at)}</div>
          <div className="text-xs text-muted-foreground">
            {formatRelative(r.last_sign_in_at)}
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground">Never logged in</span>
      ),
  },
  {
    key: "app",
    label: "App",
    className: "whitespace-nowrap",
    sortable: true,
    render: (r) => appVersionDisplay(r),
  },
  {
    key: "platform",
    label: "Platform",
    className: "whitespace-nowrap",
    sortable: true,
    render: (r) => r.app_platform || "Unknown",
  },
  {
    key: "device",
    label: "Device",
    className: "whitespace-nowrap",
    sortable: true,
    render: (r) => r.device_model || "Unknown",
  },
  {
    key: "os",
    label: "OS",
    className: "whitespace-nowrap",
    sortable: true,
    render: (r) => r.os_version || "Unknown",
  },
  {
    key: "status",
    label: "Status",
    className: "whitespace-nowrap",
    sortable: true,
    render: (r) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${statusClass(r.status)}`}
      >
        {STATUS_LABELS[r.status ?? ""] ?? r.status ?? "—"}
      </span>
    ),
  },
];

export default function AdminUserActivityPage() {
  const { data = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "user-activity"],
    queryFn: fetchUserActivity,
    staleTime: 30_000,
  });

  const [search, setSearch] = useState("");
  const [vineyardFilter, setVineyardFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loginFilter, setLoginFilter] = useState<LastLoginFilter>("all");

  const vineyards = useMemo(
    () =>
      Array.from(
        new Set(
          data.flatMap((r) => r.vineyard_names ?? []).filter((s) => Boolean(s)),
        ),
      ).sort(),
    [data],
  );
  const roles = useMemo(
    () =>
      Array.from(
        new Set(data.flatMap((r) => r.roles ?? []).filter((s) => Boolean(s))),
      ).sort(),
    [data],
  );
  const statuses = useMemo(
    () =>
      Array.from(new Set(data.map((r) => r.status ?? "").filter(Boolean))).sort(),
    [data],
  );

  const summary = useMemo(() => {
    const total = data.length;
    let today = 0;
    let last7 = 0;
    let last30 = 0;
    let never = 0;
    let inactive90 = 0;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    for (const r of data) {
      if (!r.last_sign_in_at) {
        never += 1;
        continue;
      }
      const t = new Date(r.last_sign_in_at).getTime();
      if (t >= todayMs) today += 1;
      if (isWithin(r.last_sign_in_at, 7)) last7 += 1;
      if (isWithin(r.last_sign_in_at, 30)) last30 += 1;
      if (isOlderThan(r.last_sign_in_at, 90)) inactive90 += 1;
    }
    return { total, today, last7, last30, never, inactive90 };
  }, [data]);

  const lockedStart = ACTIVITY_COLUMNS.filter((c) => c.locked === "start");
  const lockedEnd = ACTIVITY_COLUMNS.filter((c) => c.locked === "end");
  const movable = ACTIVITY_COLUMNS.filter((c) => !c.locked);
  const defaultOrder = useMemo(() => movable.map((c) => c.key), [movable]);
  const { order, moveColumn, reset } = useColumnOrder(
    "admin_user_activity_table",
    defaultOrder,
  );
  const columnsById = useMemo(() => {
    const m = new Map<string, ActivityColumn>();
    for (const c of ACTIVITY_COLUMNS) m.set(c.key, c);
    return m;
  }, []);
  const orderedMovable = useMemo(
    () => order.map((id) => columnsById.get(id)).filter(Boolean) as ActivityColumn[],
    [order, columnsById],
  );
  const finalColumns = useMemo(
    () => [...lockedStart, ...orderedMovable, ...lockedEnd],
    [lockedStart, orderedMovable, lockedEnd],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((r) => {
      if (vineyardFilter !== "all" && !(r.vineyard_names ?? []).includes(vineyardFilter))
        return false;
      if (roleFilter !== "all" && !(r.roles ?? []).includes(roleFilter)) return false;
      if (statusFilter !== "all" && (r.status ?? "") !== statusFilter) return false;
      if (loginFilter === "never" && r.last_sign_in_at) return false;
      if (loginFilter === "today") {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        if (!r.last_sign_in_at || new Date(r.last_sign_in_at).getTime() < start.getTime())
          return false;
      }
      if (loginFilter === "7d" && !isWithin(r.last_sign_in_at, 7)) return false;
      if (loginFilter === "30d" && !isWithin(r.last_sign_in_at, 30)) return false;
      if (loginFilter === "inactive30") {
        if (!r.last_sign_in_at || !isOlderThan(r.last_sign_in_at, 30)) return false;
      }
      if (loginFilter === "inactive90") {
        if (!r.last_sign_in_at || !isOlderThan(r.last_sign_in_at, 90)) return false;
      }
      if (!q) return true;
      return [r.display_name, r.email]
        .map((x) => (x ?? "").toLowerCase())
        .some((x) => x.includes(q));
    });
  }, [data, search, vineyardFilter, roleFilter, statusFilter, loginFilter]);

  const { sorted, toggleSort, getSortDirection } = useSortableTable<UserActivityRow, ActivitySortKey>(filtered, {
    accessors: {
      user: (r) => (r.display_name ?? r.email ?? "").toLowerCase(),
      email: (r) => (r.email ?? "").toLowerCase(),
      vineyards: (r) => (r.vineyard_names ?? []).length,
      roles: (r) => (r.roles ?? []).length,
      account_created: (r) => (r.account_created_at ? new Date(r.account_created_at).getTime() : 0),
      last_login: (r) => (r.last_sign_in_at ? new Date(r.last_sign_in_at).getTime() : 0),
      app: (r) => r.app_version ?? "",
      platform: (r) => r.app_platform ?? "",
      device: (r) => r.device_model ?? "",
      os: (r) => r.os_version ?? "",
      status: (r) => r.status ?? "",
    },
    initial: { key: "last_login", direction: "desc" },
  });

  return (
    <AdminGate>
      <AdminPageHeader
        title="User Activity"
        subtitle={`${filtered.length} of ${data.length}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCsv(filtered)}
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <SummaryCard label="Total users" value={summary.total} />
        <SummaryCard label="Logged in today" value={summary.today} tone="good" />
        <SummaryCard label="Active 7d" value={summary.last7} tone="good" />
        <SummaryCard label="Active 30d" value={summary.last30} />
        <SummaryCard label="Never logged in" value={summary.never} tone="muted" />
        <SummaryCard label="Inactive 90d+" value={summary.inactive90} tone="bad" />
      </div>

      <Card className="p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 max-w-sm"
          />
          <Select
            value={loginFilter}
            onValueChange={(v) => setLoginFilter(v as LastLoginFilter)}
          >
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Last login" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any last login</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="never">Never logged in</SelectItem>
              <SelectItem value="inactive30">Inactive 30d+</SelectItem>
              <SelectItem value="inactive90">Inactive 90d+</SelectItem>
            </SelectContent>
          </Select>
          {vineyards.length > 0 && (
            <Select value={vineyardFilter} onValueChange={setVineyardFilter}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue placeholder="Vineyard" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vineyards</SelectItem>
                {vineyards.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {roles.length > 0 && (
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9 w-36">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {statuses.length > 0 && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-2">
            <ColumnSettingsMenu onReset={reset} />
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <AdminError error={error} />
        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <AdminEmpty>No users match the current filters.</AdminEmpty>
        )}
        {!isLoading && filtered.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                {finalColumns.map((c) => (
                  <ReorderableHead
                    key={c.key}
                    columnId={c.key}
                    onDropColumn={moveColumn}
                    className={c.className}
                    sort={
                      c.sortable
                        ? {
                            active: getSortDirection(c.key),
                            onSort: () => toggleSort(c.key),
                          }
                        : undefined
                    }
                  >
                    {c.label}
                  </ReorderableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.user_id}>
                  {finalColumns.map((c) => (
                    <TableCell key={c.key} className={c.className}>
                      {c.render(r)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </AdminGate>
  );
}
