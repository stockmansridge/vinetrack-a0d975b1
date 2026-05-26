import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  acceptInvitation,
  declineInvitation,
  fetchPendingInvitesForEmail,
  PendingInvite,
} from "@/lib/pendingInvitesQuery";
import {
  clearDismissedInvites,
  dismissInviteForSession,
  getDismissedInvites,
  maybeClearInviteDismissalsFromQuery,
  shouldIgnoreInviteDismissal,
} from "@/lib/pendingInviteDismissal";

export function usePendingInvites() {
  const { user } = useAuth();
  const email = user?.email ?? "";
  const query = useQuery({
    queryKey: ["pending-invites", email.toLowerCase()],
    enabled: !!email,
    queryFn: () => fetchPendingInvitesForEmail(email),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!import.meta.env.DEV || !email) return;
    console.info("[invites] lookup", {
      userId: user?.id ?? null,
      email,
      count: query.data?.length ?? 0,
      error: query.error ? (query.error as { message?: string }).message ?? String(query.error) : null,
    });
  }, [email, query.data?.length, query.error, user?.id]);
  return query;
}

function usePendingInviteActions(invites: PendingInvite[]) {
  const { user } = useAuth();
  const { selectVineyard } = useVineyard();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const accept = useMutation({
    mutationFn: async (id: string) => acceptInvitation(id),
    onSuccess: async (_d, id) => {
      const inv = invites.find((i) => i.id === id);
      await qc.refetchQueries({ queryKey: ["memberships", user?.id] });
      await qc.refetchQueries({ queryKey: ["pending-invites"] });
      if (inv) {
        selectVineyard(inv.vineyard_id);
        toast({ title: "Invitation accepted", description: "Your vineyard access has been updated." });
        navigate("/dashboard", { replace: true });
      }
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't accept invite",
        description: (e as { message?: string })?.message ?? "Please try again.",
        variant: "destructive",
      }),
  });

  const decline = useMutation({
    mutationFn: async (id: string) => declineInvitation(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pending-invites"] });
      toast({ title: "Invitation declined" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't decline invite",
        description: (e as { message?: string })?.message ?? "Please try again.",
        variant: "destructive",
      }),
  });

  return { accept, decline };
}

export function PendingInvitationsSection({
  title = "Pending invitations",
  description = "Accept an invitation to join an existing vineyard.",
}: {
  title?: string;
  description?: string;
}) {
  const { data: invites = [], isLoading, error } = usePendingInvites();
  const { accept, decline } = usePendingInviteActions(invites);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading invitations…</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          We couldn't load your invitations right now.
        </CardContent>
      </Card>
    );
  }

  if (invites.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invites.map((invite) => (
          <div key={invite.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="capitalize">{invite.role}</Badge>
              <Badge variant="outline">{invite.email}</Badge>
              {invite.expires_at && (
                <Badge variant="outline">Expires {new Date(invite.expires_at).toLocaleDateString()}</Badge>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => accept.mutate(invite.id)} disabled={accept.isPending || decline.isPending}>
                {accept.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Accept invite
              </Button>
              <Button variant="outline" onClick={() => decline.mutate(invite.id)} disabled={accept.isPending || decline.isPending}>
                {decline.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Decline
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PendingInvitesModal() {
  const { user } = useAuth();
  const { memberships } = useVineyard();
  const { data: invites = [], error } = usePendingInvites();
  const [dismissedTick, setDismissedTick] = useState(0);
  const { accept, decline } = usePendingInviteActions(invites);

  useEffect(() => {
    maybeClearInviteDismissalsFromQuery();
  }, []);

  const visible = useMemo(() => {
    if (shouldIgnoreInviteDismissal()) return invites;
    return invites.filter((i) => !getDismissedInvites().has(i.id));
  }, [dismissedTick, invites]);
  const current: PendingInvite | undefined = visible[0];
  const open = !!current;

  useEffect(() => {
    if (!import.meta.env.DEV || !user?.email) return;
    console.info("[invites] modal", {
      userId: user.id,
      email: user.email,
      memberships: memberships.length,
      suppressed: current ? !shouldIgnoreInviteDismissal() && getDismissedInvites().has(current.id) : false,
      visibleCount: visible.length,
      error: error ? (error as { message?: string }).message ?? String(error) : null,
    });
  }, [current, error, memberships.length, user?.email, user?.id, visible.length]);

  if (!current) return null;

  const expiry = current.expires_at
    ? new Date(current.expires_at).toLocaleDateString()
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          dismissInviteForSession(current.id);
          setDismissedTick((t) => t + 1);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You've been invited to join a vineyard</DialogTitle>
          <DialogDescription>
            An invitation for <strong>{current.email}</strong> is waiting. Accept this
            invite to join the vineyard as <strong>{current.role}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary" className="capitalize">Role: {current.role}</Badge>
          {expiry && <Badge variant="outline">Expires {expiry}</Badge>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              dismissInviteForSession(current.id);
              setDismissedTick((t) => t + 1);
            }}
            disabled={accept.isPending || decline.isPending}
          >
            Not now
          </Button>
          <Button
            variant="outline"
            onClick={() => decline.mutate(current.id)}
            disabled={accept.isPending || decline.isPending}
          >
            {decline.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Decline
          </Button>
          <Button
            onClick={() => accept.mutate(current.id)}
            disabled={accept.isPending || decline.isPending}
          >
            {accept.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Accept invite
          </Button>
        </DialogFooter>
        {import.meta.env.DEV && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => { clearDismissedInvites(); setDismissedTick((t) => t + 1); }}>
              Clear invite dismissal
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
