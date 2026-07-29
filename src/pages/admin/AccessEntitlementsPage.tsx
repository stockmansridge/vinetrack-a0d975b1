import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminGate, AdminPageHeader } from "./_shared";
import { UserAccessDrawer } from "@/components/admin/access/UserAccessDrawer";
import { AcknowledgeAlertDialog } from "@/components/admin/access/accessDialogs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AE_KEYS,
  billingSourceLabel,
  fmtDateTime,
  friendlyError,
  isTrialSource,
  purchasePlatformLabel,
  resolvedReasonLabel,
  useAccessUsers,
  useAdminVineyardOptions,
  useBillingAlerts,
  useBillingMonitor,
  usePlanOptions,
  type BillingAlert,
  type ReviewItemType,
  platformsAllowed,
} from "@/lib/accessEntitlementsQuery";
import { BillingReviewPanel } from "@/components/admin/access/BillingReviewPanel";


const PAGE_SIZES = [25, 50, 100];
const ALL = "__all__";

/** Column header with an explanatory tooltip. */
function HeadInfo({ label, hint }: { label: string; hint: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            {label}
            <Info className="h-3 w-3 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


type HealthState = "healthy" | "attention" | "critical";

const HEALTH_STYLE: Record<HealthState, string> = {
  healthy: "border-emerald-500/30 bg-emerald-500/5",
  attention: "border-amber-500/40 bg-amber-500/5",
  critical: "border-destructive/40 bg-destructive/5",
};

function HealthIcon({ state }: { state: HealthState }) {
  if (state === "healthy") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === "attention") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function HealthCard({
  title,
  count,
  state,
  explanation,
  loading,
  onClick,
  alwaysClickable,
}: {
  title: string;
  count: number;
  state: HealthState;
  explanation: string;
  loading?: boolean;
  onClick?: () => void;
  /** Review-queue cards stay clickable at zero so the empty queue is reachable. */
  alwaysClickable?: boolean;
}) {
  if (loading) return <Skeleton className="h-28 w-full" />;
  const clickable = !!onClick && (count > 0 || !!alwaysClickable);
  return (
    <Card
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`p-4 flex flex-col justify-between min-h-[7rem] border transition-colors ${HEALTH_STYLE[state]} ${
        clickable
          ? "cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <HealthIcon state={state} />
      </div>
      <div className="text-2xl font-semibold mt-1">{count}</div>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
        {explanation}
        {clickable ? " Select to view details." : ""}
      </p>
    </Card>
  );
}

function DetailValue({ value }: { value: unknown }) {
  if (value == null || value === "") return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "object") {
    return (
      <pre className="whitespace-pre-wrap break-words text-[11px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return <>{fmtDateTime(s)}</>;
  return <>{s}</>;
}

function HealthDetailDialog({
  open,
  onOpenChange,
  title,
  explanation,
  items,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  explanation: string;
  items: Record<string, unknown>[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{explanation}</DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No detail records were returned for this measure.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item, i) => (
              <Card key={i} className="p-3">
                <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
                  {Object.entries(item).map(([k, v]) => (
                    <div key={k} className="text-sm min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {humanise(k)}
                      </dt>
                      <dd className="break-words">
                        <DetailValue value={v} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


function AccessBadge({ granted }: { granted: boolean }) {
  return granted ? (
    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
      <ShieldCheck className="h-3 w-3" /> Active
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <ShieldX className="h-3 w-3" /> No Access
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: BillingAlert["severity"] }) {
  const map = {
    critical: { label: "Critical", cls: "border-destructive/50 text-destructive", Icon: XCircle },
    warning: { label: "Warning", cls: "border-amber-500/50 text-amber-600", Icon: AlertTriangle },
    info: { label: "Information", cls: "border-border text-muted-foreground", Icon: Info },
  }[severity];
  const Icon = map.Icon;
  return (
    <Badge variant="outline" className={`gap-1 ${map.cls}`}>
      <Icon className="h-3 w-3" /> {map.label}
    </Badge>
  );
}

function humanise(v: string | null | undefined, fallback = "—") {
  if (!v) return fallback;
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AccessEntitlementsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();

  /* -------------------- filters & pagination (all server-side) ----- */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [billingSource, setBillingSource] = useState<string>(
    params.get("filter") === "manual_override" ? "manual" : ALL,
  );
  const [role, setRole] = useState<string>(ALL);
  const [planCode, setPlanCode] = useState<string>(ALL);
  const [vineyardId, setVineyardId] = useState<string>(ALL);
  const [accessFilter, setAccessFilter] = useState<string>(ALL);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  /* -------------------- data -------------------- */
  const monitorQ = useBillingMonitor();
  const vineyardsQ = useAdminVineyardOptions();
  const plansQ = usePlanOptions();
  const [includeAcknowledged, setIncludeAcknowledged] = useState(false);
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<string>(ALL);
  const [alertTypeFilter, setAlertTypeFilter] = useState<string>(ALL);
  const alertsQ = useBillingAlerts({ includeAcknowledged, limit: 100 });

  const usersQ = useAccessUsers({
    search,
    limit: pageSize,
    offset: page * pageSize,
    vineyardId: vineyardId === ALL ? null : vineyardId,
    role: role === ALL ? null : role,
    planCode: planCode === ALL ? null : planCode,
    billingSource: billingSource === ALL ? null : billingSource,
    hasAccess: accessFilter === ALL ? null : accessFilter === "granted",
  });

  const rows = usersQ.data?.rows ?? [];
  const total = usersQ.data?.total ?? 0;

  const monitor = monitorQ.data;
  const cards: {
    title: string;
    count: number;
    state: HealthState;
    explanation: string;
    items: Record<string, unknown>[];
    /** SQL 148 review queue this card belongs to, when it is a review category. */
    reviewType?: ReviewItemType;
  }[] = monitor
    ? [
        {
          title: "Needs Review",
          count: monitor.events_needing_review.count,
          state: monitor.events_needing_review.count > 0 ? "attention" : "healthy",
          explanation:
            monitor.events_needing_review.count > 0
              ? "Store events are flagged for administrator review."
              : "No store events require review.",
          items: monitor.events_needing_review.recent,
          reviewType: "event",
        },
        {
          title: "Failed Events",
          count: monitor.failed_events.count,
          state: monitor.failed_events.count > 0 ? "critical" : "healthy",
          explanation:
            monitor.failed_events.count > 0
              ? "Billing events failed processing."
              : "No billing events have failed processing.",
          items: monitor.failed_events.recent,
          reviewType: "event",
        },
        {
          title: "Unresolved Users",
          count: monitor.unresolved_users.count,
          state: monitor.unresolved_users.count > 0 ? "critical" : "healthy",
          explanation:
            monitor.unresolved_users.count > 0
              ? "Purchases could not be linked to a VineTrack account."
              : "Every purchase is linked to an account.",
          items: monitor.unresolved_users.recent,
          reviewType: "unresolved_user",
        },
        {
          title: "Ownership Conflicts",
          count: monitor.ownership_conflicts.count,
          state: monitor.ownership_conflicts.count > 0 ? "critical" : "healthy",
          explanation:
            monitor.ownership_conflicts.count > 0
              ? "A subscription is claimed by more than one account."
              : "No subscription ownership conflicts.",
          items: monitor.ownership_conflicts.recent,
          reviewType: "ownership_conflict",
        },
        {
          title: "Open Alerts",
          count: monitor.open_alerts,
          state: monitor.open_alerts > 0 ? "attention" : "healthy",
          explanation:
            monitor.open_alerts > 0
              ? "Alerts are waiting to be acknowledged."
              : "No alerts are waiting for acknowledgement.",
          items: (alertsQ.data ?? [])
            .filter((a) => !a.acknowledged_at)
            .map((a) => a as unknown as Record<string, unknown>),
          reviewType: "alert",
        },
        {
          title: "Stuck Deliveries",
          count: monitor.stuck_deliveries.length,
          state: monitor.stuck_deliveries.length > 0 ? "attention" : "healthy",
          explanation:
            monitor.stuck_deliveries.length > 0
              ? "Store webhooks were received but never finalised."
              : "All store webhooks finalised normally.",
          items: monitor.stuck_deliveries,
          reviewType: "stuck_delivery",
        },
        {
          title: "Expiring in 7 Days",
          count: monitor.expiring_within_7_days.length,
          state: monitor.expiring_within_7_days.length > 0 ? "attention" : "healthy",
          explanation:
            monitor.expiring_within_7_days.length > 0
              ? "Access expires within the next seven days."
              : "Nothing expires in the next seven days.",
          items: monitor.expiring_within_7_days,
        },
        {
          title: "Recent Status Changes",
          count: monitor.recent_status_changes.length,
          state: "healthy",
          explanation: "Subscription status changes recorded recently.",
          items: monitor.recent_status_changes,
        },
      ]
    : [];

  const [detailCard, setDetailCard] = useState<string | null>(null);
  const activeCard = cards.find((c) => c.title === detailCard) ?? null;
  const [reviewType, setReviewType] = useState<ReviewItemType | null>(null);




  const alerts = alertsQ.data ?? [];
  const alertTypes = useMemo(
    () => [...new Set(alerts.map((a) => a.alert_type))].sort(),
    [alerts],
  );
  const filteredAlerts = alerts.filter((a) => {
    if (alertSeverityFilter !== ALL && a.severity !== alertSeverityFilter) return false;
    if (alertTypeFilter !== ALL && a.alert_type !== alertTypeFilter) return false;
    return true;
  });

  const [ackTarget, setAckTarget] = useState<BillingAlert | null>(null);

  const [refreshState, setRefreshState] = useState<"idle" | "busy" | "done">("idle");

  const refreshAll = async () => {
    if (refreshState === "busy") return;
    setRefreshState("busy");
    try {
      // Mark every Access & Entitlements query stale (prefix match on the root
      // key covers monitor, alerts, users, detail, history, grants, pools…)
      qc.invalidateQueries({ queryKey: AE_KEYS.root });
      // …then actively refetch the mounted ones and await them all so the
      // spinner reflects real network completion.
      const results = await Promise.allSettled([
        qc.refetchQueries({ queryKey: AE_KEYS.root, type: "active" }),
        monitorQ.refetch(),
        alertsQ.refetch(),
        usersQ.refetch(),
      ]);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0 || monitorQ.error || usersQ.error) {
        toast.error("Some data could not be refreshed. Check the error messages on the page.");
        setRefreshState("idle");
        return;
      }
      toast.success("Access & entitlements data refreshed");
      setRefreshState("done");
      window.setTimeout(() => setRefreshState("idle"), 2000);
    } catch (e) {
      toast.error(friendlyError(e));
      setRefreshState("idle");
    }
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setBillingSource(ALL);
    setRole(ALL);
    setPlanCode(ALL);
    setVineyardId(ALL);
    setAccessFilter(ALL);
    setPage(0);
  };

  const filtersActive =
    !!search ||
    billingSource !== ALL ||
    role !== ALL ||
    planCode !== ALL ||
    vineyardId !== ALL ||
    accessFilter !== ALL;

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + rows.length;
  const canNext = to < total;

  return (
    <AdminGate>
      <AdminPageHeader
        title="Access & Entitlements"
        subtitle="Review user access, subscriptions, licence assignments, billing grants and billing issues across VineTrack."
        actions={
          <Button variant="outline" onClick={refreshAll} disabled={refreshState === "busy"}>
            <RefreshCw
              className={`h-4 w-4 mr-1 ${refreshState === "busy" ? "animate-spin" : ""}`}
            />
            {refreshState === "busy" ? "Refreshing…" : refreshState === "done" ? "Refreshed" : "Refresh"}
          </Button>
        }
      />

      {/* Billing health */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold mb-2">Billing health</h2>
        {monitorQ.error ? (
          <Card className="p-4 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            {friendlyError(monitorQ.error)}
          </Card>
        ) : (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {monitorQ.isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full" />
                ))
              : cards.map((c) => (
                  <HealthCard
                    key={c.title}
                    title={c.title}
                    count={c.count}
                    state={c.state}
                    explanation={c.explanation}
                    alwaysClickable={!!c.reviewType}
                    onClick={() =>
                      c.reviewType
                        ? setReviewType(c.reviewType)
                        : setDetailCard(c.title)
                    }
                  />
                ))}

          </div>
        )}
      </section>

      {/* Alert inbox */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold">Billing alerts</h2>
          <div className="flex flex-wrap gap-2">
            <Select value={alertSeverityFilter} onValueChange={setAlertSeverityFilter}>
              <SelectTrigger className="h-8 w-[150px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Information</SelectItem>
              </SelectContent>
            </Select>
            <Select value={alertTypeFilter} onValueChange={setAlertTypeFilter}>
              <SelectTrigger className="h-8 w-[190px]">
                <SelectValue placeholder="Alert type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {alertTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanise(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={includeAcknowledged ? "secondary" : "outline"}
              size="sm"
              onClick={() => setIncludeAcknowledged((v) => !v)}
            >
              {includeAcknowledged ? "Showing acknowledged" : "Open alerts only"}
            </Button>
          </div>
        </div>
        <Card className="p-0 overflow-x-auto">
          {alertsQ.isLoading && <Skeleton className="h-24 w-full" />}
          {alertsQ.error && <div className="p-4 text-sm">{friendlyError(alertsQ.error)}</div>}
          {!alertsQ.isLoading && !alertsQ.error && filteredAlerts.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No billing alerts to review.
            </div>
          )}
          {filteredAlerts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Alert type</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Store event</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <SeverityBadge severity={a.severity} />
                    </TableCell>
                    <TableCell className="text-sm">{humanise(a.alert_type)}</TableCell>
                    <TableCell className="text-sm">
                      {billingSourceLabel(a.provider)}
                    </TableCell>
                    <TableCell className="text-sm">{humanise(a.event_type)}</TableCell>
                    <TableCell className="text-sm">{a.product_id ?? "—"}</TableCell>
                    <TableCell className="text-sm max-w-[320px]">{a.detail ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {a.resolved_user_id ? (
                        <button
                          className="text-primary hover:underline"
                          onClick={() => setSelectedUser(a.resolved_user_id)}
                        >
                          View user
                        </button>
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{fmtDateTime(a.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {a.acknowledged_at ? "Acknowledged" : "Open"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!a.acknowledged_at && (
                        <Button size="sm" variant="outline" onClick={() => setAckTarget(a)}>
                          Acknowledge
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      {/* Users & access */}
      <section>
        <h2 className="text-sm font-semibold mb-2">Users &amp; access</h2>
        <Card className="p-3 mb-3 space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <Select
              value={vineyardId}
              onValueChange={(v) => {
                setVineyardId(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Vineyard" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All vineyards</SelectItem>
                {(vineyardsQ.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="worker">Worker</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={planCode}
              onValueChange={(v) => {
                setPlanCode(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All plans</SelectItem>
                {(plansQ.data ?? []).map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={billingSource}
              onValueChange={(v) => {
                setBillingSource(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Billing source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All billing sources</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="manual">Manual grant</SelectItem>
                <SelectItem value="stripe">Portal billing (Stripe)</SelectItem>
                <SelectItem value="apple">Apple App Store</SelectItem>
                <SelectItem value="google">Google Play</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={accessFilter}
              onValueChange={(v) => {
                setAccessFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Access" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any access state</SelectItem>
                <SelectItem value="granted">Has access</SelectItem>
                <SelectItem value="denied">No access</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {usersQ.isLoading
                ? "Loading users…"
                : `Showing ${from}–${to} of ${total} user${total === 1 ? "" : "s"}`}
            </span>
            <div className="flex items-center gap-2">
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(0);
                }}
              >
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s} per page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="p-0 overflow-x-auto">
          {usersQ.isLoading && <Skeleton className="h-40 w-full" />}
          {usersQ.error && <div className="p-4 text-sm">{friendlyError(usersQ.error)}</div>}
          {!usersQ.isLoading && !usersQ.error && rows.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No users match these filters.
            </div>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Vineyards</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>
                    <HeadInfo label="Reason" hint="Why the backend granted or withheld access, including trial states." />
                  </TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>
                    <HeadInfo
                      label="Source"
                      hint="Where the entitlement comes from: an account trial, a licence, a subscription or a manual grant."
                    />
                  </TableHead>
                  <TableHead>
                    <HeadInfo
                      label="Purchase platform"
                      hint="Where the paid subscription was bought. Trials and manual grants have no purchase platform."
                    />
                  </TableHead>
                  <TableHead>
                    <HeadInfo
                      label="Available platforms"
                      hint="The VineTrack platforms this account may currently use according to the shared entitlement resolver."
                    />
                  </TableHead>
                  <TableHead>Last verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.user_id}
                    className="cursor-pointer"
                    onClick={() => setSelectedUser(r.user_id)}
                  >
                    <TableCell>
                      <div className="font-medium text-sm">{r.full_name ?? r.email ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.email ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.vineyards.length === 0
                        ? "—"
                        : r.vineyards.map((v) => `${v.name} (${humanise(v.role)})`).join(", ")}
                    </TableCell>
                    <TableCell>
                      <AccessBadge granted={r.has_access} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {resolvedReasonLabel({
                        reason_code: r.reason_code,
                        access_source: r.access_source,
                      })}
                    </TableCell>
                    <TableCell className="text-sm">{humanise(r.plan_code)}</TableCell>
                    <TableCell className="text-sm">
                      {isTrialSource(r.access_source)
                        ? "Account trial"
                        : billingSourceLabel(r.access_source ?? r.billing_provider)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {purchasePlatformLabel(r.purchase_platform)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {platformsAllowed({
                        portal_access: r.portal_access,
                        can_use_ios_app: r.can_use_ios_app,
                        can_use_android_app: r.can_use_android_app,
                      })}
                    </TableCell>
                    <TableCell className="text-xs">{fmtDateTime(r.last_verified_at)}</TableCell>
                  </TableRow>
                ))}

              </TableBody>
            </Table>
          )}
        </Card>

        <div className="flex items-center justify-end gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <UserAccessDrawer
        userId={selectedUser}
        onOpenChange={(o) => !o && setSelectedUser(null)}
      />

      <AcknowledgeAlertDialog
        alert={ackTarget}
        onOpenChange={(o) => !o && setAckTarget(null)}
        details={
          ackTarget
            ? {
                alertType: humanise(ackTarget.alert_type),
                user: ackTarget.resolved_user_id ? "Linked account" : "Not linked",
                product: ackTarget.product_id ?? "—",
                platform: billingSourceLabel(ackTarget.provider),
                reason: ackTarget.detail ?? "—",
                createdAt: ackTarget.created_at,
              }
            : null
        }
      />

      <HealthDetailDialog
        open={!!activeCard}
        onOpenChange={(o) => !o && setDetailCard(null)}
        title={activeCard?.title ?? ""}
        explanation={activeCard?.explanation ?? ""}
        items={activeCard?.items ?? []}
      />

      <BillingReviewPanel
        itemType={reviewType}
        onOpenChange={(o) => !o && setReviewType(null)}
        onViewUser={(id) => {
          setReviewType(null);
          setSelectedUser(id);
        }}
      />
    </AdminGate>
  );
}
