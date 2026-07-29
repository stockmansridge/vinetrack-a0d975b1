// Phase 2E — customer-facing Billing page for active Vineyard Owners.
// All authority, money and seat values come from the SQL 152/153 RPCs.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CreditCard, ExternalLink, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalNotice } from "@/components/ui/PortalNotice";
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
  BILLING_KEYS,
  INVOICE_STATUS_LABEL,
  billingErrorMessage,
  formatBillingDate,
  formatBillingPeriod,
  formatMinorUnits,
  useBillingHistory,
  useBillingLicences,
  useBillingSummary,
  useBillingVineyards,
  useInvoiceLink,
  useStripePortalSession,
  type BillingSummary,
} from "@/lib/customerBillingQuery";

const PAGE_SIZE = 10;
const SESSION_KEY = "vinetrack.account.billing.vineyard";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{value ?? "—"}</div>
    </div>
  );
}

function titleise(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function platformLabel(summary: BillingSummary): string {
  switch (summary.purchase_platform) {
    case "ios":
      return "Apple App Store";
    case "android":
      return "Google Play";
    case "web":
      return "VineTrack Portal";
    default:
      return "—";
  }
}

function availablePlatforms(summary: BillingSummary): string {
  const list: string[] = [];
  if (summary.portal_access) list.push("Portal");
  if (summary.can_use_ios_app) list.push("iOS");
  if (summary.can_use_android_app) list.push("Android");
  return list.length ? list.join(", ") : "No platforms";
}

function invoiceStatusBadge(status: string | null) {
  const label = status ? (INVOICE_STATUS_LABEL[status] ?? titleise(status)) : "—";
  const variant =
    status === "paid"
      ? "default"
      : status === "payment_failed" || status === "uncollectible"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant as never}>{label}</Badge>;
}

export default function AccountBillingPage() {
  const qc = useQueryClient();
  const vineyardsQuery = useBillingVineyards();
  const vineyards = vineyardsQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pendingInvoice, setPendingInvoice] = useState<string | null>(null);

  // Auto-select, validated against the server list every time.
  useEffect(() => {
    if (!vineyardsQuery.isSuccess) return;
    const remembered = sessionStorage.getItem(SESSION_KEY);
    const valid = (id: string | null) => !!id && vineyards.some((v) => v.vineyard_id === id);
    if (valid(selectedId)) return;
    const next = valid(remembered) ? remembered! : (vineyards[0]?.vineyard_id ?? null);
    setSelectedId(next);
    setPage(0);
  }, [vineyardsQuery.isSuccess, vineyards, selectedId]);

  useEffect(() => {
    if (selectedId) sessionStorage.setItem(SESSION_KEY, selectedId);
  }, [selectedId]);

  const summaryQuery = useBillingSummary(selectedId);
  const summary = summaryQuery.data ?? null;

  const canViewInvoices = !!summary?.can_view_invoices && summary.receipt_managed_by === "stripe";
  const canManageBilling = !!summary?.can_manage_billing && summary.receipt_managed_by === "stripe";

  const historyQuery = useBillingHistory(
    selectedId,
    PAGE_SIZE,
    page * PAGE_SIZE,
    canViewInvoices,
  );
  const licencesQuery = useBillingLicences(selectedId, !!summary?.can_view_invoices);

  const portal = useStripePortalSession();
  const invoiceLink = useInvoiceLink();

  // Returning from the Stripe Customer Portal → refetch everything.
  useEffect(() => {
    const onFocus = () => {
      if (!selectedId) return;
      qc.invalidateQueries({ queryKey: BILLING_KEYS.root });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc, selectedId]);

  const totalCount = historyQuery.data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handleManageBilling = async () => {
    if (!selectedId) return;
    try {
      const url = await portal.mutateAsync(selectedId);
      window.location.assign(url);
    } catch (e) {
      toast.error(billingErrorMessage(e));
    }
  };

  const handleInvoice = async (invoiceId: string, action: "view" | "download") => {
    if (!selectedId) return;
    setPendingInvoice(`${invoiceId}:${action}`);
    try {
      const url = await invoiceLink.mutateAsync({
        vineyardId: selectedId,
        invoiceId,
        action,
      });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(billingErrorMessage(e));
    } finally {
      setPendingInvoice(null);
    }
  };

  const seatText = useMemo(() => {
    if (!summary) return null;
    if (summary.is_unlimited) return "Unlimited licences";
    if (summary.licence_limit === null || summary.assigned_licences === null) return null;
    return `${summary.assigned_licences} of ${summary.licence_limit} licences assigned`;
  }, [summary]);

  // ---- Guard: hold rendering until ownership is confirmed -------------------
  if (vineyardsQuery.isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  }

  if (vineyardsQuery.isError) {
    return (
      <div className="p-6">
        <PortalNotice
          variant="error"
          title="Billing unavailable"
          description={billingErrorMessage(vineyardsQuery.error)}
        />
      </div>
    );
  }

  if (vineyards.length === 0) {
    return (
      <div className="p-6">
        <PortalNotice
          variant="warning"
          title="Billing is not available for your account"
          description="Only a Vineyard Owner can access billing for a vineyard."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            View and manage billing for vineyards where you are an Owner.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: BILLING_KEYS.root })}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </header>

      {vineyards.length > 1 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <span className="text-sm font-medium">Billing vineyard</span>
            <Select
              value={selectedId ?? undefined}
              onValueChange={(v) => {
                setSelectedId(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder="Select a vineyard" />
              </SelectTrigger>
              <SelectContent>
                {vineyards.map((v) => (
                  <SelectItem key={v.vineyard_id} value={v.vineyard_id}>
                    {v.vineyard_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {summaryQuery.isLoading || !summary ? (
        <Card>
          <CardContent className="py-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading billing information…
            </div>
          </CardContent>
        </Card>
      ) : summaryQuery.isError ? (
        <PortalNotice
          variant="error"
          title="Billing unavailable"
          description={billingErrorMessage(summaryQuery.error)}
        />
      ) : (
        <>
          {summary.billing_authority_code === "billing_managed_by_another_owner" && (
            <PortalNotice
              variant="info"
              title="Managed by another Owner"
              description="Billing for this vineyard is managed by another authorised Vineyard Owner."
            />
          )}
          {summary.billing_authority_code === "no_billing_relationship" && (
            <PortalNotice
              variant="info"
              title="No billing account"
              description="No billing account is associated with this vineyard."
            />
          )}
          {summary.receipt_managed_by === "apple" && (
            <PortalNotice
              variant="info"
              title="Purchased through the Apple App Store"
              description="This VineTrack subscription was purchased through the Apple App Store. Receipts and subscription management are provided by Apple."
            />
          )}
          {summary.receipt_managed_by === "google" && (
            <PortalNotice
              variant="info"
              title="Purchased through Google Play"
              description="This VineTrack subscription was purchased through Google Play. Receipts and subscription management are provided by Google Play."
            />
          )}
          {summary.access_source === "trial" && (
            <PortalNotice
              variant="info"
              title="Account trial"
              description={`This vineyard currently has access through a VineTrack account trial. No invoice is available.${
                summary.expires_at ? ` Trial ends ${formatBillingDate(summary.expires_at)}.` : ""
              }`}
            />
          )}
          {summary.provider === "manual" && (
            <PortalNotice
              variant="info"
              title="VineTrack grant"
              description="This vineyard's access is provided through a VineTrack grant. No invoice is available."
            />
          )}
          {summary.receipt_managed_by === "stripe" && !summary.has_stripe_customer && (
            <PortalNotice
              variant="info"
              title="No Stripe billing account"
              description="No Stripe billing account is associated with this vineyard."
            />
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current plan and access</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Vineyard" value={summary.vineyard_name} />
              <Field label="Plan" value={summary.effective_plan ?? summary.plan_code ?? "—"} />
              <Field label="Access status" value={summary.portal_access ? "Active" : "No access"} />
              <Field label="Access source" value={titleise(summary.access_source)} />
              <Field label="Purchase platform" value={platformLabel(summary)} />
              <Field label="Available platforms" value={availablePlatforms(summary)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Billing status and renewal</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Subscription status" value={titleise(summary.subscription_status)} />
              <Field
                label="Current billing period"
                value={formatBillingPeriod(
                  summary.current_period_start,
                  summary.current_period_end,
                )}
              />
              <Field
                label={summary.cancel_at_period_end ? "Access ends" : "Renews on"}
                value={formatBillingDate(summary.current_period_end ?? summary.expires_at)}
              />
              <Field
                label="Cancels at period end"
                value={summary.cancel_at_period_end ? "Yes" : "No"}
              />
              <Field
                label="Billing management"
                value={
                  canManageBilling
                    ? "You manage billing for this vineyard"
                    : summary.billing_authority_code === "billing_managed_by_another_owner"
                      ? "Managed by another Owner"
                      : "Not available"
                }
              />
              <Field
                label="Invoices"
                value={summary.has_invoice_history && canViewInvoices ? "Available" : "None"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Seat usage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {seatText ? (
                <>
                  <p className="text-sm font-medium">{seatText}</p>
                  {!summary.is_unlimited && summary.available_licences !== null && (
                    <p className="text-sm text-muted-foreground">
                      {summary.available_licences} licences available
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Seat information is not available for this vineyard.
                </p>
              )}

              {licencesQuery.data && licencesQuery.data.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Vineyard</TableHead>
                        <TableHead>Assigned</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {licencesQuery.data.map((l) => (
                        <TableRow key={l.licence_id}>
                          <TableCell>{l.user_display_name ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {l.user_email ?? "—"}
                          </TableCell>
                          <TableCell>{l.vineyard_name ?? "—"}</TableCell>
                          <TableCell>{formatBillingDate(l.assigned_at)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{titleise(l.status)}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {canManageBilling && summary.has_stripe_customer && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="text-sm font-medium">Manage your subscription</p>
                  <p className="text-sm text-muted-foreground">
                    Update your payment method, billing details or cancel in the secure
                    Stripe Customer Portal.
                  </p>
                </div>
                <Button onClick={handleManageBilling} disabled={portal.isPending}>
                  {portal.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="mr-2 h-4 w-4" />
                  )}
                  Manage billing
                </Button>
              </CardContent>
            </Card>
          )}

          {canViewInvoices && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Invoice history</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {historyQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading invoices…
                  </div>
                ) : historyQuery.isError ? (
                  <PortalNotice
                    variant="error"
                    compact
                    description={billingErrorMessage(historyQuery.error)}
                  />
                ) : (historyQuery.data?.rows.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices yet.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Subtotal</TableHead>
                            <TableHead className="text-right">Tax</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Paid</TableHead>
                            <TableHead className="text-right">Due</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {historyQuery.data!.rows.map((row) => (
                            <TableRow key={row.record_id}>
                              <TableCell className="whitespace-nowrap">
                                {formatBillingDate(row.created_at)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {row.invoice_number ?? row.redacted_reference ?? "—"}
                              </TableCell>
                              <TableCell>{row.description ?? row.plan_code ?? "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatBillingPeriod(row.period_start, row.period_end)}
                              </TableCell>
                              <TableCell>{invoiceStatusBadge(row.invoice_status)}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {formatMinorUnits(row.subtotal, row.currency)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {formatMinorUnits(row.tax, row.currency)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap font-medium">
                                {formatMinorUnits(row.total, row.currency)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {formatMinorUnits(row.amount_paid, row.currency)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {formatMinorUnits(row.amount_due, row.currency)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                <div className="flex justify-end gap-1">
                                  {row.can_view_invoice && row.invoice_id && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={pendingInvoice === `${row.invoice_id}:view`}
                                      onClick={() => handleInvoice(row.invoice_id!, "view")}
                                    >
                                      {pendingInvoice === `${row.invoice_id}:view` ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <ExternalLink className="h-4 w-4" />
                                      )}
                                      <span className="sr-only">View invoice</span>
                                    </Button>
                                  )}
                                  {row.can_download_invoice && row.invoice_id && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={pendingInvoice === `${row.invoice_id}:download`}
                                      onClick={() => handleInvoice(row.invoice_id!, "download")}
                                    >
                                      {pendingInvoice === `${row.invoice_id}:download` ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Download className="h-4 w-4" />
                                      )}
                                      <span className="sr-only">Download invoice</span>
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>
                        Page {page + 1} of {pageCount} · {totalCount} invoices
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page === 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page + 1 >= pageCount}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              Need help with an invoice or your subscription? Use{" "}
              <span className="font-medium text-foreground">Contact support</span> in the
              sidebar and our team will get back to you.
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
