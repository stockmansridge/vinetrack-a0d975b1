import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
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
import { usePendingInvites } from "@/hooks/usePendingInvites";
import { formatDate } from "@/lib/dateFormat";
import {
  acceptInvitation,
  declineInvitation,
  PendingInvite,
} from "@/lib/pendingInvitesQuery";
import {
  clearDismissedInvites,
  dismissInviteForSession,
  getDismissedInvites,
  maybeClearInviteDismissalsFromQuery,
  shouldIgnoreInviteDismissal,
} from "@/lib/pendingInviteDismissal";

const INVITE_BANNER_HIDE_KEY = "vt_hide_pending_invite_banner";

function getInviteBannerHidden() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(INVITE_BANNER_HIDE_KEY) === "1";
}

function setInviteBannerHidden(hidden: boolean) {
  if (typeof window === "undefined") return;
  if (hidden) {
    sessionStorage.setItem(INVITE_BANNER_HIDE_KEY, "1");
    return;
  }
  sessionStorage.removeItem(INVITE_BANNER_HIDE_KEY);
}

function usePendingInviteActions(invites: PendingInvite[]) {
  const { selectVineyard } = useVineyard();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const accept = useMutation({
    mutationFn: async (id: string) => acceptInvitation(id),
    onSuccess: async (_d, id) => {
      const inv = invites.find((i) => i.id === id);
      clearDismissedInvites();
      setInviteBannerHidden(false);
      // Refetch BEFORE selecting the vineyard, so the VineyardContext
      // doesn't immediately clear the selection because the new
      // membership isn't in its cached list yet.
      await Promise.all([
        qc.refetchQueries({ queryKey: ["memberships"] }),
        qc.refetchQueries({ queryKey: ["pending-invites"] }),
        qc.invalidateQueries({ queryKey: ["vineyards"] }),
        qc.invalidateQueries({ queryKey: ["accessible-vineyards"] }),
      ]);
      if (inv) {
        const memberships =
          (qc.getQueriesData({ queryKey: ["memberships"] })?.[0]?.[1] as
            | { vineyard_id: string; role: string }[]
            | undefined) ?? [];
        const accepted = memberships.find((m) => m.vineyard_id === inv.vineyard_id);
        if (accepted) {
          selectVineyard(inv.vineyard_id);
          toast({ title: "Invitation accepted", description: "Your vineyard access has been updated." });
          navigate("/dashboard", { replace: true });
        } else {
          toast({
            title: "Invitation accepted",
            description: "Your vineyard access has been updated. If the new vineyard doesn't appear, please refresh.",
          });
        }
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
      clearDismissedInvites();
      setInviteBannerHidden(false);
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

function PendingInviteErrorCard({
  title,
  description,
  onRetry,
  compact = false,
}: {
  title: string;
  description: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardHeader className={compact ? "pb-3" : undefined}>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
          <span>Couldn't check invitations right now.</span>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

export function PendingInvitationsSection({
  title = "Pending invitations",
  description = "Accept an invitation to join an existing vineyard.",
}: {
  title?: string;
  description?: string;
}) {
  const { data: invites = [], isLoading, error, refetch, isFetching } = usePendingInvites();
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
      <PendingInviteErrorCard
        title={title}
        description={description}
        onRetry={() => {
          void refetch();
        }}
      />
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
                <Badge variant="outline">Expires {formatDate(invite.expires_at)}</Badge>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => accept.mutate(invite.id)} disabled={accept.isPending || decline.isPending || isFetching}>
                {accept.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Accept invite
              </Button>
              <Button variant="outline" onClick={() => decline.mutate(invite.id)} disabled={accept.isPending || decline.isPending || isFetching}>
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

export function PendingInvitesBanner() {
  const navigate = useNavigate();
  const { data: invites = [], isLoading, error } = usePendingInvites();
  const { accept } = usePendingInviteActions(invites);
  const [hidden, setHidden] = useState(getInviteBannerHidden);

  useEffect(() => {
    if (invites.length > 0) {
      setHidden(getInviteBannerHidden());
      return;
    }
    setInviteBannerHidden(false);
    setHidden(false);
  }, [invites.length]);

  if (isLoading || error || hidden || invites.length === 0) return null;

  const current = invites[0];

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(26rem,calc(100vw-2rem))]">
      <Card className="border-primary/30 shadow-lg">
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <p className="text-sm font-medium">You have a pending vineyard invitation.</p>
            <p className="text-sm text-muted-foreground">
              Sign in email: {current.email} · Role: {current.role}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/select-vineyard")}>View</Button>
            <Button size="sm" onClick={() => accept.mutate(current.id)} disabled={accept.isPending}>
              {accept.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setInviteBannerHidden(true);
                setHidden(true);
              }}
            >
              Not now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PendingInvitesModal() {
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
    if (!import.meta.env.DEV) return;
    console.info("[auth-flow]", {
      phase: "pending-invites:modal",
      suppressed: current ? !shouldIgnoreInviteDismissal() && getDismissedInvites().has(current.id) : false,
      visibleCount: visible.length,
      error: error ? (error as { message?: string }).message ?? String(error) : null,
    });
  }, [current, error, visible.length]);

  if (!current) return null;

  const expiry = current.expires_at
    ? formatDate(current.expires_at)
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
