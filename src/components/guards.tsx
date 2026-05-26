import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import {
  PendingInvitesModal,
} from "@/components/invites/PendingInvitesModal";
import { usePendingInvites } from "@/hooks/usePendingInvites";

export function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <>
      <PendingInvitesModal />
      <Outlet />
    </>
  );
}

export function RequireVineyard() {
  const { selectedVineyardId, memberships, loading } = useVineyard();
  const {
    data: pendingInvites = [],
    isLoading: invitesLoading,
    error: pendingInvitesError,
  } = usePendingInvites();

  if (loading) return <div className="p-8 text-muted-foreground">Loading vineyards…</div>;

  if (import.meta.env.DEV) {
    console.info("[auth-flow]", {
      phase: "route-decision",
      membershipsCount: memberships.length,
      selectedVineyardId,
      pendingInvitesCount: pendingInvites.length,
      pendingInvitesLoading: invitesLoading,
      pendingInvitesError:
        pendingInvitesError
          ? (pendingInvitesError as { message?: string }).message ?? String(pendingInvitesError)
          : null,
    });
  }

  if (memberships.length > 0) {
    if (!selectedVineyardId) return <Navigate to="/select-vineyard" replace />;
    return <Outlet />;
  }

  if (invitesLoading) {
    return <div className="p-8 text-muted-foreground">Loading vineyards…</div>;
  }

  if (memberships.length === 0) {
    if (pendingInvitesError) return <Navigate to="/select-vineyard" replace />;
    if (pendingInvites.length > 0) return <Navigate to="/select-vineyard" replace />;
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
