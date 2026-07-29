import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, ShieldX } from "lucide-react";
import {
  AssignLicenceDialog,
  CreateGrantDialog,
  ExtendGrantDialog,
  RefreshEntitlementDialog,
  RemoveLicenceDialog,
  RevokeGrantDialog,
  type LicencePoolOption,
} from "./accessDialogs";
import {
  billingSourceLabel,
  fmtDateTime,
  friendlyError,
  grantTypeLabel,
  historyEventLabel,
  isTrialSource,
  platformsAllowed,
  purchasePlatformLabel,
  resolvedReasonLabel,
  useUserAccessDetail,
  useUserAccessHistory,
  type BillingSource,
  type LicenceHeld,
  type Membership,
} from "@/lib/accessEntitlementsQuery";


function humanise(v: string | null | undefined, fallback = "—") {
  if (!v) return fallback;
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-words">{value ?? "—"}</dd>
    </div>
  );
}

function seatsSummary(sourceRow: BillingSource) {
  if (sourceRow.unlimited_licences) return "Unlimited seats";
  const total = Math.max(sourceRow.seats_included, sourceRow.seats_purchased);
  return `${sourceRow.active_licences} of ${total} seats used`;
}

export function UserAccessDrawer({
  userId,
  onOpenChange,
}: {
  userId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detailQ = useUserAccessDetail(userId);
  const historyQ = useUserAccessHistory(userId, 50);

  const [createGrant, setCreateGrant] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [extendTarget, setExtendTarget] = useState<BillingSource | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<BillingSource | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LicenceHeld | null>(null);

  const detail = detailQ.data ?? null;
  const identity = detail?.identity ?? null;
  const ea = detail?.effective_access ?? null;
  const userLabel = identity?.full_name || identity?.email || "this user";

  const vineyardOptions = useMemo(
    () =>
      (detail?.memberships.active ?? []).map((m) => ({
        id: m.vineyard_id,
        name: m.vineyard_name ?? m.vineyard_id,
      })),
    [detail],
  );

  // Assignable pools come only from subscriptions this user owns, as returned
  // by the backend — the RPC exposes no cross-account licence pool list.
  const pools: LicencePoolOption[] = useMemo(
    () =>
      (detail?.billing_sources ?? [])
        .filter((sourceRow) => sourceRow.is_owner && !sourceRow.manual_grant_revoked_at)
        .map((sourceRow) => {
          const total = Math.max(sourceRow.seats_included, sourceRow.seats_purchased);
          const available = sourceRow.unlimited_licences
            ? null
            : total - sourceRow.active_licences;
          return {
            subscriptionId: sourceRow.subscription_id,
            label: `${sourceRow.plan_name ?? humanise(sourceRow.plan_code)} — ${seatsSummary(sourceRow)}`,
            seatsTotal: sourceRow.unlimited_licences ? null : total,
            seatsAssigned: sourceRow.active_licences,
            seatsAvailable: available,
            vineyardId: null,
            vineyardName: null,
            assignable:
              sourceRow.unlimited_licences || (available !== null && available > 0),
            blockedReason:
              !sourceRow.unlimited_licences && available !== null && available <= 0
                ? "All seats in this subscription are already assigned."
                : undefined,
          };
        }),
    [detail],
  );

  const grantSources = (detail?.billing_sources ?? []).filter(
    (sourceRow) => sourceRow.provider === "manual" || sourceRow.manual_grant_reason,
  );

  return (
    <>
      <Sheet open={!!userId} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{userLabel}</SheetTitle>
            <SheetDescription>{identity?.email ?? "Access and entitlement detail"}</SheetDescription>
          </SheetHeader>

          {detailQ.isLoading && <Skeleton className="h-64 w-full" />}
          {detailQ.error && (
            <Card className="p-4 text-sm">{friendlyError(detailQ.error)}</Card>
          )}

          {detail && ea && identity && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold">Effective access</h3>
                  {ea.has_access ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
                      <ShieldCheck className="h-3 w-3" /> Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">
                      <ShieldX className="h-3 w-3" /> No access
                    </Badge>
                  )}
                </div>
                <dl>
                  <Row
                    label="Reason"
                    value={resolvedReasonLabel({
                      reason_code: ea.reason_code,
                      access_source: ea.access_source,
                    })}
                  />
                  <Row
                    label="Access source"
                    value={
                      isTrialSource(ea.access_source)
                        ? "Account trial"
                        : billingSourceLabel(ea.access_source)
                    }
                  />
                  <Row
                    label="Plan"
                    value={ea.plan_name ?? humanise(ea.plan_code)}
                  />
                  <Row
                    label="Platforms"
                    value={platformsAllowed({
                      portal_access: ea.portal_access,
                      can_use_ios_app: ea.can_use_ios_app,
                      can_use_android_app: ea.can_use_android_app,
                    })}
                  />
                  <Row label="Portal access level" value={humanise(ea.portal_access_level)} />
                  <Row label="Subscription status" value={humanise(ea.subscription_status)} />
                  <Row label="Billing provider" value={billingSourceLabel(ea.billing_provider)} />
                  <Row label="Purchase platform" value={purchasePlatformLabel(ea.purchase_platform)} />
                  <Row label="Access expires" value={fmtDateTime(ea.expires_at)} />
                  <Row label="Trial ends" value={fmtDateTime(ea.trial_end)} />
                  <Row label="Grace period ends" value={fmtDateTime(ea.grace_period_end)} />
                  <Row label="Current period ends" value={fmtDateTime(ea.current_period_end)} />
                  <Row label="Grant expiry" value={fmtDateTime(ea.manual_grant_expires_at)} />
                  <Row label="Grant reason" value={ea.manual_grant_reason ?? "—"} />
                  <Row label="Last verified" value={fmtDateTime(ea.last_verified_at)} />
                </dl>

                <div className="flex flex-wrap gap-2 pt-3">
                  <Button size="sm" onClick={() => setCreateGrant(true)}>
                    Create billing grant
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                    Assign licence
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRefreshOpen(true)}>
                    Recalculate entitlement
                  </Button>
                </div>
              </Card>

              {detail.account_trial && (
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold">Account trial</h3>
                    <Badge
                      variant="outline"
                      className={
                        detail.account_trial.is_currently_valid
                          ? "border-emerald-500/40 text-emerald-600"
                          : "text-muted-foreground"
                      }
                    >
                      {detail.account_trial.is_currently_valid ? "Active" : "Expired"}
                    </Badge>
                  </div>
                  <dl>
                    <Row label="Status" value={humanise(detail.account_trial.status)} />
                    <Row label="Started" value={fmtDateTime(detail.account_trial.trial_started_at)} />
                    <Row label="Ends" value={fmtDateTime(detail.account_trial.trial_ends_at)} />
                    <Row label="Trial type" value={humanise(detail.account_trial.source_type)} />
                    <Row label="Created from" value={humanise(detail.account_trial.created_from)} />
                    <Row
                      label="Stored on account"
                      value={
                        detail.account_trial.is_persisted
                          ? "Yes — migrated to the shared entitlement system"
                          : "No — derived from account creation date"
                      }
                    />
                  </dl>
                </Card>
              )}


              <Tabs defaultValue="billing">
                <TabsList>
                  <TabsTrigger value="billing">Billing sources</TabsTrigger>
                  <TabsTrigger value="licences">Licences</TabsTrigger>
                  <TabsTrigger value="vineyards">Vineyards</TabsTrigger>
                  <TabsTrigger value="identity">Identity</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="billing" className="space-y-3 pt-3">
                  {detail.billing_sources.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No subscriptions or grants are owned by this user.
                    </p>
                  )}
                  {detail.billing_sources.map((sourceRow) => (
                    <Card key={sourceRow.subscription_id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">
                            {sourceRow.plan_name ?? humanise(sourceRow.plan_code)}{" "}
                            <span className="text-muted-foreground font-normal">
                              · {billingSourceLabel(sourceRow.provider)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {humanise(sourceRow.status)} · {seatsSummary(sourceRow)}
                            {sourceRow.is_owner ? " · Owner" : ""}
                          </div>
                        </div>
                        {sourceRow.is_effective && (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
                            Effective
                          </Badge>
                        )}
                      </div>
                      <dl className="mt-2">
                        <Row label="Grant reason" value={sourceRow.manual_grant_reason ?? "—"} />
                        <Row label="Expires" value={fmtDateTime(sourceRow.manual_grant_expires_at)} />
                        <Row label="Revoked" value={fmtDateTime(sourceRow.manual_grant_revoked_at)} />
                        <Row label="Period ends" value={fmtDateTime(sourceRow.current_period_end)} />
                      </dl>
                      {sourceRow.provider === "manual" && !sourceRow.manual_grant_revoked_at && (
                        <div className="flex gap-2 pt-2">
                          <Button size="sm" variant="outline" onClick={() => setExtendTarget(sourceRow)}>
                            Extend
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => setRevokeTarget(sourceRow)}
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </Card>
                  ))}
                  {grantSources.length === 0 && detail.billing_sources.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      No manual grants on this account.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="licences" className="space-y-3 pt-3">
                  {detail.licences_held.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      This user holds no licences.
                    </p>
                  )}
                  {detail.licences_held.map((l: LicenceHeld) => (
                    <Card key={l.licence_id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{humanise(l.plan_code)}</div>
                          <div className="text-xs text-muted-foreground">
                            {humanise(l.status)}
                            {l.owner_email ? ` · from ${l.owner_email}` : ""}
                            {l.vineyard_name ? ` · ${l.vineyard_name}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Assigned {fmtDateTime(l.assigned_at)}
                            {l.revoked_at ? ` · Removed ${fmtDateTime(l.revoked_at)}` : ""}
                          </div>
                        </div>
                        {l.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => setRemoveTarget(l)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="vineyards" className="space-y-3 pt-3">
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1">Active</h4>
                    {detail.memberships.active.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active vineyard memberships.</p>
                    ) : (
                      detail.memberships.active.map((m: Membership) => (
                        <div key={m.vineyard_id} className="text-sm py-0.5">
                          {m.vineyard_name ?? m.vineyard_id} —{" "}
                          <span className="text-muted-foreground">{humanise(m.role)}</span>
                        </div>
                      ))
                    )}
                  </div>
                  {detail.memberships.historical.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">Past</h4>
                      {detail.memberships.historical.map((m: Membership) => (
                        <div key={`${m.vineyard_id}-${m.removed_at}`} className="text-sm py-0.5">
                          {m.vineyard_name ?? m.vineyard_id} —{" "}
                          <span className="text-muted-foreground">
                            {humanise(m.role)} · removed {fmtDateTime(m.removed_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="identity" className="pt-3">
                  <dl>
                    <Row label="Name" value={identity.full_name ?? "—"} />
                    <Row label="Email" value={identity.email ?? "—"} />
                    <Row
                      label="Email confirmed"
                      value={fmtDateTime(identity.email_confirmed_at)}
                    />
                    <Row label="Account created" value={fmtDateTime(identity.created_at)} />
                    <Row label="Last sign-in" value={fmtDateTime(identity.last_sign_in_at)} />
                    <Row
                      label="System admin"
                      value={identity.is_system_admin ? "Yes" : "No"}
                    />
                  </dl>
                </TabsContent>

                <TabsContent value="history" className="pt-3">
                  {historyQ.isLoading && <Skeleton className="h-32 w-full" />}
                  {historyQ.error && (
                    <p className="text-sm">{friendlyError(historyQ.error)}</p>
                  )}
                  {historyQ.data?.length === 0 && (
                    <p className="text-sm text-muted-foreground">No recorded access history.</p>
                  )}
                  <ol className="relative border-l pl-4 space-y-3">
                    {(historyQ.data ?? []).map((h, i) => (
                      <li key={`${h.occurred_at}-${i}`} className="text-sm">
                        <div className="font-medium">{historyEventLabel(h.event_type)}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDateTime(h.occurred_at)} · {humanise(h.source)}
                          {h.platform ? ` · ${humanise(h.platform)}` : ""}
                        </div>
                        {h.detail && (
                          <pre className="mt-1 rounded bg-muted/50 p-2 text-[11px] whitespace-pre-wrap break-words">
                            {JSON.stringify(h.detail, null, 2)}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ol>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <CreateGrantDialog
        open={createGrant}
        onOpenChange={setCreateGrant}
        userId={userId}
        userLabel={userLabel}
        vineyards={vineyardOptions}
      />
      <RefreshEntitlementDialog
        open={refreshOpen}
        onOpenChange={setRefreshOpen}
        userId={userId}
        userLabel={userLabel}
      />
      <AssignLicenceDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        userId={userId}
        userLabel={userLabel}
        pools={pools}
      />
      <ExtendGrantDialog
        open={!!extendTarget}
        onOpenChange={(o) => !o && setExtendTarget(null)}
        subscriptionId={extendTarget?.subscription_id ?? null}
        userId={userId}
        summary={
          extendTarget
            ? `${grantTypeLabel(extendTarget.plan_code)} grant for ${userLabel}`
            : ""
        }
      />
      <RevokeGrantDialog
        open={!!revokeTarget}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
        subscriptionId={revokeTarget?.subscription_id ?? null}
        userId={userId}
        summary={
          revokeTarget
            ? `${revokeTarget.plan_name ?? humanise(revokeTarget.plan_code)} grant for ${userLabel}`
            : ""
        }
      />
      <RemoveLicenceDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        licenceId={removeTarget?.licence_id ?? null}
        userId={userId}
        summary={
          removeTarget
            ? `${humanise(removeTarget.plan_code)} licence held by ${userLabel}`
            : ""
        }
        warnAccessLoss={ea?.licence_id === removeTarget?.licence_id}
      />
    </>
  );
}
