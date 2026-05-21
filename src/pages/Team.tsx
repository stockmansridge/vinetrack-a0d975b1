import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { supabase } from "@/integrations/ios-supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, X, RefreshCw, Trash2 } from "lucide-react";
import { useCanSeeCosts } from "@/lib/permissions";
import { fetchOperatorCategoriesForVineyard } from "@/lib/operatorCategoriesQuery";
import {
  fetchVineyardMembersWithCategory,
  describeMemberWriteError,
} from "@/lib/teamMembersQuery";
import {
  listVineyardInvitations,
  createInvitation,
  cancelInvitation,
  resendInvitation,
  describeInvitationError,
  type InvitationRole,
  type VineyardInvitation,
} from "@/lib/invitationsQuery";
import {
  updateMemberRole,
  updateMemberOperatorCategoryRpc,
  removeMember,
  describeMemberMgmtError,
  type MemberRole,
} from "@/lib/memberManagementQuery";
import { useToast } from "@/hooks/use-toast";
import { dedupeOperatorCategories } from "@/lib/operatorCategoryDedupe";

interface TeamMember {
  membership_id: string;
  vineyard_id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  display_name: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

const NONE = "__none__";
const INVITE_ROLES: InvitationRole[] = ["manager", "supervisor", "operator"];
const MEMBER_ROLES: MemberRole[] = ["owner", "manager", "supervisor", "operator"];

const initials = (name: string | null | undefined, fallback: string) => {
  const src = (name && name.trim()) || fallback;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
};

export default function Team() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const isOwner = currentRole === "owner";
  const canEdit = isOwner || currentRole === "manager";
  const canSeeCosts = useCanSeeCosts();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [inviteOpen, setInviteOpen] = useState(false);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["team-rpc", selectedVineyardId] });
    qc.invalidateQueries({ queryKey: ["vineyard-members-rows", selectedVineyardId] });
    qc.invalidateQueries({ queryKey: ["vineyard-invitations", selectedVineyardId] });
  };

  const { data, isLoading, error } = useQuery<
    { members: TeamMember[]; forbidden: boolean; errorMessage: string | null }
  >({
    queryKey: ["team-rpc", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_vineyard_team_members", {
        p_vineyard_id: selectedVineyardId!,
      });
      if (error) {
        if ((error as { code?: string }).code === "42501") {
          return { members: [], forbidden: true, errorMessage: null };
        }
        throw error;
      }
      return { members: (data ?? []) as TeamMember[], forbidden: false, errorMessage: null };
    },
  });

  const { data: memberRows } = useQuery({
    queryKey: ["vineyard-members-rows", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyardMembersWithCategory(selectedVineyardId!),
  });

  const { data: categoriesRes } = useQuery({
    queryKey: ["operator-categories", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchOperatorCategoriesForVineyard(selectedVineyardId!),
  });
  const rawCategories = categoriesRes?.categories ?? [];
  const { unique: categories, idToKeptId: categoryIdToKeptId } = useMemo(
    () => dedupeOperatorCategories(rawCategories),
    [rawCategories],
  );

  const { data: invitations = [], isLoading: invitesLoading } = useQuery({
    queryKey: ["vineyard-invitations", selectedVineyardId],
    enabled: !!selectedVineyardId && canEdit,
    queryFn: () => listVineyardInvitations(selectedVineyardId!),
  });

  const categoryByMembership = useMemo(() => {
    const m = new Map<string, string | null>();
    (memberRows ?? []).forEach((r) => m.set(r.id, r.operator_category_id ?? null));
    return m;
  }, [memberRows]);

  const membershipIdByUserId = useMemo(() => {
    const m = new Map<string, string>();
    (memberRows ?? []).forEach((r) => m.set(r.user_id, r.id));
    return m;
  }, [memberRows]);

  const setCategory = useMutation({
    mutationFn: async ({ membershipId, categoryId }: { membershipId: string; categoryId: string | null }) => {
      await updateMemberOperatorCategoryRpc(membershipId, categoryId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vineyard-members-rows", selectedVineyardId] });
      toast({ title: "Operator category updated" });
    },
    onError: (e) => {
      toast({ title: "Couldn't update category", description: describeMemberWriteError(e), variant: "destructive" });
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ membershipId, role }: { membershipId: string; role: MemberRole }) => {
      await updateMemberRole(membershipId, role);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Role updated" });
    },
    onError: (e) => {
      toast({ title: "Couldn't update role", description: describeMemberMgmtError(e), variant: "destructive" });
    },
  });

  const removeMut = useMutation({
    mutationFn: async (membershipId: string) => {
      await removeMember(membershipId);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Member removed" });
    },
    onError: (e) => {
      toast({ title: "Couldn't remove member", description: describeMemberMgmtError(e), variant: "destructive" });
    },
  });

  const cancelMut = useMutation({
    mutationFn: cancelInvitation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vineyard-invitations", selectedVineyardId] });
      toast({ title: "Invite cancelled" });
    },
    onError: (e) => {
      toast({ title: "Couldn't cancel invite", description: describeInvitationError(e), variant: "destructive" });
    },
  });

  const resendMut = useMutation({
    mutationFn: (id: string) => resendInvitation(id, 14),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vineyard-invitations", selectedVineyardId] });
      toast({
        title: "Invite reactivated",
        description: "Expiry extended by 14 days. (No email is sent yet.)",
      });
    },
    onError: (e) => {
      toast({ title: "Couldn't resend invite", description: describeInvitationError(e), variant: "destructive" });
    },
  });

  const pendingInvites = invitations.filter((i) => i.status === "pending");
  const otherInvites = invitations.filter((i) => i.status !== "pending" && i.status !== "accepted");

  const colCount = canEdit ? 5 : 4;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Team</h1>
          <p className="text-sm text-muted-foreground">
            Invite users, manage roles, and assign operator categories.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setInviteOpen(true)} disabled={!selectedVineyardId}>
            <Plus className="h-4 w-4 mr-2" /> Invite user
          </Button>
        )}
      </div>

      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Read-only — only owners and managers can invite users or change team access.
        </div>
      )}

      {rawCategories.length > categories.length && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200">
          Duplicate operator categories detected — hiding {rawCategories.length - categories.length} from the dropdown so each appears once.
        </div>
      )}

      {data?.forbidden && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You don't have permission to view this vineyard team.
        </div>
      )}

      {/* Active members */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Active members</h2>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Operator category</TableHead>
                <TableHead>Joined</TableHead>
                {canEdit && <TableHead className="w-12"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {error && (
                <TableRow><TableCell colSpan={colCount} className="text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
              )}
              {!isLoading && !error && !data?.forbidden && data?.members.length === 0 && (
                <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground">No members.</TableCell></TableRow>
              )}
              {data?.members.map((m) => {
                const primary = m.display_name?.trim() || "Unknown member";
                const secondary = m.email && m.email.trim() && m.email.trim() !== primary ? m.email.trim() : null;
                const membershipId = membershipIdByUserId.get(m.user_id) ?? null;
                const rawCatId = membershipId ? categoryByMembership.get(membershipId) ?? null : null;
                const currentCatId = rawCatId ? categoryIdToKeptId.get(rawCatId) ?? rawCatId : null;
                const currentCat = currentCatId ? categories.find((c) => c.id === currentCatId) : null;
                const isMemberOwner = m.role === "owner";
                const canEditRole = isOwner; // only owners change roles
                const canRemove = isOwner && !isMemberOwner; // owner can remove non-owners; last-owner guard server-side
                return (
                  <TableRow key={m.membership_id}>
                    <TableCell title={m.user_id}>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={primary} /> : null}
                          <AvatarFallback>{initials(m.display_name, m.user_id)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{primary}</div>
                          {secondary && (<div className="text-xs text-muted-foreground truncate">{secondary}</div>)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {canEditRole && membershipId ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => setRole.mutate({ membershipId, role: v as MemberRole })}
                          disabled={setRole.isPending}
                        >
                          <SelectTrigger className="w-36 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MEMBER_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{m.role}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit && membershipId ? (
                        <Select
                          value={currentCatId ?? NONE}
                          onValueChange={(v) =>
                            setCategory.mutate({ membershipId, categoryId: v === NONE ? null : v })
                          }
                          disabled={setCategory.isPending}
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue placeholder="No category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No category</SelectItem>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name ?? "Unnamed"}
                                {canSeeCosts && c.cost_per_hour != null
                                  ? ` — $${Number(c.cost_per_hour).toFixed(2)}/h`
                                  : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">{currentCat?.name ?? "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(m.joined_at)}</TableCell>
                    {canEdit && (
                      <TableCell>
                        {canRemove && membershipId ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={removeMut.isPending}
                            onClick={() => {
                              if (confirm(`Remove ${primary} from this vineyard?`)) {
                                removeMut.mutate(membershipId);
                              }
                            }}
                            aria-label="Remove member"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : null}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </section>

      {/* Pending invitations */}
      {canEdit && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Pending invitations
          </h2>
          <p className="text-xs text-muted-foreground">
            Invitees will see the invite when they sign in with the matching email. No email is sent yet.
          </p>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Operator category</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitesLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!invitesLoading && pendingInvites.length === 0 && otherInvites.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No invitations.</TableCell></TableRow>
                )}
                {[...pendingInvites, ...otherInvites].map((inv) => (
                  <InvitationRow
                    key={inv.id}
                    inv={inv}
                    categoryName={(() => {
                      const id = inv.default_operator_category_id;
                      if (!id) return null;
                      const kept = categoryIdToKeptId.get(id) ?? id;
                      return categories.find((c) => c.id === kept)?.name ?? null;
                    })()}
                    onCancel={() => cancelMut.mutate(inv.id)}
                    onResend={() => resendMut.mutate(inv.id)}
                    cancelling={cancelMut.isPending}
                    resending={resendMut.isPending}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        vineyardId={selectedVineyardId}
        categories={categories}
        canSeeCosts={canSeeCosts}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["vineyard-invitations", selectedVineyardId] });
          setInviteOpen(false);
        }}
      />
    </div>
  );
}

function InvitationRow({
  inv,
  categoryName,
  onCancel,
  onResend,
  cancelling,
  resending,
}: {
  inv: VineyardInvitation;
  categoryName: string | null;
  onCancel: () => void;
  onResend: () => void;
  cancelling: boolean;
  resending: boolean;
}) {
  const isPending = inv.status === "pending";
  const isExpired = inv.status === "expired";
  return (
    <TableRow>
      <TableCell className="font-medium">{inv.email}</TableCell>
      <TableCell><Badge variant="secondary">{inv.role}</Badge></TableCell>
      <TableCell className="text-sm">{categoryName ?? "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={isPending ? "default" : "outline"} className="capitalize">
          {inv.status}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex gap-1 justify-end">
          {(isPending || isExpired) && (
            <Button
              variant="ghost"
              size="icon"
              title="Reactivate / extend"
              disabled={resending}
              onClick={onResend}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          {isPending && (
            <Button
              variant="ghost"
              size="icon"
              title="Cancel"
              disabled={cancelling}
              onClick={onCancel}
            >
              <X className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  vineyardId,
  categories,
  canSeeCosts,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string | null;
  categories: { id: string; name?: string | null; cost_per_hour?: number | null }[];
  canSeeCosts: boolean;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("operator");
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [expiresInDays, setExpiresInDays] = useState<string>("14");

  const reset = () => {
    setEmail(""); setRole("operator"); setCategoryId(NONE); setExpiresInDays("14");
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!vineyardId) throw new Error("No vineyard selected");
      const days = Math.max(1, Math.min(365, Number(expiresInDays) || 14));
      return createInvitation({
        vineyard_id: vineyardId,
        email,
        role,
        operator_category_id: categoryId === NONE ? null : categoryId,
        expires_in_days: days,
      });
    },
    onSuccess: () => {
      toast({
        title: "Invitation created",
        description: "The user will see it when they sign in with this email.",
      });
      reset();
      onCreated();
    },
    onError: (e) => {
      toast({ title: "Couldn't create invite", description: describeInvitationError(e), variant: "destructive" });
    },
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Creates an invitation row. The user will see it when they sign in with this email — no email is sent yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              maxLength={255}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as InvitationRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INVITE_ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Default operator category (optional)</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="No category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No category</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name ?? "Unnamed"}
                    {canSeeCosts && c.cost_per_hour != null
                      ? ` — $${Number(c.cost_per_hour).toFixed(2)}/h`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-expires">Expires in (days)</Label>
            <Input
              id="invite-expires"
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-message">Message (optional)</Label>
            <Textarea
              id="invite-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a short note for the invitee."
              maxLength={500}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !emailValid || !vineyardId}
          >
            {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
