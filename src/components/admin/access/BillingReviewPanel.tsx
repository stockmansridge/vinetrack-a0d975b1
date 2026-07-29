// Billing Review panel — SQL 148 (docs/billing-review-resolution-lovable-contract.md).
//
// Every read and every mutation goes through the System-Admin-gated RPCs in
// accessEntitlementsQuery. Nothing here deletes: resolved and dismissed items
// stay queryable under their own status filters. Raw provider payloads,
// receipts, purchase tokens and webhook secrets are never fetched or shown.
import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Info,
  Link2,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  REVIEW_ITEM_TYPES,
  REVIEW_ITEM_TYPE_LABEL,
  allowedReviewActions,
  billingSourceLabel,
  fmtDateTime,
  purchasePlatformLabel,
  reviewActionError,
  useAccessUsers,
  useReviewItemAction,
  useReviewItems,
  type ReviewAction,
  type ReviewItem,
  type ReviewItemType,
  type ReviewStatusFilter,
} from "@/lib/accessEntitlementsQuery";

const PAGE_SIZE = 25;

function humanise(v: string | null | undefined, fallback = "—") {
  if (!v) return fallback;
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Alerts have no dismissed state and report acknowledgement as `resolved`. */
function statusLabel(itemType: ReviewItemType, status: string) {
  if (status === "resolved") return itemType === "alert" ? "Acknowledged" : "Resolved";
  if (status === "dismissed") return "Dismissed";
  return "Open";
}

function StatusBadge({ item }: { item: ReviewItem }) {
  const label = statusLabel(item.item_type, item.status);
  const cls =
    item.status === "open"
      ? "border-amber-500/50 text-amber-600"
      : item.status === "dismissed"
        ? "border-border text-muted-foreground"
        : "border-emerald-500/40 text-emerald-600";
  return (
    <Badge variant="outline" className={cls}>
      {label}
    </Badge>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  const map =
    s === "critical" || s === "error"
      ? { cls: "border-destructive/50 text-destructive", Icon: XCircle, label: "Critical" }
      : s === "warning" || s === "warn"
        ? { cls: "border-amber-500/50 text-amber-600", Icon: AlertTriangle, label: "Warning" }
        : { cls: "border-border text-muted-foreground", Icon: Info, label: humanise(severity) };
  const Icon = map.Icon;
  return (
    <Badge variant="outline" className={`gap-1 ${map.cls}`}>
      <Icon className="h-3 w-3" /> {map.label}
    </Badge>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <dt className="w-44 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-words">{value ?? "—"}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Link-user account picker                                            */
/* ------------------------------------------------------------------ */

function AccountPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (u: { id: string; name: string; email: string; vineyards: string }) => void;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const q = useAccessUsers({
    search,
    limit: 8,
    offset: 0,
    vineyardId: null,
    role: null,
    planCode: null,
    billingSource: null,
    hasAccess: null,
  });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search VineTrack users by name or email…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      {q.isLoading && <Skeleton className="h-20 w-full" />}
      {!q.isLoading && (q.data?.rows.length ?? 0) === 0 && (
        <p className="text-xs text-muted-foreground">
          {search
            ? "No VineTrack accounts match that search."
            : "Search for the account this billing record belongs to."}
        </p>
      )}
      <div className="space-y-1 max-h-56 overflow-y-auto">
        {(q.data?.rows ?? []).map((u) => {
          const vineyards = u.vineyards.map((v) => `${v.name} (${humanise(v.role)})`).join(", ");
          const active = selectedId === u.user_id;
          return (
            <button
              key={u.user_id}
              type="button"
              onClick={() =>
                onSelect({
                  id: u.user_id,
                  name: u.full_name ?? u.email ?? u.user_id,
                  email: u.email ?? "—",
                  vineyards,
                })
              }
              className={`w-full text-left rounded-md border p-2 transition-colors ${
                active
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{u.full_name ?? u.email ?? "—"}</span>
                {active && <Check className="h-4 w-4 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground">{u.email ?? "—"}</div>
              <div className="text-[11px] text-muted-foreground font-mono break-all">
                {u.user_id}
              </div>
              {vineyards && (
                <div className="text-[11px] text-muted-foreground">{vineyards}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Action dialog — mandatory reason on every action                    */
/* ------------------------------------------------------------------ */

const ACTION_COPY: Record<
  ReviewAction,
  { title: string; body: string; confirm: string; destructive?: boolean }
> = {
  acknowledge: {
    title: "Acknowledge this billing alert?",
    body: "The alert leaves the open count and stays in history with your name and the time of acknowledgement.",
    confirm: "Acknowledge alert",
  },
  resolve: {
    title: "Resolve this billing review item?",
    body: "Resolve this billing review item? It will leave the active review queue but remain in the audit history.",
    confirm: "Resolve item",
  },
  dismiss: {
    title: "Dismiss this item from the active review queue?",
    body: "Dismiss this item from the active review queue? The underlying billing event and audit history will be retained.",
    confirm: "Dismiss item",
  },
  retry: {
    title: "Retry this billing delivery?",
    body: "Retry processing this billing event. VineTrack will re-run the idempotent billing pipeline and will not create duplicate subscriptions or licences.",
    confirm: "Retry processing",
  },
  link_user: {
    title: "Link this billing record to an account?",
    body: "Link this billing record to the selected VineTrack account. Confirm the account carefully because this may change the user’s entitlement.",
    confirm: "Link account",
  },
};

function ReviewActionDialog({
  item,
  action,
  onOpenChange,
  onCompleted,
}: {
  item: ReviewItem | null;
  action: ReviewAction | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: (outcome: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<{
    id: string;
    name: string;
    email: string;
    vineyards: string;
  } | null>(null);
  const mutation = useReviewItemAction();

  const open = !!item && !!action;
  useEffect(() => {
    if (open) {
      setReason("");
      setTarget(null);
    }
  }, [open, item?.item_id, action]);

  if (!item || !action) return null;
  const copy = ACTION_COPY[action];
  const needsTarget = action === "link_user";
  const ready = reason.trim().length > 0 && (!needsTarget || !!target);

  const submit = async () => {
    try {
      const res = await mutation.mutateAsync({
        itemType: item.item_type,
        itemId: item.item_id,
        action,
        reason: reason.trim(),
        targetUserId: target?.id ?? null,
        affectedUserId: item.user_id ?? target?.id ?? null,
      });
      if (action === "retry") {
        const outcome = res.result?.outcome ?? "unknown";
        if (outcome === "processed" || outcome === "ignored") {
          toast.success(`Retry finished: ${humanise(outcome)}.`);
        } else {
          toast.warning(
            `Retry returned "${humanise(outcome)}"${
              res.result?.code ? ` (${res.result.code})` : ""
            }. The item stays in the review queue.`,
          );
        }
        onCompleted(outcome);
      } else if (action === "dismiss") {
        toast.success("Item dismissed. The billing event and audit history are retained.");
        onCompleted(null);
      } else if (action === "link_user") {
        toast.success(`Linked to ${target?.email}. Retry the event to reprocess it.`);
        onCompleted(null);
      } else if (action === "acknowledge") {
        toast.success("Alert acknowledged.");
        onCompleted(null);
      } else {
        toast.success("Item resolved. It remains available under Resolved.");
        onCompleted(null);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(reviewActionError(e));
    }
  };

  const ageDays = Math.max(
    0,
    Math.round((Date.now() - new Date(item.created_at).getTime()) / 86_400_000),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>

        <Card className="p-3">
          <dl>
            <Row label="Item type" value={REVIEW_ITEM_TYPE_LABEL[item.item_type]} />
            <Row
              label={item.item_type === "ownership_conflict" ? "Currently linked account" : "User"}
              value={item.user_email ?? (item.user_id ? "Linked account" : "Not linked")}
            />
            <Row label="Provider" value={billingSourceLabel(item.provider)} />
            <Row label="Purchase platform" value={purchasePlatformLabel(item.platform)} />
            <Row label="Product" value={item.product ?? "—"} />
            <Row
              label={item.item_type === "alert" ? "Alert reason" : "Current issue"}
              value={item.reason ?? "—"}
            />
            <Row label="Created" value={fmtDateTime(item.created_at)} />
            {action === "retry" && (
              <>
                <Row label="Event age" value={`${ageDays} day${ageDays === 1 ? "" : "s"}`} />
                <Row label="Last attempt" value={fmtDateTime(item.last_attempt_at)} />
                <Row label="Retry count" value={String(item.retry_count)} />
              </>
            )}
          </dl>
        </Card>

        {needsTarget && (
          <div className="space-y-2">
            <Label>Target VineTrack account</Label>
            <AccountPicker selectedId={target?.id ?? null} onSelect={setTarget} />
            {target && (
              <Card className="p-3">
                <dl>
                  <Row label="Selected name" value={target.name} />
                  <Row label="Selected email" value={target.email} />
                  <Row
                    label="Account ID"
                    value={<span className="font-mono text-xs">{target.id}</span>}
                  />
                  {target.vineyards && <Row label="Vineyards" value={target.vineyards} />}
                </dl>
              </Card>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="review-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="review-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this action is being taken."
          />
          <p className="text-[11px] text-muted-foreground">
            Recorded against your administrator account in the permanent billing audit log.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={action === "dismiss" ? "secondary" : "default"}
            disabled={!ready || mutation.isPending}
            onClick={submit}
          >
            {mutation.isPending ? "Working…" : copy.confirm}
          </Button>
        </DialogFooter>
        {!ready && (
          <p className="text-[11px] text-muted-foreground -mt-2">
            {needsTarget && !target
              ? "Select the target account and enter a reason to continue."
              : "Enter a reason to continue."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function BillingReviewPanel({
  itemType,
  onOpenChange,
  onViewUser,
}: {
  itemType: ReviewItemType | null;
  onOpenChange: (open: boolean) => void;
  onViewUser?: (userId: string) => void;
}) {
  const [type, setType] = useState<ReviewItemType>(itemType ?? "event");
  const [status, setStatus] = useState<ReviewStatusFilter>("open");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [lastRetry, setLastRetry] = useState<string | null>(null);

  useEffect(() => {
    if (itemType) {
      setType(itemType);
      setStatus("open");
      setPage(0);
      setSelectedId(null);
      setLastRetry(null);
    }
  }, [itemType]);

  const params = useMemo(
    () => ({ itemType: type, status, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [type, status, page],
  );
  const q = useReviewItems(params, !!itemType);

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const selected = rows.find((r) => r.item_id === selectedId) ?? null;
  const actions = selected ? allowedReviewActions(selected) : [];

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + rows.length;

  const statusOptions: { value: ReviewStatusFilter; label: string }[] =
    type === "alert"
      ? [
          { value: "open", label: "Open" },
          { value: "resolved", label: "Acknowledged" },
          { value: "all", label: "All" },
        ]
      : [
          { value: "open", label: "Open" },
          { value: "resolved", label: "Resolved" },
          { value: "dismissed", label: "Dismissed" },
          { value: "all", label: "All" },
        ];

  useEffect(() => {
    if (type === "alert" && status === "dismissed") setStatus("open");
  }, [type, status]);

  return (
    <>
      <Sheet open={!!itemType} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-5xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Billing Review</SheetTitle>
            <SheetDescription>
              Resolve, dismiss, retry or link billing review items. Nothing is deleted — closed
              items stay available under their status filter and in the billing audit history.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as ReviewItemType);
                setPage(0);
                setSelectedId(null);
              }}
            >
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_ITEM_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {REVIEW_ITEM_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as ReviewStatusFilter);
                setPage(0);
                setSelectedId(null);
              }}
            >
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => q.refetch()}>
              <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {q.isLoading
                ? "Loading review items…"
                : `Showing ${from}–${to} of ${total} item${total === 1 ? "" : "s"}`}
            </span>
          </div>

          <Card className="p-0 overflow-x-auto">
            {q.isLoading && <Skeleton className="h-40 w-full" />}
            {q.error && (
              <div className="p-4 text-sm">{reviewActionError(q.error)}</div>
            )}
            {!q.isLoading && !q.error && rows.length === 0 && (
              <div className="p-8 text-sm text-muted-foreground text-center">
                No {REVIEW_ITEM_TYPE_LABEL[type].toLowerCase()} with this status.
              </div>
            )}
            {rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Purchase platform</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last attempt</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const rowActions = allowedReviewActions(r);
                    const primary = rowActions[0] ?? null;
                    return (
                      <TableRow
                        key={r.item_id}
                        className={`cursor-pointer ${
                          selectedId === r.item_id ? "bg-accent/60" : ""
                        }`}
                        onClick={() => setSelectedId(r.item_id)}
                      >
                        <TableCell className="text-sm">
                          {REVIEW_ITEM_TYPE_LABEL[r.item_type]}
                        </TableCell>
                        <TableCell>
                          <SeverityDot severity={r.severity} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.user_email ?? (r.user_id ? "Linked account" : "Not linked")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {billingSourceLabel(r.provider)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {purchasePlatformLabel(r.platform)}
                        </TableCell>
                        <TableCell className="text-sm">{r.product ?? "—"}</TableCell>
                        <TableCell className="text-sm max-w-[260px] whitespace-normal break-words">
                          {r.reason ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{fmtDateTime(r.created_at)}</TableCell>
                        <TableCell className="text-xs">
                          {fmtDateTime(r.last_attempt_at)}
                        </TableCell>
                        <TableCell className="text-xs">{r.retry_count}</TableCell>
                        <TableCell>
                          <StatusBadge item={r} />
                        </TableCell>
                        <TableCell className="text-right">
                          {primary ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(r.item_id);
                                setAction(primary);
                              }}
                            >
                              {primary === "link_user" && <Link2 className="h-3 w-3 mr-1" />}
                              {primary === "retry" && <RotateCcw className="h-3 w-3 mr-1" />}
                              {primary === "acknowledge" ? "Acknowledge" : null}
                              {primary === "link_user" ? "Link user" : null}
                              {primary === "retry" ? "Retry" : null}
                              {primary === "resolve" ? "Resolve" : null}
                              {primary === "dismiss" ? "Dismiss" : null}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Closed</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
              disabled={to >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {selected && (
            <Card className="p-4 mt-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold">Review item detail</h3>
                <StatusBadge item={selected} />
              </div>
              <dl>
                <Row label="Item type" value={REVIEW_ITEM_TYPE_LABEL[selected.item_type]} />
                <Row
                  label={
                    selected.user_id
                      ? "Linked VineTrack account"
                      : "Unresolved external account"
                  }
                  value={
                    selected.user_id ? (
                      <button
                        className="text-primary hover:underline"
                        onClick={() => onViewUser?.(selected.user_id as string)}
                      >
                        {selected.user_email ?? "View account"}
                      </button>
                    ) : (
                      (selected.user_email ?? "No VineTrack account is linked to this record")
                    )
                  }
                />
                <Row label="Provider" value={billingSourceLabel(selected.provider)} />
                <Row label="Platform" value={purchasePlatformLabel(selected.platform)} />
                <Row label="Product" value={selected.product ?? "—"} />
                <Row label="Processing error" value={selected.reason ?? "—"} />
                <Row label="Created" value={fmtDateTime(selected.created_at)} />
                <Row
                  label="Last processing attempt"
                  value={fmtDateTime(selected.last_attempt_at)}
                />
                <Row label="Retry count" value={String(selected.retry_count)} />
                <Row
                  label="Retry allowed"
                  value={
                    selected.is_retryable
                      ? "Yes — the backend reports this event as safely retryable"
                      : "No — the backend does not allow this event to be retried"
                  }
                />
                {selected.resolved_at && (
                  <Row
                    label={
                      selected.item_type === "alert" ? "Acknowledged" : "Resolved"
                    }
                    value={`${fmtDateTime(selected.resolved_at)}${
                      selected.resolved_by ? " · by an administrator" : ""
                    }`}
                  />
                )}
                {selected.dismissed_at && (
                  <Row label="Dismissed" value={fmtDateTime(selected.dismissed_at)} />
                )}
              </dl>

              <Separator className="my-3" />
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Item ID</span>
                <span className="text-[11px] font-mono text-muted-foreground break-all">
                  {selected.item_id}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => {
                    navigator.clipboard?.writeText(selected.item_id);
                    toast.success("Item ID copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>

              {lastRetry && (
                <p className="text-xs mt-2">
                  Last retry outcome:{" "}
                  <span className="font-medium">{humanise(lastRetry)}</span>
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-3">
                {actions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    This item is closed. Actions are only available while an item is open.
                  </p>
                )}
                {actions.map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant={a === "resolve" ? "default" : "outline"}
                    onClick={() => setAction(a)}
                  >
                    {a === "link_user" && <Link2 className="h-3 w-3 mr-1" />}
                    {a === "retry" && <RotateCcw className="h-3 w-3 mr-1" />}
                    {a === "acknowledge" && "Acknowledge"}
                    {a === "link_user" && "Link user"}
                    {a === "retry" && "Retry"}
                    {a === "resolve" && "Resolve"}
                    {a === "dismiss" && "Dismiss"}
                  </Button>
                ))}
                {selected.status === "open" &&
                  selected.item_type !== "alert" &&
                  !selected.is_retryable && (
                    <p className="text-[11px] text-muted-foreground basis-full">
                      Retry is unavailable: the backend reports this event as not retryable.
                      {selected.item_type === "unresolved_user"
                        ? " Link an account first, then retry."
                        : ""}
                    </p>
                  )}
              </div>
            </Card>
          )}
        </SheetContent>
      </Sheet>

      <ReviewActionDialog
        item={selected}
        action={action}
        onOpenChange={(o) => !o && setAction(null)}
        onCompleted={(outcome) => {
          setLastRetry(outcome);
          q.refetch();
        }}
      />
    </>
  );
}
