import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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

const DISMISS_KEY = "vt_dismissed_invites";

function getDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function dismissInvite(id: string) {
  const s = getDismissed();
  s.add(id);
  sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...s]));
}

export function usePendingInvites() {
  const { user } = useAuth();
  const email = user?.email ?? "";
  return useQuery({
    queryKey: ["pending-invites", email.toLowerCase()],
    enabled: !!email,
    queryFn: () => fetchPendingInvitesForEmail(email),
    staleTime: 30_000,
  });
}

export function PendingInvitesModal() {
  const { user } = useAuth();
  const { selectVineyard } = useVineyard();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: invites = [] } = usePendingInvites();
  const [dismissedTick, setDismissedTick] = useState(0);

  const visible = invites.filter((i) => !getDismissed().has(i.id));
  const current: PendingInvite | undefined = visible[0];
  const open = !!current;

  // Re-render when dismissed set changes
  useEffect(() => {
    // noop, just to keep deps explicit
  }, [dismissedTick]);

  const accept = useMutation({
    mutationFn: async (id: string) => acceptInvitation(id),
    onSuccess: async (_d, id) => {
      const inv = invites.find((i) => i.id === id);
      await qc.invalidateQueries({ queryKey: ["memberships", user?.id] });
      await qc.invalidateQueries({ queryKey: ["pending-invites"] });
      if (inv) {
        selectVineyard(inv.vineyard_id);
        toast({
          title: "Invitation accepted",
          description: inv.vineyard_name
            ? `You've joined ${inv.vineyard_name}.`
            : "You've joined the vineyard.",
        });
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

  if (!current) return null;

  const expiry = current.expires_at
    ? new Date(current.expires_at).toLocaleDateString()
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          dismissInvite(current.id);
          setDismissedTick((t) => t + 1);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You've been invited to join a vineyard</DialogTitle>
          <DialogDescription>
            An invitation for <strong>{current.email}</strong> is waiting. Accept this
            invite to join{" "}
            <strong>{current.vineyard_name ?? "the vineyard"}</strong> as{" "}
            <strong>{current.role}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary" className="capitalize">Role: {current.role}</Badge>
          {current.operator_category_name && (
            <Badge variant="secondary">
              Category: {current.operator_category_name}
            </Badge>
          )}
          {expiry && <Badge variant="outline">Expires {expiry}</Badge>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              dismissInvite(current.id);
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
      </DialogContent>
    </Dialog>
  );
}
