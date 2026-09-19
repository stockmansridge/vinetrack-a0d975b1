import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminVineyards,
  useAdminVineyardMembers,
  useAdminSetMemberRole,
} from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, formatDate } from "./_shared";

const ROLE_ORDER = ["owner", "manager", "supervisor", "operator"] as const;

const ROLE_ACCESS: Record<string, string> = {
  owner: "Full access — billing, integrations, team management, all records and reports.",
  manager: "Team and setup management, financial reports, all operational records.",
  supervisor: "Operational records — spray jobs/records, yield, work tasks. No financials or team management.",
  operator: "Field access — view assigned work, no setup, reports or team management.",
};

function describeRoleError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(err ?? "");
  if (/last owner/i.test(msg)) return "You can't demote the last owner of this vineyard.";
  if (/42501|not authorised|not authorized|permission/i.test(msg))
    return "You don't have permission to change access.";
  if (/Could not find the function|PGRST202/i.test(msg))
    return "The backend update for admin access changes (SQL 240) hasn't been applied yet.";
  return msg || "Something went wrong. Please try again.";
}

export default function AdminVineyardMemberPage() {
  const { id, mid } = useParams<{ id: string; mid: string }>();
  const { toast } = useToast();
  const vineyardsQ = useAdminVineyards();
  const membersQ = useAdminVineyardMembers(id);
  const setRole = useAdminSetMemberRole(id);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  const vineyard = vineyardsQ.data?.find((x) => x.id === id);
  const member = useMemo(
    () => membersQ.data?.find((m) => m.membership_id === mid),
    [membersQ.data, mid],
  );

  const name =
    member?.display_name?.trim() ||
    member?.full_name?.trim() ||
    member?.email?.trim() ||
    "Member";

  const currentRole = member?.role ?? null;
  const effectivePending = pendingRole ?? currentRole;
  const dirty = !!member && !!pendingRole && pendingRole !== member.role;
  const isSoleOwner =
    member?.role === "owner" &&
    (membersQ.data ?? []).filter((m) => m.role === "owner").length === 1;

  const save = async () => {
    if (!member || !pendingRole) return;
    try {
      await setRole.mutateAsync({ membershipId: member.membership_id, newRole: pendingRole });
      setPendingRole(null);
      toast({ title: "Access updated", description: `${name} is now ${pendingRole}.` });
    } catch (err) {
      toast({
        title: "Couldn't update access",
        description: describeRoleError(err),
        variant: "destructive",
      });
    }
  };

  return (
    <AdminGate>
      <AdminPageHeader
        title={name}
        subtitle={vineyard ? `Member of ${vineyard.name}` : undefined}
        back={`/admin/vineyards/${id}`}
      />
      <AdminError error={vineyardsQ.error ?? membersQ.error} />

      {membersQ.isLoading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}

      {!membersQ.isLoading && !member && !membersQ.error && (
        <Card className="p-4 text-sm text-muted-foreground">
          Member not found in this vineyard.{" "}
          <Link to={`/admin/vineyards/${id}`} className="text-primary hover:underline">
            Back to vineyard
          </Link>
        </Card>
      )}

      {member && (
        <div className="space-y-4 max-w-2xl">
          <Card className="p-4">
            <h2 className="font-semibold mb-3">Member</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Name</div>
                {name}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Email</div>
                {member.email ?? "—"}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Joined</div>
                {formatDate(member.joined_at)}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">User</div>
                <Link
                  to={`/admin/users/${member.user_id}`}
                  className="text-primary hover:underline"
                >
                  View user record
                </Link>
              </div>
            </div>
            <div className="text-xs text-muted-foreground font-mono break-all mt-3">
              {member.user_id}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-3">Access</h2>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-muted-foreground">Current role</span>
              <Badge variant="outline" className="text-xs capitalize">{member.role}</Badge>
              {isSoleOwner && (
                <Badge variant="secondary" className="text-xs">Sole owner</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {ROLE_ACCESS[effectivePending ?? ""] ?? "—"}
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={effectivePending ?? undefined}
                onValueChange={(v) => setPendingRole(v)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_ORDER.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={save}
                disabled={!dirty || setRole.isPending}
              >
                {setRole.isPending ? "Saving…" : "Save access"}
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setPendingRole(null)}>
                  Cancel
                </Button>
              )}
            </div>
            {isSoleOwner && pendingRole && pendingRole !== "owner" && (
              <p className="text-xs text-orange-600 mt-2">
                This member is the sole owner — assign another owner before demoting them.
              </p>
            )}
          </Card>
        </div>
      )}
    </AdminGate>
  );
}
