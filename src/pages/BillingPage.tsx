import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  Loader2,
  ExternalLink,
  CreditCard,
  Apple,
  Settings,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import {
  useVinetrackAccess,
  useVinetrackInvoices,
  formatVinetrackMoney,
} from "@/lib/vinetrackAccessQuery";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusVariant(status: string | null | undefined) {
  switch (status) {
    case "active":
    case "trialing":
      return "default" as const;
    case "past_due":
    case "paused":
      return "secondary" as const;
    case "canceled":
    case "expired":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

export default function BillingPage() {
  const { data, isLoading, error, refetch } = useVinetrackAccess();
  const access = data?.access ?? null;
  const schemaMissing = data?.schemaMissing ?? false;
  const subId = access?.subscription_id ?? null;
  const { data: invoices = [] } = useVinetrackInvoices(subId);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);

  const activeStatus = ["active", "trialing", "past_due"];
  const hasActiveSub =
    !!access &&
    !!access.subscription_id &&
    !!access.status &&
    activeStatus.includes(access.status);
  const isStripeTeam =
    hasActiveSub &&
    access?.billing_provider === "stripe" &&
    (access?.plan_tier === "team" || access?.access_source === "team");
  const isApple = access?.billing_provider === "apple";
  const isEnterprise =
    hasActiveSub &&
    (access?.plan_tier === "enterprise" || access?.access_source === "enterprise");
  const showTeamCta =
    !isStripeTeam &&
    !isEnterprise &&
    (!access ||
      !hasActiveSub ||
      !access.has_supabase_access ||
      access.solo_check_required ||
      isApple ||
      access.plan_tier === "solo");
  const overSeats =
    access &&
    access.seats_included != null &&
    access.active_licences != null &&
    access.active_licences > (access.seats_included ?? 0) + (access.seats_purchased ?? 0);

  async function invokeWithVinetrackAuth(name: string) {
    const { data: sess } = await iosSupabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("Not signed in to VineTrack");
    return cloudSupabase.functions.invoke(name, {
      body: {},
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async function startCheckout() {
    try {
      setBusy("checkout");
      const { data: res, error: err } = await invokeWithVinetrackAuth(
        "create-vinetrack-team-checkout"
      );
      if (err) throw err;
      if ((res as any)?.error) throw new Error((res as any).error);
      const url = (res as any)?.url;
      if (!url) throw new Error("Checkout URL not returned");
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message || "Checkout unavailable. Stripe may not be configured yet.");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    try {
      setBusy("portal");
      const { data: res, error: err } = await invokeWithVinetrackAuth(
        "create-vinetrack-billing-portal"
      );
      if (err) throw err;
      if ((res as any)?.error) throw new Error((res as any).error);
      const url = (res as any)?.url;
      if (!url) throw new Error("Portal URL not returned");
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message || "Billing portal unavailable.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Plan, licences and invoices for your VineTrack subscription.
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading billing…
        </div>
      )}

      {error && !schemaMissing && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not load billing</AlertTitle>
          <AlertDescription>
            {(error as any)?.message ?? "Unexpected error."}{" "}
            <Button variant="link" className="px-1" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {schemaMissing && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Billing schema not yet deployed</AlertTitle>
          <AlertDescription>
            The VineTrack billing tables and the{" "}
            <code>get_my_vinetrack_access()</code> RPC have not been applied to
            the VineTrack Supabase project yet. This page will populate once
            Rork's draft billing migration is live. No action required.
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !schemaMissing && showTeamCta && (
        <Card className="p-6">
          <div className="space-y-3">
            <h2 className="text-lg font-medium">
              {isApple || access?.plan_tier === "solo"
                ? "Upgrade to Team"
                : "No active Team subscription"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Team includes 3 user licences, full portal access, and iPhone app
              access for licensed users.
            </p>
            <div className="pt-1">
              <Button onClick={startCheckout} disabled={busy === "checkout"}>
                {busy === "checkout" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                Start Team plan
              </Button>
            </div>
          </div>
        </Card>
      )}

      {access && (
        <>
          {/* Plan summary */}
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium">
                    {access.plan_name ?? access.plan_code ?? "Unknown plan"}
                  </h2>
                  <Badge variant={statusVariant(access.status)}>
                    {access.status ?? "—"}
                  </Badge>
                  {access.plan_tier && (
                    <Badge variant="outline" className="capitalize">
                      {access.plan_tier}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Billing provider:{" "}
                  <span className="font-medium capitalize">
                    {access.billing_provider ?? "—"}
                  </span>{" "}
                  · Portal access:{" "}
                  <span className="font-medium capitalize">
                    {access.portal_access_level ?? "none"}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isStripeTeam && (
                  <Button
                    variant="outline"
                    onClick={openPortal}
                    disabled={busy === "portal"}
                  >
                    {busy === "portal" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Settings className="mr-2 h-4 w-4" />
                    )}
                    Manage billing
                  </Button>
                )}
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Trial ends</dt>
                <dd className="font-medium">{formatDate(access.trial_end)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Renews</dt>
                <dd className="font-medium">
                  {formatDate(access.current_period_end)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Can use portal</dt>
                <dd className="font-medium">
                  {access.can_use_portal ? "Yes" : "No"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Can use iOS app</dt>
                <dd className="font-medium">
                  {access.can_use_ios_app ? "Yes" : "No"}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Licences */}
          <Card className="p-6">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-base font-medium">Licences</h3>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Included</dt>
                <dd className="font-medium">{access.seats_included ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Additional purchased</dt>
                <dd className="font-medium">{access.seats_purchased ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Active licences</dt>
                <dd className="font-medium">{access.active_licences ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Total available</dt>
                <dd className="font-medium">
                  {(access.seats_included ?? 0) + (access.seats_purchased ?? 0)}
                </dd>
              </div>
            </dl>
            {overSeats && (
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Over seat limit</AlertTitle>
                <AlertDescription>
                  Active licences exceed your included + purchased seats. Add
                  more seats from <em>Manage billing</em> to stay compliant.
                </AlertDescription>
              </Alert>
            )}
            {isStripeTeam && (
              <p className="mt-3 text-xs text-muted-foreground">
                Additional licences are billed at the per-user price configured
                on your plan.
              </p>
            )}
          </Card>

          {/* Provider-specific notes */}
          {isApple && (
            <Alert>
              <Apple className="h-4 w-4" />
              <AlertTitle>Managed through Apple</AlertTitle>
              <AlertDescription>
                Your Solo subscription is managed through Apple. To change or
                cancel, use{" "}
                <strong>Settings → [Your Name] → Subscriptions</strong> on your
                iPhone. Invoices are not shown here for Apple-managed plans.
              </AlertDescription>
            </Alert>
          )}

          {isEnterprise && (
            <Alert>
              <AlertTitle>Enterprise plan</AlertTitle>
              <AlertDescription>
                Enterprise billing is handled manually. Contact our team for
                changes to your plan.
              </AlertDescription>
            </Alert>
          )}

          {access.solo_check_required && (
            <Alert>
              <AlertTitle>Solo verification required</AlertTitle>
              <AlertDescription>
                No Supabase-side access was found. The iOS app will fall back to
                verifying your Solo subscription with Apple/RevenueCat.
              </AlertDescription>
            </Alert>
          )}

          {/* Invoices (Stripe/manual only) */}
          {!isApple && (
            <Card className="p-6">
              <h3 className="text-base font-medium">Invoices</h3>
              {invoices.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No invoices yet.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-4">Number</th>
                        <th className="py-2 pr-4">Issued</th>
                        <th className="py-2 pr-4">Period</th>
                        <th className="py-2 pr-4">Total</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="border-t border-border/60">
                          <td className="py-2 pr-4 font-mono text-xs">
                            {inv.invoice_number ?? inv.id.slice(0, 8)}
                          </td>
                          <td className="py-2 pr-4">
                            {formatDate(inv.issued_at)}
                          </td>
                          <td className="py-2 pr-4">
                            {formatDate(inv.period_start)} –{" "}
                            {formatDate(inv.period_end)}
                          </td>
                          <td className="py-2 pr-4">
                            {formatVinetrackMoney(inv.total_cents, inv.currency)}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge variant={statusVariant(inv.status)}>
                              {inv.status ?? "—"}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4">
                            {inv.hosted_invoice_url && (
                              <a
                                href={inv.hosted_invoice_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                View <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
