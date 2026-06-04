import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Sparkles, Plus } from "lucide-react";
import {
  AdminGate,
  AdminPageHeader,
  AdminError,
  AdminEmpty,
  StatusPill,
  formatDate,
} from "./_shared";
import { useAdminUsers, useAdminUserVineyards } from "@/lib/adminApi";
import {
  useManualUnlimitedGrants,
  useGrantUnlimitedAccess,
  useRevokeUnlimitedAccess,
  grantState,
  type ManualUnlimitedGrant,
} from "@/lib/billingGrantsQuery";

function errMsg(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? String(err);
}

export default function BillingGrantsPage() {
  const { data: grants = [], isLoading, error, refetch } = useManualUnlimitedGrants();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ManualUnlimitedGrant | null>(null);
  const [revokeLicences, setRevokeLicences] = useState(true);
  const revokeMut = useRevokeUnlimitedAccess();

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeMut.mutateAsync({
        subscriptionId: revokeTarget.subscription_id,
        revokeLicences,
      });
      toast({ title: "Grant revoked", description: revokeTarget.vineyard_name ?? "" });
      setRevokeTarget(null);
    } catch (err) {
      toast({ title: "Revoke failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <AdminGate>
      <AdminPageHeader
        title="Billing Grants / Internal Access"
        subtitle={`${grants.length} grant${grants.length === 1 ? "" : "s"}`}
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add grant
          </Button>
        }
      />

      <Card className="p-3 mb-4 flex items-start gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <span>
          These grants are manually managed by VineTrack and do not use Stripe, Apple or
          RevenueCat.
        </span>
      </Card>

      <Card className="p-4">
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && grants.length === 0 && (
          <AdminEmpty>No manual unlimited grants.</AdminEmpty>
        )}
        {!isLoading && grants.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vineyard</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Licences</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map((g) => {
                  const state = grantState(g);
                  return (
                    <TableRow key={g.subscription_id}>
                      <TableCell className="font-medium">
                        <div>{g.vineyard_name ?? "—"}</div>
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Internal Unlimited
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{g.owner_full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {g.owner_email ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusPill status={state} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {g.status ?? "—"}
                      </TableCell>
                      <TableCell>{g.active_licence_count ?? 0}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={g.manual_grant_reason ?? ""}>
                        {g.manual_grant_reason ?? "—"}
                      </TableCell>
                      <TableCell>{formatDate(g.manual_grant_expires_at)}</TableCell>
                      <TableCell>{formatDate(g.created_at)}</TableCell>
                      <TableCell>{formatDate(g.updated_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={state !== "active"}
                          onClick={() => {
                            setRevokeLicences(true);
                            setRevokeTarget(g);
                          }}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <AddGrantDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => {
          refetch();
        }}
      />

      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke unlimited access?</DialogTitle>
            <DialogDescription>
              This can also revoke active licences under this grant.
            </DialogDescription>
          </DialogHeader>
          {revokeTarget && (
            <div className="text-sm space-y-2">
              <div>
                <span className="text-muted-foreground">Vineyard: </span>
                <span className="font-medium">{revokeTarget.vineyard_name ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Owner: </span>
                {revokeTarget.owner_email ?? "—"}
              </div>
              <label className="flex items-center gap-2 pt-2">
                <Checkbox
                  checked={revokeLicences}
                  onCheckedChange={(c) => setRevokeLicences(c === true)}
                />
                <span>
                  Also revoke {revokeTarget.active_licence_count ?? 0} active licence
                  {revokeTarget.active_licence_count === 1 ? "" : "s"}
                </span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMut.isPending}
              onClick={handleRevoke}
            >
              {revokeMut.isPending ? "Revoking…" : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminGate>
  );
}

function AddGrantDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [vineyardId, setVineyardId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const { data: users = [], isLoading: usersLoading } = useAdminUsers();
  const { data: vineyards = [], isLoading: vineyardsLoading } = useAdminUserVineyards(
    ownerId || undefined,
  );
  const grantMut = useGrantUnlimitedAccess();

  const filteredUsers = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return users.slice(0, 25);
    return users
      .filter(
        (u) =>
          u.email?.toLowerCase().includes(s) ||
          u.full_name?.toLowerCase().includes(s),
      )
      .slice(0, 25);
  }, [users, search]);

  const reset = () => {
    setSearch("");
    setOwnerId("");
    setVineyardId("");
    setReason("");
    setExpiresAt("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerId || !vineyardId || !reason.trim()) {
      toast({
        title: "Missing fields",
        description: "Owner, vineyard and reason are required.",
        variant: "destructive",
      });
      return;
    }
    try {
      await grantMut.mutateAsync({
        ownerUserId: ownerId,
        vineyardId,
        reason: reason.trim(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      toast({ title: "Grant created" });
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast({ title: "Grant failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Grant internal unlimited access</DialogTitle>
          <DialogDescription>
            Manually granted access — does not use Stripe, Apple or RevenueCat.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Search owner</label>
            <Input
              placeholder="email or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Owner user</label>
            <Select
              value={ownerId}
              onValueChange={(v) => {
                setOwnerId(v);
                setVineyardId("");
              }}
              disabled={usersLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={usersLoading ? "Loading…" : "Select owner"} />
              </SelectTrigger>
              <SelectContent>
                {filteredUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.email} {u.full_name ? `· ${u.full_name}` : ""}
                  </SelectItem>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Vineyard</label>
            <Select
              value={vineyardId}
              onValueChange={setVineyardId}
              disabled={!ownerId || vineyardsLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !ownerId
                      ? "Select owner first"
                      : vineyardsLoading
                        ? "Loading…"
                        : vineyards.length === 0
                          ? "No vineyards for this user"
                          : "Select vineyard"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {vineyards.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} {v.is_owner ? "· owner" : v.role ? `· ${v.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Reason / note</label>
            <Textarea
              required
              rows={3}
              placeholder="Internal account, partner trial, support comp, etc."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Expires at (optional)</label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={grantMut.isPending}>
              {grantMut.isPending ? "Granting…" : "Grant access"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
