import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  describePendingInviteLookupError,
  fetchPendingInvitesForEmail,
  isPendingInviteLookupTimeout,
} from "@/lib/pendingInvitesQuery";

const PENDING_INVITES_TIMEOUT_MS = 6_000;

export function usePendingInvites() {
  const { user } = useAuth();
  const email = user?.email?.trim() ?? "";

  return useQuery({
    queryKey: ["pending-invites", email.toLowerCase()],
    enabled: !!email,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
    queryFn: async () => {
      const startedAt = performance.now();
      const normalisedEmail = email.toLowerCase();

      if (import.meta.env.DEV) {
        console.info("[auth-flow]", {
          phase: "pending-invites:start",
          userEmail: email,
          normalisedEmail,
        });
      }

      try {
        const invites = await fetchPendingInvitesForEmail(email, {
          timeoutMs: PENDING_INVITES_TIMEOUT_MS,
        });

        if (import.meta.env.DEV) {
          console.info("[auth-flow]", {
            phase: "pending-invites:end",
            userEmail: email,
            normalisedEmail,
            pendingInvitesCount: invites.length,
            pendingInvitesMs: Math.round(performance.now() - startedAt),
            inviteStatuses: invites.map((invite) => ({
              id: invite.id,
              status: invite.status,
              expiresAt: invite.expires_at,
            })),
            pendingInvitesError: null,
          });
        }

        return invites;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.info("[auth-flow]", {
            phase: "pending-invites:error",
            userEmail: email,
            normalisedEmail,
            pendingInvitesCount: 0,
            pendingInvitesMs: Math.round(performance.now() - startedAt),
            pendingInvitesError: describePendingInviteLookupError(error),
            timedOut: isPendingInviteLookupTimeout(error),
          });
        }
        throw error;
      }
    },
  });
}