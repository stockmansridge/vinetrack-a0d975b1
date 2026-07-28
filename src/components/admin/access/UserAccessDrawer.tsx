import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  History,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import {
  accessGranted,
  accessReasonLabel,
  billingSourceLabel,
  detailObject,
  detailSection,
  fmtDateOnly,
  fmtDateTime,
  friendlyError,
  grantTypeLabel,
  lifecycleLabel,
  num,
  pick,
  platformLabel,
  useUserAccessDetail,
  useUserAccessHistory,
  type Rec,
} from "@/lib/accessEntitlementsQuery";
import {
  AssignLicenceDialog,
  CreateGrantDialog,
  ExtendGrantDialog,
  RefreshEntitlementDialog,
  RemoveLicenceDialog,
  RevokeGrantDialog,
  type LicencePoolOption,
} from "./accessDialogs";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm py-0.5">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1 break-words">{value ?? "—"}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground py-3">{children}</p>;
}

const yesNo = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "—");

export function UserAccessDrawer({
  userId,
  onOpenChange,
}: {
  userId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detailQ = useUserAccessDetail(userId);
  const historyQ = useUserAccessHistory(userId);
  const [grantOpen, setGrantOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [extendTarget, setExtendTarget] = useState<Rec | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Rec | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Rec | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showHistoryAdmin, setShowHistoryAdmin] = useState(false);

  const detail = detailQ.data ?? null;
  const identity = detailObject(detail, "identity", "user", "profile") ?? detail ?? {};
  const access =
    detailObject(detail, "access", "effective_access", "entitlement", "summary") ?? detail ?? {};
  const memberships = detailSection(detail, "memberships", "vineyard_memberships", "vineyards");
  const sources = detailSection(detail, "billing_sources", "sources", "subscriptions");
  const licences = detailSection(detail, "licences", "licence_assignments", "assigned_licences");
  const alerts = detailSection(detail, "alerts", "open_alerts", "billing_alerts");
  const pools = detailSection(detail, "licence_pools", "assignable_pools", "available_pools");

  const email = String(pick(identity, "email", "user_email") ?? "—");
  const fullName = String(pick(identity, "full_name", "name", "display_name") ?? email);
  const granted = accessGranted(access);
  const unlimited =
    pick(access, "unlimited_licences", "is_unlimited", "unlimited") === true ||
    String(pick(access, "access_reason", "reason", "entitlement_reason") ?? "") ===
      "internal_unlimited";

  const activeSources = sources.filter(
    (s) => pick(s, "is_current", "currently_valid", "is_valid", "is_active") === true,
  );
  const historicSources = sources.filter((s) => !activeSources.includes(s));

  const vineyardOptions = useMemo(
    () =>
      memberships
        .map((m) => ({
          id: String(pick(m, "vineyard_id", "id") ?? ""),
          name: String(pick(m, "vineyard_name", "name") ?? "Vineyard"),
        }))
        .filter((v) => v.id),
    [memberships],
  );

  const poolOptions: LicencePoolOption[] = useMemo(
    () =>
      pools.map((p) => {
        const total = pick(p, "seats_total", "seats_included", "total_seats");
        const assigned = pick(p, "seats_assigned", "assigned_seats", "active_licences");
        const available = pick(p, "seats_available", "available_seats");
        const availableNum =
          available != null
            ? num(available)
            : total != null && assigned != null
              ? num(total) - num(assigned)
              : null;
        const isStore = ["apple", "google", "google_play", "app_store"].includes(
          String(pick(p, "billing_provider", "provider", "platform") ?? "").toLowerCase(),
        );
        return {
          subscriptionId: String(pick(p, "subscription_id", "id") ?? ""),
          label: `${String(pick(p, "plan_name", "plan_code", "product", "label") ?? "Licence pool")}${
            availableNum != null ? ` · ${availableNum} seat(s) free` : ""
          }`,
          seatsTotal: total != null ? num(total) : null,
          seatsAssigned: assigned != null ? num(assigned) : null,
          seatsAvailable: availableNum,
          vineyardId: (pick(p, "vineyard_id") as string) ?? null,
          vineyardName: (pick(p, "vineyard_name") as string) ?? null,
          assignable:
            !isStore && (availableNum == null || availableNum > 0) && !!pick(p, "subscription_id", "id"),
          blockedReason: isStore
            ? "App Store and Google Play subscriptions cannot be assigned as team seats."
            : availableNum != null && availableNum <= 0
              ? "No seats remain in this licence pool."
              : undefined,
        };
      }),
    [pools],
  );

  const copyId = () => {
    if (!userId) return;
    navigator.clipboard?.writeText(userId);
    toast({ title: "User ID copied" });
  };

  return (
    <Sheet open={!!userId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl lg:max-w-3xl overflow-y-auto"
      >
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            {fullName}
            {granted ? (
              <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
                <ShieldCheck className="h-3 w-3" /> Active
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <ShieldX className="h-3 w-3" /> No Access
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>{email}</SheetDescription>
        </SheetHeader>

        {detailQ.isLoading && (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {detailQ.error && (
          <Card className="p-4 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5" />
            <div className="space-y-2">
              <p>{friendlyError(detailQ.error)}</p>
              <Button size="sm" variant="outline" onClick={() => detailQ.refetch()}>
                Retry
              </Button>
            </div>
          </Card>
        )}

        {!detailQ.isLoading && !detailQ.error && (
          <div className="space-y-6 pb-10">
            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setGrantOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create Billing Grant
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                Assign licence
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRefreshOpen(true)}>
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh entitlement
              </Button>
            </div>

            {/* B. Effective access */}
            <Card className="p-4 space-y-1">
              <div className="text-sm font-semibold mb-1">Effective access</div>
              <Kv label="Access" value={granted ? "Granted" : "Denied"} />
              <Kv
                label="Effective plan"
                value={
                  unlimited
                    ? "Internal Unlimited"
                    : (pick(access, "plan_name", "plan_code", "effective_plan") as string) ?? "—"
                }
              />
              <Kv
                label="Reason"
                value={accessReasonLabel(
                  pick(access, "access_reason", "reason", "entitlement_reason"),
                )}
              />
              <Kv
                label="Access source"
                value={billingSourceLabel(
                  pick(access, "access_source", "billing_source", "source"),
                )}
              />
              <Kv
                label="Licences"
                value={
                  unlimited
                    ? "Unlimited"
                    : (pick(access, "active_licences", "licence_count") as number) ?? "—"
                }
              />
              <Kv
                label="Platforms"
                value={
                  unlimited
                    ? "Portal, iOS, Android"
                    : [
                        pick(access, "portal_access", "can_use_portal") ? "Portal" : null,
                        pick(access, "ios_access", "can_use_ios_app", "can_use_ios") ? "iOS" : null,
                        pick(access, "android_access", "can_use_android") ? "Android" : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || "—"
                }
              />
              <Kv
                label="Effective expiry"
                value={fmtDateTime(
                  pick(access, "effective_expiry", "expires_at", "current_period_end"),
                )}
              />
              <Kv label="Lifecycle" value={lifecycleLabel(access)} />
              <Kv
                label="Last verified"
                value={fmtDateTime(pick(access, "last_verified_at", "last_verified"))}
              />
              <Kv
                label="Enforcement"
                value={
                  (pick(access, "enforcement_state", "enforcement") as string) ??
                  (granted ? "Enforced — access allowed" : "Enforced — access blocked")
                }
              />
            </Card>

            {/* A. Identity */}
            <Section title="Identity">
              <Card className="p-4">
                <Kv label="Full name" value={fullName} />
                <Kv label="Email" value={email} />
                <Kv
                  label="Email confirmed"
                  value={yesNo(pick(identity, "email_confirmed", "email_confirmed_at") != null
                    ? pick(identity, "email_confirmed") ?? true
                    : undefined)}
                />
                <Kv
                  label="User ID"
                  value={
                    <span className="inline-flex items-center gap-2">
                      <code className="text-xs text-muted-foreground">{userId}</code>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={copyId}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </span>
                  }
                />
                <Kv label="Created" value={fmtDateTime(pick(identity, "created_at"))} />
                <Kv
                  label="Last sign-in"
                  value={fmtDateTime(pick(identity, "last_sign_in_at", "last_seen_at"))}
                />
                <Kv label="Disabled" value={yesNo(pick(identity, "is_disabled", "disabled"))} />
              </Card>
            </Section>

            {/* C. Memberships */}
            <Section title="Vineyard memberships">
              {memberships.length === 0 ? (
                <Empty>No active vineyard memberships.</Empty>
              ) : (
                <Card className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vineyard</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Licence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {memberships
                        .filter((m) => !pick(m, "vineyard_deleted_at", "deleted_at"))
                        .map((m, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              {String(pick(m, "vineyard_name", "name") ?? "—")}
                              {pick(m, "is_default", "is_selected") === true && (
                                <Badge variant="outline" className="ml-2 text-[10px]">
                                  Default
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{String(pick(m, "role") ?? "—")}</TableCell>
                            <TableCell>
                              {String(pick(m, "membership_status", "status", "invitation_status") ?? "Active")}
                            </TableCell>
                            <TableCell>
                              {pick(m, "licence_assigned", "has_licence") === true
                                ? "Assigned"
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
              <p className="text-[11px] text-muted-foreground">
                Membership role controls permissions inside a vineyard. It does not grant paid
                access.
              </p>
              <Collapsible open={showHistoryAdmin} onOpenChange={setShowHistoryAdmin}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="px-0 text-xs">
                    <ChevronDown className="h-3 w-3 mr-1" /> Administrative history (deleted
                    vineyards, revoked memberships)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="text-xs text-muted-foreground space-y-1 pt-1">
                    {memberships.filter((m) => pick(m, "vineyard_deleted_at", "deleted_at")).length ===
                    0 ? (
                      <div>No archived memberships.</div>
                    ) : (
                      memberships
                        .filter((m) => pick(m, "vineyard_deleted_at", "deleted_at"))
                        .map((m, i) => (
                          <div key={i}>
                            {String(pick(m, "vineyard_name", "name") ?? "—")} ·{" "}
                            {String(pick(m, "role") ?? "—")} · removed{" "}
                            {fmtDateOnly(pick(m, "vineyard_deleted_at", "deleted_at"))}
                          </div>
                        ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Section>

            {/* D. Billing sources */}
            <Section title="Billing sources">
              {sources.length === 0 ? (
                <Empty>No billing or access sources recorded.</Empty>
              ) : (
                <div className="space-y-3">
                  {[
                    { label: "Active", rows: activeSources.length ? activeSources : sources },
                    { label: "Historical", rows: activeSources.length ? historicSources : [] },
                  ].map((group) =>
                    group.rows.length === 0 ? null : (
                      <div key={group.label} className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </div>
                        {group.rows.map((s, i) => (
                          <Card key={i} className="p-3">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="font-medium text-sm">
                                {billingSourceLabel(
                                  pick(s, "billing_source", "source", "billing_provider", "provider"),
                                )}
                              </div>
                              <Badge variant="outline">{lifecycleLabel(s)}</Badge>
                            </div>
                            <Kv label="Plan" value={(pick(s, "plan_name", "plan_code") as string) ?? "—"} />
                            <Kv label="Platform" value={platformLabel(pick(s, "platform", "purchase_platform"))} />
                            <Kv label="Product" value={(pick(s, "product", "product_id", "product_name") as string) ?? "—"} />
                            <Kv label="Start" value={fmtDateTime(pick(s, "started_at", "start_date", "created_at"))} />
                            <Kv label="Current period end" value={fmtDateTime(pick(s, "current_period_end", "period_end"))} />
                            <Kv label="Grace period" value={yesNo(pick(s, "in_grace_period", "grace_period_active"))} />
                            <Kv label="Cancels at period end" value={yesNo(pick(s, "cancel_at_period_end"))} />
                            <Kv label="Expiry" value={fmtDateTime(pick(s, "expires_at", "expiry", "manual_grant_expires_at"))} />
                            <Kv label="Last provider event" value={fmtDateTime(pick(s, "last_event_at", "last_provider_event_at"))} />
                            <Kv label="Last verified" value={fmtDateTime(pick(s, "last_verified_at"))} />
                            <Kv
                              label="Currently valid"
                              value={yesNo(pick(s, "is_current", "currently_valid", "is_valid", "is_active"))}
                            />
                            {pick(s, "manual_grant_reason", "reason") && (
                              <Kv label="Reason" value={String(pick(s, "manual_grant_reason", "reason"))} />
                            )}
                            {String(pick(s, "billing_source", "source", "billing_provider") ?? "")
                              .toLowerCase()
                              .includes("manual") ||
                            pick(s, "grant_type") ? (
                              <div className="flex gap-2 pt-2">
                                <Button size="sm" variant="outline" onClick={() => setExtendTarget(s)}>
                                  Extend
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setRevokeTarget(s)}>
                                  Revoke
                                </Button>
                              </div>
                            ) : null}
                          </Card>
                        ))}
                      </div>
                    ),
                  )}
                </div>
              )}
            </Section>

            {/* E. Licences */}
            <Section title="Licence assignments">
              {licences.length === 0 ? (
                <Empty>No licence assignments.</Empty>
              ) : (
                <Card className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subscription</TableHead>
                        <TableHead>Vineyard</TableHead>
                        <TableHead>Assigned</TableHead>
                        <TableHead>Assigned by</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Removed</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {licences.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">
                            {String(pick(l, "plan_name", "plan_code", "subscription_label") ?? "—")}
                          </TableCell>
                          <TableCell>{String(pick(l, "vineyard_name") ?? "—")}</TableCell>
                          <TableCell>{fmtDateOnly(pick(l, "assigned_at", "created_at"))}</TableCell>
                          <TableCell className="text-xs">
                            {String(pick(l, "assigned_by_email", "assigned_by_name", "assigned_by") ?? "—")}
                          </TableCell>
                          <TableCell>{String(pick(l, "status") ?? "—")}</TableCell>
                          <TableCell>{fmtDateOnly(pick(l, "removed_at", "revoked_at"))}</TableCell>
                          <TableCell className="text-right">
                            {pick(l, "licence_id", "id") && !pick(l, "removed_at", "revoked_at") ? (
                              <Button size="sm" variant="outline" onClick={() => setRemoveTarget(l)}>
                                Remove
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </Section>

            {/* F. Alerts */}
            <Section title="Open alerts">
              {alerts.length === 0 ? (
                <Empty>No open billing alerts for this user.</Empty>
              ) : (
                <div className="space-y-2">
                  {alerts.map((a, i) => (
                    <Card key={i} className="p-3 text-sm">
                      <div className="font-medium">
                        {String(pick(a, "alert_type", "type") ?? "Alert")}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {String(pick(a, "reason", "message", "detail") ?? "—")} ·{" "}
                        {fmtDateTime(pick(a, "created_at"))}
                      </div>
                    </Card>
                  ))}
                  <p className="text-[11px] text-muted-foreground">
                    Acknowledge alerts from the alert inbox on the main page.
                  </p>
                </div>
              )}
            </Section>

            {/* G. History */}
            <Section title="Access history">
              {historyQ.isLoading && <Skeleton className="h-24 w-full" />}
              {historyQ.error && (
                <Empty>{friendlyError(historyQ.error)}</Empty>
              )}
              {!historyQ.isLoading && !historyQ.error && (historyQ.data?.length ?? 0) === 0 && (
                <Empty>No recorded access events.</Empty>
              )}
              <ol className="space-y-3">
                {(historyQ.data ?? []).map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <History className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {String(pick(h, "event_label", "event_type", "event", "action") ?? "Event")
                          .replace(/[_-]+/g, " ")
                          .replace(/\b\w/g, (c) => c.toUpperCase())}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(pick(h, "created_at", "occurred_at", "event_at"))}
                        {pick(h, "actor_email", "actor", "performed_by_email") &&
                          ` · ${String(pick(h, "actor_email", "actor", "performed_by_email"))}`}
                      </div>
                      {pick(h, "reason", "note") && (
                        <div className="text-xs mt-0.5">{String(pick(h, "reason", "note"))}</div>
                      )}
                      {(pick(h, "old_state_summary", "previous_state_label") ||
                        pick(h, "new_state_summary", "new_state_label")) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {String(pick(h, "old_state_summary", "previous_state_label") ?? "—")} →{" "}
                          {String(pick(h, "new_state_summary", "new_state_label") ?? "—")}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {(historyQ.data?.length ?? 0) > 0 && (
                <Collapsible open={showTechnical} onOpenChange={setShowTechnical}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="px-0 text-xs">
                      <ChevronDown className="h-3 w-3 mr-1" /> Technical details
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="text-[10px] bg-muted rounded-md p-2 overflow-x-auto max-h-64">
                      {JSON.stringify(historyQ.data, null, 2)}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </Section>
          </div>
        )}

        {/* Dialogs */}
        <CreateGrantDialog
          open={grantOpen}
          onOpenChange={setGrantOpen}
          userId={userId}
          userLabel={fullName}
          vineyards={vineyardOptions}
        />
        <RefreshEntitlementDialog
          open={refreshOpen}
          onOpenChange={setRefreshOpen}
          userId={userId}
          userLabel={fullName}
        />
        <AssignLicenceDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          userId={userId}
          userLabel={fullName}
          pools={poolOptions}
        />
        <ExtendGrantDialog
          open={!!extendTarget}
          onOpenChange={(o) => !o && setExtendTarget(null)}
          subscriptionId={
            extendTarget ? String(pick(extendTarget, "subscription_id", "id") ?? "") : null
          }
          userId={userId}
          summary={
            extendTarget
              ? `${grantTypeLabel(pick(extendTarget, "grant_type"))} · ${fullName}`
              : ""
          }
        />
        <RevokeGrantDialog
          open={!!revokeTarget}
          onOpenChange={(o) => !o && setRevokeTarget(null)}
          subscriptionId={
            revokeTarget ? String(pick(revokeTarget, "subscription_id", "id") ?? "") : null
          }
          userId={userId}
          summary={
            revokeTarget
              ? `${grantTypeLabel(pick(revokeTarget, "grant_type"))} · ${fullName}`
              : ""
          }
        />
        <RemoveLicenceDialog
          open={!!removeTarget}
          onOpenChange={(o) => !o && setRemoveTarget(null)}
          licenceId={
            removeTarget ? String(pick(removeTarget, "licence_id", "id") ?? "") : null
          }
          userId={userId}
          summary={
            removeTarget
              ? `${fullName} · ${String(pick(removeTarget, "vineyard_name") ?? "—")}`
              : ""
          }
          warnAccessLoss={
            granted &&
            String(pick(access, "access_reason", "reason") ?? "") === "assigned_licence"
          }
        />
      </SheetContent>
    </Sheet>
  );
}
