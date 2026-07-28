import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  CreateGrantDialog,
  ExtendGrantDialog,
  RevokeGrantDialog,
} from "@/components/admin/access/accessDialogs";
import {
  grantState,
  grantTypeLabel,
  useBillingGrants,
  type BillingGrantRow,
} from "@/lib/accessEntitlementsQuery";

/** Choose the grant owner, then reuse the shared Access & Entitlements dialog. */
function OwnerPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (owner: { id: string; label: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: users = [], isLoading } = useAdminUsers();

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = s
      ? users.filter(
          (u) =>
            u.email?.toLowerCase().includes(s) || u.full_name?.toLowerCase().includes(s),
        )
      : users;
    return list.slice(0, 25);
  }, [users, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select grant owner</DialogTitle>
          <DialogDescription>
            The grant is created against this person's VineTrack account.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search by email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-72 overflow-y-auto divide-y">
          {isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">No matching accounts.</div>
          )}
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              className="w-full text-left p-2 hover:bg-muted rounded-sm"
              onClick={() => onPick({ id: u.id, label: u.full_name || u.email || u.id })}
            >
              <div className="text-sm font-medium">{u.full_name ?? u.email}</div>
              <div className="text-xs text-muted-foreground">{u.email}</div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnerVineyardGrantDialog({
  owner,
  onClose,
}: {
  owner: { id: string; label: string } | null;
  onClose: () => void;
}) {
  const { data: vineyards = [] } = useAdminUserVineyards(owner?.id ?? undefined);
  return (
    <CreateGrantDialog
      open={!!owner}
      onOpenChange={(o) => !o && onClose()}
      userId={owner?.id ?? null}
      userLabel={owner?.label ?? ""}
      vineyards={vineyards.map((v) => ({ id: v.id, name: v.name }))}
    />
  );
}

export default function BillingGrantsPage() {
  const { data: grants = [], isLoading, error } = useBillingGrants();
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [ownerPicker, setOwnerPicker] = useState(false);
  const [owner, setOwner] = useState<{ id: string; label: string } | null>(null);
  const [extendTarget, setExtendTarget] = useState<BillingGrantRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<BillingGrantRow | null>(null);

  const visible = showActiveOnly ? grants.filter((g) => grantState(g) === "active") : grants;

  return (
    <AdminGate>
      <AdminPageHeader
        title="Billing Grants / Internal Access"
        subtitle={`${visible.length} grant${visible.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/admin/access-entitlements">Access &amp; Entitlements</Link>
            </Button>
            <Button onClick={() => setOwnerPicker(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add grant
            </Button>
          </div>
        }
      />

      <Card className="p-3 mb-4 flex items-start gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <span>
          These grants are manually managed by VineTrack and do not use Stripe, Apple or Google
          Play.
        </span>
      </Card>

      <div className="flex justify-end mb-2">
        <Select
          value={showActiveOnly ? "active" : "all"}
          onValueChange={(v) => setShowActiveOnly(v === "active")}
        >
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active grants</SelectItem>
            <SelectItem value="all">All grants</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="p-4">
        <AdminError error={error} />
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && visible.length === 0 && <AdminEmpty>No billing grants.</AdminEmpty>}
        {!isLoading && visible.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner</TableHead>
                  <TableHead>Grant type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Licences</TableHead>
                  <TableHead>Platforms</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((g) => {
                  const state = grantState(g);
                  return (
                    <TableRow key={g.subscription_id}>
                      <TableCell>
                        <div className="text-sm font-medium">
                          {g.owner_name ?? g.owner_email ?? "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">{g.owner_email ?? "—"}</div>
                        {g.vineyard_name && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            {g.vineyard_name}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{grantTypeLabel(g.grant_type)}</TableCell>
                      <TableCell>
                        <StatusPill status={state} />
                      </TableCell>
                      <TableCell className="text-sm">{g.licences_display ?? "—"}</TableCell>
                      <TableCell className="text-xs">{g.platforms_display ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={g.reason ?? ""}>
                        {g.reason ?? "—"}
                      </TableCell>
                      <TableCell>{formatDate(g.starts_at)}</TableCell>
                      <TableCell>{formatDate(g.expires_at)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={state !== "active"}
                          onClick={() => setExtendTarget(g)}
                        >
                          Extend
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={state !== "active"}
                          onClick={() => setRevokeTarget(g)}
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

      <OwnerPickerDialog
        open={ownerPicker}
        onOpenChange={setOwnerPicker}
        onPick={(o) => {
          setOwnerPicker(false);
          setOwner(o);
        }}
      />
      <OwnerVineyardGrantDialog owner={owner} onClose={() => setOwner(null)} />

      <ExtendGrantDialog
        open={!!extendTarget}
        onOpenChange={(o) => !o && setExtendTarget(null)}
        subscriptionId={extendTarget?.subscription_id ?? null}
        userId={extendTarget?.owner_user_id ?? null}
        summary={
          extendTarget
            ? `${grantTypeLabel(extendTarget.grant_type)} for ${extendTarget.owner_email ?? "this owner"}`
            : ""
        }
      />
      <RevokeGrantDialog
        open={!!revokeTarget}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
        subscriptionId={revokeTarget?.subscription_id ?? null}
        userId={revokeTarget?.owner_user_id ?? null}
        summary={
          revokeTarget
            ? `${grantTypeLabel(revokeTarget.grant_type)} for ${revokeTarget.owner_email ?? "this owner"} (${revokeTarget.licences_display ?? "no licences"})`
            : ""
        }
      />
    </AdminGate>
  );
}
