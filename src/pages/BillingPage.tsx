import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Loader2,
  ExternalLink,
  CreditCard,
  Apple,
  Settings,
  Users,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase as cloudSupabase } from "@/integrations/supabase/client";
import { iosSupabase } from "@/integrations/ios-supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import {
  useVinetrackAccess,
  useVinetrackInvoices,
  formatVinetrackMoney,
} from "@/lib/vinetrackAccessQuery";
import { useVinetrackLicences } from "@/lib/vinetrackLicencesQuery";

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
    case "paid":
      return "default" as const;
    case "pending":
    case "past_due":
    case "paused":
      return "secondary" as const;
    case "canceled":
    case "expired":
    case "revoked":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

async function invokeWithVinetrackAuth(name: string, body: Record<string, unknown> = {}) {
  const { data: sess } = await iosSupabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in to VineTrack");
  return cloudSupabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
}

interface TeamLicencesResponse {
  subscription: {
    id: string;
    owner_user_id: string;
    status: string;
    stripe_subscription_id: string | null;
    primary_vineyard_id: string | null;
    seats_included: number | null;
    seats_purchased: number | null;
  } | null;
  licences: Array<{
    id: string;
    subscription_id: string | null;
    user_id: string | null;
    invited_email: string | null;
    vineyard_id: string | null;
    status: string | null;
    assigned_by: string | null;
    created_at: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  invoices: Array<{
    id: string;
    invoice_number: string | null;
    status: string | null;
    currency: string | null;
    total_cents: number | null;
    amount_paid_cents: number | null;
    period_start: string | null;
    period_end: string | null;
    issued_at: string | null;
    paid_at: string | null;
    hosted_invoice_url: string | null;
    invoice_pdf_url: string | null;
  }>;
  debug?: Record<string, unknown>;
  error?: string;
}

export default function BillingPage() {
  const { user } = useAuth();
  const { selectedVineyardId, memberships } = useVineyard();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useVinetrackAccess();
  const access = data?.access ?? null;
  const schemaMissing = data?.schemaMissing ?? false;
  const subId = access?.subscription_id ?? null;
  const { data: directInvoices = [] } = useVinetrackInvoices(subId);
  const { data: directLicences = [], refetch: refetchLicences } = useVinetrackLicences(subId);

  // Service-role fallback that bypasses browser-side RLS and repairs the
  // owner licence if missing. Authoritative for the licences/invoices view.
  const [teamData, setTeamData] = useState<TeamLicencesResponse | null>(null);
  const [teamFetchError, setTeamFetchError] = useState<string | null>(null);
  const teamFetchInFlight = useRef(false);
  const fetchTeam = useCallback(async (): Promise<TeamLicencesResponse | null> => {
    if (teamFetchInFlight.current) return teamData;
    teamFetchInFlight.current = true;
    try {
      const { data: res, error: err } = await invokeWithVinetrackAuth(
        "get-vinetrack-team-licences",
      );
      if (err) {
        setTeamFetchError(err.message ?? String(err));
        return null;
      }
      const r = res as TeamLicencesResponse;
      setTeamData(r);
      setTeamFetchError(r?.error ?? null);
      return r;
    } catch (e: any) {
      setTeamFetchError(e?.message ?? String(e));
      return null;
    } finally {
      teamFetchInFlight.current = false;
    }
  }, []);
  useEffect(() => {
    if (subId) fetchTeam();
  }, [subId, fetchTeam]);

  // Prefer service-role responses when they have content; fall back to
  // direct RLS queries (which can be empty for owners with strict RLS).
  const licences =
    teamData && teamData.licences.length > 0 ? teamData.licences : directLicences;
  const invoices =
    teamData && teamData.invoices.length > 0 ? teamData.invoices : directInvoices;

  const [busy, setBusy] = useState<"checkout" | "portal" | "seats" | "addUser" | "revoke" | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [seatsOpen, setSeatsOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [extraSeats, setExtraSeats] = useState(0);
  const [seatsMessage, setSeatsMessage] = useState<string | null>(null);

  // After Stripe redirects back with ?checkout=success, poll for the webhook
  // to land the subscription/invoice rows. We refetch a few times then stop.
  const pollStartedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success" || pollStartedRef.current) return;
    pollStartedRef.current = true;
    toast.success("Payment received. Finalising your subscription…");
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // ~40s
    const tick = async () => {
      attempts += 1;
      const { data: refreshed } = await refetch();
      const acc = refreshed?.access ?? null;
      const sid = acc?.subscription_id ?? null;

      let ownerLicenceCount = 0;
      let invoiceCount = 0;
      if (sid) {
        await qc.invalidateQueries({ queryKey: ["vinetrack", "licences", sid] });
        await qc.invalidateQueries({ queryKey: ["vinetrack", "invoices", sid] });
        await refetchLicences();
        const team = await fetchTeam();
        ownerLicenceCount = (team?.licences ?? []).filter(
          (l) => l.user_id === acc?.user_id && l.status === "active",
        ).length;
        invoiceCount = (team?.invoices ?? []).length;
      }

      const subActive =
        !!acc && !!acc.status && ["active", "trialing", "past_due"].includes(acc.status);
      const ready = subActive && ownerLicenceCount >= 1;

      if (ready || attempts >= MAX_ATTEMPTS) {
        if (sid) {
          await qc.invalidateQueries({ queryKey: ["vinetrack", "invoices", sid] });
        }
        const url = new URL(window.location.href);
        url.searchParams.delete("checkout");
        window.history.replaceState({}, "", url.toString());
        if (ready) {
          toast.success(
            invoiceCount > 0
              ? "Subscription is active and invoice is linked."
              : "Subscription is active.",
          );
        } else {
          toast.message("Still finalising — refresh in a moment if needed.");
        }
        return;
      }
      setTimeout(tick, 2000);
    };
    tick();
  }, [refetch, refetchLicences, qc, fetchTeam]);

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

  const selectedVineyardName = useMemo(
    () => memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null,
    [memberships, selectedVineyardId],
  );

  const seatsIncluded = access?.seats_included ?? 0;
  const seatsPurchased = access?.seats_purchased ?? 0;
  const totalSeats = seatsIncluded + seatsPurchased;
  const activeLicenceCount = licences.filter((l) => l.status === "active").length;
  const pendingLicenceCount = licences.filter((l) => l.status === "pending").length;
  const consumed = activeLicenceCount + pendingLicenceCount;
  const remaining = Math.max(0, totalSeats - consumed);
  const overSeats = consumed > totalSeats;

  async function startCheckout() {
    if (!selectedVineyardId) {
      toast.error("Please select a vineyard before starting Team checkout.");
      return;
    }
    try {
      setBusy("checkout");
      const { data: res, error: err } = await invokeWithVinetrackAuth(
        "create-vinetrack-team-checkout",
        { primary_vineyard_id: selectedVineyardId },
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
        "create-vinetrack-billing-portal",
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

  async function addUserLicence() {
    if (!newEmail.trim()) {
      toast.error("Enter an email address.");
      return;
    }
    try {
      setBusy("addUser");
      const { data: res, error: err } = await invokeWithVinetrackAuth(
        "create-vinetrack-user-licence",
        { email: newEmail.trim(), vineyard_id: selectedVineyardId },
      );
      if (err) throw err;
      if ((res as any)?.error) throw new Error((res as any).error);
      const licence = (res as any)?.licence;
      const returnedSubId = (res as any)?.subscription_id ?? null;
      const emailAdded = newEmail.trim();
      const status = licence?.status ?? "active";
      const friendly =
        status === "pending"
          ? `Licence added for ${emailAdded} — pending invite.`
          : `Licence added for ${emailAdded} and active.`;
      toast.success(friendly);
      if (returnedSubId && subId && returnedSubId !== subId) {
        toast.error(
          `BUG: licence created under subscription ${returnedSubId} but billing page is showing ${subId}.`,
        );
      }
      setNewEmail("");
      setAddOpen(false);
      if (returnedSubId) {
        await qc.invalidateQueries({ queryKey: ["vinetrack", "licences", returnedSubId] });
      }
      await refetchLicences();
      await fetchTeam();
      await qc.invalidateQueries({ queryKey: ["vinetrack", "access"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not create licence.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeLicence(licenceId: string) {
    if (!confirm("Revoke this licence? The user will lose access at the end of the period.")) return;
    try {
      setBusy("revoke");
      const { error: err } = await (iosSupabase as any)
        .from("vinetrack_user_licences")
        .update({ status: "revoked" })
        .eq("id", licenceId);
      if (err) throw err;
      toast.success("Licence revoked.");
      await refetchLicences();
      await fetchTeam();
    } catch (e: any) {
      toast.error(e?.message || "Could not revoke licence.");
    } finally {
      setBusy(null);
    }
  }

  async function updateExtraSeats() {
    const target = Math.max(0, Math.floor(extraSeats));
    if (target === seatsPurchased) {
      setSeatsMessage("No change to extra seats.");
      return;
    }
    try {
      setBusy("seats");
      setSeatsMessage(null);
      const { data: res, error: err } = await invokeWithVinetrackAuth(
        "update-vinetrack-team-seats",
        { extra_seats: target },
      );
      if (err) throw err;
      if ((res as any)?.error) throw new Error((res as any).error);
      setSeatsMessage("Extra seats updated in Stripe. Waiting for billing sync…");
      toast.success("Extra seats updated in Stripe. Waiting for billing sync…");
      // Poll access for up to ~45s for seats_purchased to change.
      const startedAt = Date.now();
      const poll = async () => {
        const { data: refreshed } = await refetch();
        const newPurchased = refreshed?.access?.seats_purchased ?? null;
        if (newPurchased === target) {
          setSeatsMessage(`Billing synced: ${target} extra seat(s) active.`);
          await fetchTeam();
          return;
        }
        if (Date.now() - startedAt > 45_000) {
          setSeatsMessage(
            "Stripe updated, but billing sync is still pending. Refresh in a moment.",
          );
          return;
        }
        setTimeout(poll, 3_000);
      };
      setTimeout(poll, 2_000);
    } catch (e: any) {
      const msg = e?.message || "Could not update seats.";
      setSeatsMessage(`Error: ${msg}`);
      toast.error(msg);
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
        <p className="text-xs text-muted-foreground font-mono">
          [debug] Selected vineyard:{" "}
          {selectedVineyardId
            ? `${selectedVineyardName ?? "(unnamed)"} / ${selectedVineyardId}`
            : "(none)"}
        </p>
      </header>

      {/* Temporary debug block — remove once Billing data is confirmed stable. */}
      <Card className="border-dashed bg-muted/30 p-4 text-xs font-mono space-y-1">
        <div className="font-semibold not-italic">[debug] Billing data sources</div>
        <div>access.subscription_id: {access?.subscription_id ?? "(null)"}</div>
        <div>access.user_id: {access?.user_id ?? "(null)"}</div>
        <div>access.current_period_end: {access?.current_period_end ?? "(null)"}</div>
        <div>access.seats_purchased: {access?.seats_purchased ?? "(null)"}</div>
        <div>direct licences query subId: {subId ?? "(null)"}</div>
        <div>direct licences row count: {directLicences.length}</div>
        <div>direct invoices query subId: {subId ?? "(null)"}</div>
        <div>direct invoices row count: {directInvoices.length}</div>
        <div>
          edge get-vinetrack-team-licences subscription.id:{" "}
          {teamData?.subscription?.id ?? "(none)"}
        </div>
        <div>edge licences row count: {teamData?.licences.length ?? 0}</div>
        <div>edge invoices row count: {teamData?.invoices.length ?? 0}</div>
        <div>edge error: {teamFetchError ?? "(none)"}</div>
        <div>edge debug: {teamData?.debug ? JSON.stringify(teamData.debug) : "(none)"}</div>
      </Card>

      {!selectedVineyardId && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Select a vineyard before starting Team checkout</AlertTitle>
          <AlertDescription>
            Choose a vineyard from the dropdown at the top of the page. The
            selected vineyard becomes the primary vineyard for this
            subscription.
          </AlertDescription>
        </Alert>
      )}

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
            {!selectedVineyardId ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Select a vineyard first</AlertTitle>
                <AlertDescription>
                  Choose a vineyard from the sidebar (or create one) before
                  starting Team checkout. The selected vineyard becomes the
                  primary vineyard for this subscription.
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-xs text-muted-foreground">
                Primary vineyard:{" "}
                <span className="font-medium">{selectedVineyardName ?? selectedVineyardId}</span>
              </p>
            )}
            <div className="pt-1">
              <Button
                onClick={startCheckout}
                disabled={busy === "checkout" || !selectedVineyardId}
              >
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

          {/* Team licences */}
          {isStripeTeam && (
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-base font-medium">Team licences</h3>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setExtraSeats(seatsPurchased);
                      setSeatsOpen(true);
                    }}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Manage extra seats
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setAddOpen(true)}
                    disabled={remaining <= 0}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add user
                  </Button>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
                <div>
                  <dt className="text-muted-foreground">Included</dt>
                  <dd className="font-medium">{seatsIncluded}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Extra paid</dt>
                  <dd className="font-medium">{seatsPurchased}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Active</dt>
                  <dd className="font-medium">{activeLicenceCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pending</dt>
                  <dd className="font-medium">{pendingLicenceCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Available</dt>
                  <dd className="font-medium">{remaining}</dd>
                </div>
              </dl>

              {overSeats && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Over seat limit</AlertTitle>
                  <AlertDescription>
                    Licences exceed your included + purchased seats. Add more
                    seats or revoke users.
                  </AlertDescription>
                </Alert>
              )}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4">User / email</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Assigned</th>
                      <th className="py-2 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {licences.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-muted-foreground">
                          No licences yet.
                        </td>
                      </tr>
                    ) : (
                      licences.map((l, idx) => {
                        const isOwner = l.user_id && l.user_id === user?.id;
                        const licenceType =
                          idx < seatsIncluded ? "included" : "extra paid";
                        return (
                          <tr key={l.id} className="border-t border-border/60">
                            <td className="py-2 pr-4">
                              {l.invited_email ?? l.user_id ?? "—"}
                              {isOwner && (
                                <Badge variant="outline" className="ml-2">
                                  owner
                                </Badge>
                              )}
                            </td>
                            <td className="py-2 pr-4">
                              <Badge variant={statusVariant(l.status)}>
                                {l.status ?? "—"}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4 capitalize">{licenceType}</td>
                            <td className="py-2 pr-4">
                              {formatDate(l.created_at)}
                            </td>
                            <td className="py-2 pr-4">
                              {!isOwner && l.status !== "revoked" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => revokeLicence(l.id)}
                                  disabled={busy === "revoke"}
                                >
                                  <Trash2 className="mr-1 h-3 w-3" />
                                  Revoke
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Extra licences are billed at $99/year ex GST per user via Stripe.
              </p>
            </Card>
          )}

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

      {/* Add user dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user licence</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              If the user already has a VineTrack account, the licence is
              created as <strong>active</strong>. Otherwise it is created as{" "}
              <strong>pending</strong> until they sign up.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addUserLicence} disabled={busy === "addUser"}>
              {busy === "addUser" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage extra seats dialog */}
      <Dialog
        open={seatsOpen}
        onOpenChange={(open) => {
          setSeatsOpen(open);
          if (!open) setSeatsMessage(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchased extra user licences</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your plan includes <strong>{seatsIncluded}</strong> user licences.
              Extra paid licences are billed at $99/year ex GST per seat and
              prorated by Stripe. You currently have{" "}
              <strong>{seatsPurchased}</strong> extra paid seat(s).
            </p>
            <div className="space-y-1">
              <Label htmlFor="extra-seats">Purchased extra user licences</Label>
              <Input
                id="extra-seats"
                type="number"
                min={0}
                value={extraSeats}
                onChange={(e) => setExtraSeats(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Total user licences after change:{" "}
                <strong>{seatsIncluded + Math.max(0, Math.floor(extraSeats))}</strong>
              </p>
            </div>
            {seatsMessage && (
              <Alert>
                <AlertDescription>{seatsMessage}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSeatsOpen(false)}>
              Close
            </Button>
            <Button onClick={updateExtraSeats} disabled={busy === "seats"}>
              {busy === "seats" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update seats
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
