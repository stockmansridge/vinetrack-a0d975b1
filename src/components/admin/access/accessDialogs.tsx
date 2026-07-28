import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  GRANT_TYPES,
  type GrantType,
  fmtDateTime,
  grantTypeLabel,
  useAcknowledgeAlert,
  useAssignLicence,
  useCreateBillingGrant,
  useExtendBillingGrant,
  useRefreshUserEntitlement,
  useRemoveLicence,
  useRevokeBillingGrant,
} from "@/lib/accessEntitlementsQuery";

function errMsg(err: unknown): string {
  const e = err as { message?: string; hint?: string };
  return e?.message ?? String(err);
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function toIsoOrNull(date: string): string | null {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------------------------------------------ */
/* Create grant                                                        */
/* ------------------------------------------------------------------ */

export function CreateGrantDialog({
  open,
  onOpenChange,
  userId,
  userLabel,
  vineyards,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string | null;
  userLabel: string;
  vineyards: { id: string; name: string }[];
}) {
  const [grantType, setGrantType] = useState<GrantType>("internal_unlimited");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [vineyardId, setVineyardId] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const mut = useCreateBillingGrant();

  useEffect(() => {
    if (!open) {
      setGrantType("internal_unlimited");
      setReason("");
      setStartsAt("");
      setExpiresAt("");
      setVineyardId("");
      setConfirmed(false);
    }
  }, [open]);

  // Backend rejects these grant types without an expiry (`expiry_required_for_grant_type`).
  const requiresExpiry = GRANT_TYPES_REQUIRING_EXPIRY.includes(grantType);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      toast({
        title: "Account setup required",
        description:
          "The user must create or activate their VineTrack account before this grant can be linked.",
        variant: "destructive",
      });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "Reason is required", variant: "destructive" });
      return;
    }
    if (requiresExpiry && !expiresAt) {
      toast({
        title: "Expiry required",
        description: `${grantTypeLabel(grantType)} grants must have an expiry date.`,
        variant: "destructive",
      });
      return;
    }
    try {
      await mut.mutateAsync({
        userId,
        grantType,
        reason: reason.trim(),
        vineyardId: vineyardId || null,
        startsAt: toIsoOrNull(startsAt),
        expiresAt: toIsoOrNull(expiresAt),
      });
      toast({ title: "Billing grant created", description: grantTypeLabel(grantType) });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Grant failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Billing Grant</DialogTitle>
          <DialogDescription>
            Manually granted access for {userLabel}. Does not use Stripe, Apple or Google Play.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Grant type">
            <Select value={grantType} onValueChange={(v) => setGrantType(v as GrantType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANT_TYPES.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reason" hint="Recorded in the audit trail. Required.">
            <Textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Internal account, partner trial, support compensation…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date (optional)">
              <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field
              label={requiresExpiry ? "Expiry date (required)" : "Expiry date (optional)"}
            >
              <Input
                type="date"
                required={requiresExpiry}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </Field>
          </div>
          {vineyards.length > 0 && (
            <Field label="Vineyard (optional)">
              <Select value={vineyardId} onValueChange={setVineyardId}>
                <SelectTrigger>
                  <SelectValue placeholder="No specific vineyard" />
                </SelectTrigger>
                <SelectContent>
                  {vineyards.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <label className="flex items-start gap-2 text-sm pt-1">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(c) => setConfirmed(c === true)}
              className="mt-0.5"
            />
            <span>
              I confirm this grant is authorised and will change this user's effective access.
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!confirmed || mut.isPending}>
              {mut.isPending ? "Creating…" : "Create grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Extend grant                                                        */
/* ------------------------------------------------------------------ */

export function ExtendGrantDialog({
  open,
  onOpenChange,
  subscriptionId,
  userId,
  summary,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subscriptionId: string | null;
  userId: string | null;
  summary: string;
}) {
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const mut = useExtendBillingGrant();

  useEffect(() => {
    if (!open) {
      setExpiry("");
      setReason("");
      setConfirmed(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const iso = toIsoOrNull(expiry);
    if (!subscriptionId || !iso || !reason.trim()) {
      toast({ title: "New expiry and reason are required", variant: "destructive" });
      return;
    }
    try {
      await mut.mutateAsync({ subscriptionId, reason: reason.trim(), newExpiresAt: iso, userId });
      toast({ title: "Grant extended" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Extend failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Extend Billing Grant</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="New expiry">
            <Input
              type="date"
              required
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
          <Field label="Reason">
            <Textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} />
            <span>I confirm this extension.</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!confirmed || mut.isPending}>
              {mut.isPending ? "Extending…" : "Extend grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Revoke grant                                                        */
/* ------------------------------------------------------------------ */

export function RevokeGrantDialog({
  open,
  onOpenChange,
  subscriptionId,
  userId,
  summary,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subscriptionId: string | null;
  userId: string | null;
  summary: string;
}) {
  const [reason, setReason] = useState("");
  const [revokeLicences, setRevokeLicences] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const mut = useRevokeBillingGrant();

  useEffect(() => {
    if (!open) {
      setReason("");
      setRevokeLicences(true);
      setConfirmed(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriptionId || !reason.trim()) {
      toast({ title: "Reason is required", variant: "destructive" });
      return;
    }
    try {
      await mut.mutateAsync({ subscriptionId, reason: reason.trim(), revokeLicences, userId });
      toast({ title: "Grant revoked" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Revoke failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke Billing Grant</DialogTitle>
          <DialogDescription>
            {summary} — this may immediately remove the user's access to the portal and mobile
            apps.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Reason">
            <Textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={revokeLicences}
              onCheckedChange={(c) => setRevokeLicences(c === true)}
            />
            <span>Also revoke licences assigned under this grant</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} />
            <span>I understand this removes paid access.</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!confirmed || mut.isPending}
            >
              {mut.isPending ? "Revoking…" : "Revoke grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Licence assign / remove                                             */
/* ------------------------------------------------------------------ */

export interface LicencePoolOption {
  subscriptionId: string;
  label: string;
  seatsTotal: number | null;
  seatsAssigned: number | null;
  seatsAvailable: number | null;
  vineyardId: string | null;
  vineyardName: string | null;
  assignable: boolean;
  blockedReason?: string;
}

export function AssignLicenceDialog({
  open,
  onOpenChange,
  userId,
  userLabel,
  pools,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string | null;
  userLabel: string;
  pools: LicencePoolOption[];
}) {
  const [poolId, setPoolId] = useState("");
  const [reason, setReason] = useState("");
  const mut = useAssignLicence();
  const pool = pools.find((p) => p.subscriptionId === poolId) ?? null;

  useEffect(() => {
    if (!open) {
      setPoolId("");
      setReason("");
    }
  }, [open]);

  const noSeats = !!pool && pool.seatsAvailable !== null && pool.seatsAvailable <= 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !pool || !reason.trim()) {
      toast({ title: "Licence pool and reason are required", variant: "destructive" });
      return;
    }
    if (noSeats || !pool.assignable) {
      toast({
        title: "Cannot assign",
        description: pool.blockedReason ?? "No seats remain in this licence pool.",
        variant: "destructive",
      });
      return;
    }
    try {
      await mut.mutateAsync({
        subscriptionId: pool.subscriptionId,
        userId,
        reason: reason.trim(),
        vineyardId: pool.vineyardId,
      });
      toast({ title: "Licence assigned", description: userLabel });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Assignment failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Licence</DialogTitle>
          <DialogDescription>Assign a seat to {userLabel}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Licence pool">
            <Select value={poolId} onValueChange={setPoolId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    pools.length ? "Select licence pool" : "No assignable licence pools"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {pools.map((p) => (
                  <SelectItem key={p.subscriptionId} value={p.subscriptionId} disabled={!p.assignable}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {pool && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
              <div>Vineyard: {pool.vineyardName ?? "—"}</div>
              <div>Total seats: {pool.seatsTotal ?? "—"}</div>
              <div>Assigned seats: {pool.seatsAssigned ?? "—"}</div>
              <div>Available seats: {pool.seatsAvailable ?? "—"}</div>
              {!pool.assignable && (
                <div className="text-destructive">{pool.blockedReason}</div>
              )}
            </div>
          )}
          <Field label="Reason">
            <Textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mut.isPending || !pool || noSeats || !pool?.assignable}>
              {mut.isPending ? "Assigning…" : "Assign licence"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveLicenceDialog({
  open,
  onOpenChange,
  licenceId,
  userId,
  summary,
  warnAccessLoss,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  licenceId: string | null;
  userId: string | null;
  summary: string;
  warnAccessLoss: boolean;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const mut = useRemoveLicence();

  useEffect(() => {
    if (!open) {
      setReason("");
      setConfirmed(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenceId || !reason.trim()) {
      toast({ title: "Reason is required", variant: "destructive" });
      return;
    }
    try {
      await mut.mutateAsync({ licenceId, reason: reason.trim(), userId });
      toast({ title: "Licence removed" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Removal failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove Licence</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        {warnAccessLoss && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Removing this licence is expected to remove this user's effective access.
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <Field label="Reason">
            <Textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} />
            <span>I confirm this licence removal.</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!confirmed || mut.isPending}>
              {mut.isPending ? "Removing…" : "Remove licence"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Acknowledge alert                                                   */
/* ------------------------------------------------------------------ */

export function AcknowledgeAlertDialog({
  alert,
  onOpenChange,
  details,
}: {
  alert: { id: string } | null;
  onOpenChange: (o: boolean) => void;
  details: {
    alertType: string;
    user: string;
    product: string;
    platform: string;
    reason: string;
    createdAt: string | null;
  } | null;
}) {
  const mut = useAcknowledgeAlert();
  const submit = async () => {
    if (!alert) return;
    try {
      await mut.mutateAsync({ alertId: alert.id });
      toast({
        title: "Alert acknowledged",
        description: "The alert is retained in history as acknowledged.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Acknowledge failed", description: errMsg(err), variant: "destructive" });
    }
  };
  return (
    <Dialog open={!!alert} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acknowledge billing alert?</DialogTitle>
          <DialogDescription>
            Acknowledging records that an administrator has reviewed this alert. It is not
            deleted.
          </DialogDescription>
        </DialogHeader>
        {details && (
          <dl className="text-sm space-y-1">
            <Row label="Alert type" value={details.alertType} />
            <Row label="User" value={details.user} />
            <Row label="Product" value={details.product} />
            <Row label="Platform" value={details.platform} />
            <Row label="Reason" value={details.reason} />
            <Row label="Created" value={fmtDateTime(details.createdAt)} />
          </dl>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? "Acknowledging…" : "Acknowledge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-words">{value || "—"}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Refresh entitlement                                                 */
/* ------------------------------------------------------------------ */

export function RefreshEntitlementDialog({
  open,
  onOpenChange,
  userId,
  userLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string | null;
  userLabel: string;
}) {
  const mut = useRefreshUserEntitlement();
  const submit = async () => {
    if (!userId) return;
    try {
      await mut.mutateAsync({ userId });
      toast({ title: "Entitlement recalculated", description: userLabel });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Refresh failed", description: errMsg(err), variant: "destructive" });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refresh entitlement</DialogTitle>
          <DialogDescription>
            Recalculate this user's effective access from their current subscriptions, grants,
            licences and trial state.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending ? "Refreshing…" : "Refresh entitlement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
