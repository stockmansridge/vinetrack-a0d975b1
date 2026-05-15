import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  useSystemAdmins,
  useAddSystemAdmin,
  useSetSystemAdminActive,
} from "@/lib/adminApi";
import { AdminGate, AdminPageHeader, AdminError, AdminEmpty, StatusPill, formatDate } from "./_shared";

function mapRpcError(err: unknown): string {
  const e = err as { message?: string; code?: string };
  const msg = e?.message ?? String(err);
  if (msg.includes("user_not_found")) return "No VineTrack user with that email — they must sign in once first.";
  if (msg.includes("email_required")) return "Please enter an email address.";
  if (msg.includes("cannot_deactivate_last_admin")) return "Cannot deactivate the only remaining active admin.";
  if (msg.includes("admin_not_found")) return "Admin record not found.";
  if (e?.code === "42501") return "Admin access required.";
  return msg;
}

export default function SystemAdminsPage() {
  const { user } = useAuth();
  const { data = [], isLoading, error } = useSystemAdmins();
  const addMut = useAddSystemAdmin();
  const setActive = useSetSystemAdminActive();
  const [email, setEmail] = useState("");

  const activeCount = useMemo(() => data.filter((a) => a.is_active).length, [data]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!v) return;
    try {
      await addMut.mutateAsync(v);
      toast({ title: "System admin added", description: v });
      setEmail("");
    } catch (err) {
      toast({ title: "Could not add admin", description: mapRpcError(err), variant: "destructive" });
    }
  };

  const onToggle = async (row: { user_id: string; is_active: boolean; email: string }) => {
    if (row.is_active && row.user_id === user?.id) {
      const ok = window.confirm("You are about to deactivate your own admin access. Continue?");
      if (!ok) return;
    }
    try {
      await setActive.mutateAsync({ userId: row.user_id, isActive: !row.is_active });
      toast({
        title: row.is_active ? "Admin deactivated" : "Admin reactivated",
        description: row.email,
      });
    } catch (err) {
      toast({ title: "Action failed", description: mapRpcError(err), variant: "destructive" });
    }
  };

  return (
    <AdminGate>
      <AdminPageHeader title="System Admins" subtitle={`${activeCount} active`} />
      <div className="space-y-4">
        <Card className="p-4">
          <form onSubmit={onAdd} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs text-muted-foreground">Add by email</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={addMut.isPending}>
              {addMut.isPending ? "Adding…" : "Add admin"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">
            User must have signed in to VineTrack at least once.
          </p>
        </Card>

        <Card className="p-4">
          <AdminError error={error} />
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && data.length === 0 && <AdminEmpty>No system admins.</AdminEmpty>}
          <div className="divide-y">
            {data.map((a) => {
              const isLastActive = a.is_active && activeCount <= 1;
              return (
                <div key={a.user_id} className="flex items-center gap-3 py-2 px-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{a.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Added {formatDate(a.created_at)}
                      {a.user_id === user?.id && " · you"}
                    </div>
                  </div>
                  <StatusPill status={a.is_active ? "active" : "inactive"} />
                  <Badge variant="outline" className="text-xs hidden sm:inline-flex">{formatDate(a.created_at)}</Badge>
                  <Button
                    size="sm"
                    variant={a.is_active ? "outline" : "default"}
                    disabled={setActive.isPending || isLastActive}
                    title={isLastActive ? "Cannot deactivate the only remaining active admin" : undefined}
                    onClick={() => onToggle(a)}
                  >
                    {a.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </AdminGate>
  );
}
