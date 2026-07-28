import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { AdminGate, AdminPageHeader } from "./_shared";
import { UserAccessDrawer } from "@/components/admin/access/UserAccessDrawer";
import { AcknowledgeAlertDialog } from "@/components/admin/access/accessDialogs";
import {
  AE_KEYS,
  accessGranted,
  accessReasonLabel,
  alertId,
  alertSeverity,
  billingSourceLabel,
  fmtDateTime,
  friendlyError,
  lifecycleLabel,
  num,
  pick,
  platformLabel,
  useAccessUsers,
  useBillingAlerts,
  useBillingMonitor,
  userIdOf,
  type Rec,
} from "@/lib/accessEntitlementsQuery";

const PAGE_SIZES = [25, 50, 100];

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
  onAction,
  actionLabel,
  loading,
}: {
  title: string;
  count: number;
  state: HealthState;
  explanation: string;
  onAction?: () => void;
  actionLabel?: string;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-28 w-full" />;
  return (
    <Card className={`p-4 flex flex-col justify-between min-h-[7rem] border ${HEALTH_STYLE[state]}`}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <HealthIcon state={state} />
        </div>
        <div className="text-2xl font-semibold mt-1">{count}</div>
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{explanation}</p>
      </div>
      {onAction && actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="text-[11px] text-primary hover:underline self-start mt-2"
        >
          {actionLabel}
        </button>
      )}
    </Card>
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

function SeverityBadge({ severity }: { severity: "critical" | "warning" | "info" }) {
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

const ALL = "__all__";

export default function AccessEntitlementsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();

  /* -------------------- filters & pagination -------------------- */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [billingSource, setBillingSource] = useState<string>(
    params.get("filter") === "manual_override" ? "manual" : ALL,
  );
  const [role, setRole] = useState<string>(ALL);
  const [planCode, setPlanCode] = useState<string>(ALL);
  const [vineyardId, setVineyardId] = useState<string>(ALL);
  const [accessFilter, setAccessFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [reviewFilter, setReviewFilter] = useState<string>(ALL);
  const [platformFilter, setPlatformFilter] = useState<string>(ALL);
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
  });

  const rows = usersQ.data?.rows ?? [];
  const total = usersQ.data?.total ?? null;

  // Refinements the RPC does not accept as parameters are applied to the
  // fetched page only (clearly a page-level refinement, never a substitute
  // for server filtering).
  const visibleRows = useMemo(
    () =>
      rows.filter((r) => {
        if (accessFilter !== ALL) {
          const granted = accessGranted(r);
          if (accessFilter === "granted" && !granted) return false;
          if (accessFilter === "denied" && granted) return false;
        }
        if (statusFilter !== ALL) {
          const s = String(pick(r, "subscription_status", "status") ?? "").toLowerCase();
          if (s !== statusFilter) return false;
        }
        if (reviewFilter !== ALL) {
          const s = String(pick(r, "review_status", "needs_review") ?? "").toLowerCase();
          if (reviewFilter === "needs_review" && !(s === "needs_review" || s === "true"))
            return false;
          if (reviewFilter === "ok" && (s === "needs_review" || s === "true")) return false;
        }
        if (platformFilter !== ALL) {
          const p = String(pick(r, "purchase_platform", "platform") ?? "none").toLowerCase();
          if (platformLabel(p).toLowerCase() !== platformFilter) return false;
        }
        return true;
      }),
    [rows, accessFilter, statusFilter, reviewFilter, platformFilter],
  );

  const vineyardOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      const id = pick<string>(r, "vineyard_id");
      const name = pick<string>(r, "vineyard_name");
      if (id) map.set(id, name ?? id);
    });
    return [...map.entries()];
  }, [rows]);

  const planOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const p = pick<string>(r, "plan_code", "plan_name", "effective_plan");
      if (p) s.add(p);
    });
    return [...s];
  }, [rows]);

  const monitor = monitorQ.data ?? {};
  const m = (...keys: string[]) => num(pick(monitor, ...keys), 0);

  const cards: {
    title: string;
    count: number;
    state: HealthState;
    explanation: string;
    action?: () => void;
    actionLabel?: string;
  }[] = [
    {
      title: "Needs Review",
      count: m("needs_review", "needs_review_count", "review_required"),
      state: m("needs_review", "needs_review_count", "review_required") > 0 ? "attention" : "healthy",
      explanation:
        m("needs_review", "needs_review_count", "review_required") > 0
          ? "Provider events require administrator review."
          : "No entitlements require review.",
      action: () => {
        setReviewFilter("needs_review");
        setPage(0);
      },
      actionLabel: "Filter users needing review",
    },
    {
      title: "Failed Events",
      count: m("failed_events", "failed_event_count", "failed"),
      state: m("failed_events", "failed_event_count", "failed") > 0 ? "critical" : "healthy",
      explanation:
        m("failed_events", "failed_event_count", "failed") > 0
          ? "Billing events failed processing."
          : "No billing events have failed processing.",
    },
    {
      title: "Unknown Products",
      count: m("unknown_products", "unknown_product_count"),
      state: m("unknown_products", "unknown_product_count") > 0 ? "attention" : "healthy",
      explanation:
        m("unknown_products", "unknown_product_count") > 0
          ? "Store products are not mapped to a VineTrack plan."
          : "All store products map to a known plan.",
    },
    {
      title: "Unresolved Users",
      count: m("unresolved_users", "unresolved_user_count"),
      state: m("unresolved_users", "unresolved_user_count") > 0 ? "critical" : "healthy",
      explanation:
        m("unresolved_users", "unresolved_user_count") > 0
          ? "Purchases could not be linked to a VineTrack account."
          : "Every purchase is linked to an account.",
    },
    {
      title: "Ownership Conflicts",
      count: m("ownership_conflicts", "ownership_conflict_count"),
      state: m("ownership_conflicts", "ownership_conflict_count") > 0 ? "critical" : "healthy",
      explanation:
        m("ownership_conflicts", "ownership_conflict_count") > 0
          ? "A subscription is claimed by more than one account."
          : "No subscription ownership conflicts.",
    },
    {
      title: "Sync Delays",
      count: m("sync_delays", "sync_delay_count", "stale_syncs"),
      state: m("sync_delays", "sync_delay_count", "stale_syncs") > 0 ? "attention" : "healthy",
      explanation:
        m("sync_delays", "sync_delay_count", "stale_syncs") > 0
          ? "Provider sync is behind schedule."
          : "Provider sync is up to date.",
    },
    {
      title: "Expiring Soon",
      count: m("expiring_soon", "expiring_soon_count"),
      state: m("expiring_soon", "expiring_soon_count") > 0 ? "attention" : "healthy",
      explanation:
        m("expiring_soon", "expiring_soon_count") > 0
          ? "Access expires within the monitoring window."
          : "Nothing expires in the monitoring window.",
    },
    {
      title: "Recent Changes",
      count: m("recent_changes", "recent_change_count", "changes_last_24h"),
      state: "healthy",
      explanation: "Entitlement changes recorded recently.",
    },
  ];

  const filteredAlerts = (alertsQ.data ?? []).filter((a) => {
    if (alertSeverityFilter !== ALL && alertSeverity(a) !== alertSeverityFilter) return false;
    if (
      alertTypeFilter !== ALL &&
      String(pick(a, "alert_type", "type") ?? "") !== alertTypeFilter
    )
      return false;
    return true;
  });

  const alertTypes = useMemo(() => {
    const s = new Set<string>();
    (alertsQ.data ?? []).forEach((a) => {
      const t = pick<string>(a, "alert_type", "type");
      if (t) s.add(t);
    });
    return [...s];
  }, [alertsQ.data]);

  const [ackTarget, setAckTarget] = useState<Rec | null>(null);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: AE_KEYS.root });
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setBillingSource(ALL);
    setRole(ALL);
    setPlanCode(ALL);
    setVineyardId(ALL);
    setAccessFilter(ALL);
    setStatusFilter(ALL);
    setReviewFilter(ALL);
    setPlatformFilter(ALL);
    setPage(0);
  };

  const permissionError = usersQ.error && friendlyError(usersQ.error);

  return (
    <AdminGate>
      <AdminPageHeader
        title="Access & Entitlements"
        subtitle="Review user access, subscriptions, licence assignments, Billing Grants and billing issues across VineTrack."
        actions={
          <Button variant="outline" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
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
            {cards.map((c) => (
              <HealthCard
                key={c.title}
                title={c.title}
                count={c.count}
                state={c.state}
                explanation={c.explanation}
                onAction={c.action}
                actionLabel={c.actionLabel}
                loading={monitorQ.isLoading}
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
              <SelectTrigger className="h-8 w-[170px]">
                <SelectValue placeholder="Alert type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {alertTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/[_-]+/g, " ")}
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
          {alertsQ.error && (
            <div className="p-4 text-sm">{friendlyError(alertsQ.error)}</div>
          )}
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
                  <TableHead>User</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map((a, i) => {
                  const acked = !!pick(a, "acknowledged_at", "acknowledged");
                  const uid = pick<string>(a, "user_id");
                  return (
                    <TableRow key={alertId(a) || i}>
                      <TableCell>
                        <SeverityBadge severity={alertSeverity(a)} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {String(pick(a, "alert_type", "type") ?? "—").replace(/[_-]+/g, " ")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {uid ? (
                          <button
                            className="text-primary hover:underline"
                            onClick={() => setSelectedUser(uid)}
                          >
                            {String(pick(a, "user_email", "email", "full_name") ?? "View user")}
                          </button>
                        ) : (
                          String(pick(a, "user_email", "email") ?? "—")
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {String(pick(a, "product", "product_id", "plan_code") ?? "—")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {platformLabel(pick(a, "platform", "purchase_platform"))}
                      </TableCell>
                      <TableCell className="text-sm max-w-[280px] truncate">
                        {String(pick(a, "reason", "message", "detail") ?? "—")}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDateTime(pick(a, "created_at"))}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{acked ? "Acknowledged" : "Open"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!acked && (
                          <Button size="sm" variant="outline" onClick={() => setAckTarget(a)}>
                            Acknowledge
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
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
              placeholder="Search name, email, vineyard or user ID…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="grid gap-2 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
            <FilterSelect label="Access" value={accessFilter} onChange={setAccessFilter} options={[["granted", "Granted"], ["denied", "Denied"]]} />
            <FilterSelect
              label="Billing source"
              value={billingSource}
              onChange={(v) => {
                setBillingSource(v);
                setPage(0);
              }}
              options={[
                ["internal", "Internal Grant"],
                ["manual", "Manual Grant"],
                ["stripe", "Portal"],
                ["apple", "Apple"],
                ["google", "Google Play"],
                ["licence", "Assigned Licence"],
                ["trial", "Trial"],
                ["none", "None"],
              ]}
            />
            <FilterSelect
              label="Purchase platform"
              value={platformFilter}
              onChange={setPlatformFilter}
              options={[["ios", "iOS"], ["android", "Android"], ["portal", "Portal"], ["none", "None"]]}
            />
            <FilterSelect
              label="Subscription status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                ["active", "Active"],
                ["trialing", "Trial"],
                ["expired", "Expired"],
                ["cancelled", "Cancelled"],
                ["failed", "Failed"],
                ["mismatch", "Mismatch"],
                ["needs_review", "Needs Review"],
              ]}
            />
            <FilterSelect
              label="Review status"
              value={reviewFilter}
              onChange={setReviewFilter}
              options={[["needs_review", "Needs Review"], ["ok", "Reviewed"]]}
            />
            <FilterSelect
              label="Vineyard role"
              value={role}
              onChange={(v) => {
                setRole(v);
                setPage(0);
              }}
              options={[["owner", "Owner"], ["manager", "Manager"], ["worker", "Worker"], ["viewer", "Viewer"]]}
            />
            <FilterSelect
              label="Plan"
              value={planCode}
              onChange={(v) => {
                setPlanCode(v);
                setPage(0);
              }}
              options={planOptions.map((p) => [p, p] as [string, string])}
            />
            <FilterSelect
              label="Vineyard"
              value={vineyardId}
              onChange={(v) => {
                setVineyardId(v);
                setPage(0);
              }}
              options={vineyardOptions as [string, string][]}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        </Card>

        <Card className="p-0 overflow-x-auto">
          {usersQ.isLoading && (
            <div className="p-3 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}

          {permissionError && (
            <div className="p-6 text-sm space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                {permissionError}
              </div>
              <Button size="sm" variant="outline" onClick={() => usersQ.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!usersQ.isLoading && !usersQ.error && visibleRows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground space-y-3">
              <p>No users match the current search and filters.</p>
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}

          {!usersQ.isLoading && !usersQ.error && visibleRows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Vineyard</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Last verified</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((r, i) => {
                  const uid = userIdOf(r);
                  const granted = accessGranted(r);
                  const review = String(pick(r, "review_status", "needs_review") ?? "");
                  return (
                    <TableRow
                      key={uid || i}
                      className="cursor-pointer"
                      onClick={() => uid && setSelectedUser(uid)}
                    >
                      <TableCell>
                        <div className="font-medium text-sm">
                          {String(pick(r, "full_name", "name") ?? "—")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {String(pick(r, "email", "user_email") ?? "—")}
                          {pick(r, "email_confirmed") === false && " · unconfirmed"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{String(pick(r, "vineyard_name") ?? "—")}</div>
                        <div className="text-xs text-muted-foreground">
                          {String(pick(r, "vineyard_role", "role") ?? "—")}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {String(pick(r, "plan_name", "effective_plan", "plan_code") ?? "—")}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <AccessBadge granted={granted} />
                          <div className="text-[11px] text-muted-foreground">
                            {accessReasonLabel(pick(r, "access_reason", "reason"))}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{billingSourceLabel(pick(r, "billing_source", "access_source", "source"))}</div>
                        <div className="text-xs text-muted-foreground">
                          {platformLabel(pick(r, "purchase_platform", "platform"))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{lifecycleLabel(r)}</TableCell>
                      <TableCell className="text-sm">
                        {review === "needs_review" || review === "true" ? (
                          <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                            Needs Review
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {fmtDateTime(pick(r, "last_verified_at", "last_verified"))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (uid) setSelectedUser(uid);
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm">
          <div className="text-muted-foreground">
            {total != null
              ? `${total} result${total === 1 ? "" : "s"} · page ${page + 1}`
              : `Page ${page + 1} · showing ${visibleRows.length} of ${rows.length} loaded`}
          </div>
          <div className="flex items-center gap-2">
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
                    {s} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                rows.length < pageSize ||
                (total != null && (page + 1) * pageSize >= total)
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <UserAccessDrawer
        userId={selectedUser}
        onOpenChange={(o) => !o && setSelectedUser(null)}
      />

      <AcknowledgeAlertDialog
        alert={ackTarget ? { id: alertId(ackTarget) } : null}
        onOpenChange={(o) => !o && setAckTarget(null)}
        details={
          ackTarget
            ? {
                alertType: String(pick(ackTarget, "alert_type", "type") ?? "—"),
                user: String(pick(ackTarget, "user_email", "email", "full_name") ?? "—"),
                product: String(pick(ackTarget, "product", "product_id", "plan_code") ?? "—"),
                platform: platformLabel(pick(ackTarget, "platform", "purchase_platform")),
                reason: String(pick(ackTarget, "reason", "message", "detail") ?? "—"),
                createdAt: pick<string>(ackTarget, "created_at"),
              }
            : null
        }
      />
    </AdminGate>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
