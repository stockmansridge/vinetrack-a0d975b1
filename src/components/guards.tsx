import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import {
  PendingInvitesModal,
  usePendingInvites,
} from "@/components/invites/PendingInvitesModal";

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
  const { data: pendingInvites = [], isLoading: invitesLoading } = usePendingInvites();
  if (loading || invitesLoading)
    return <div className="p-8 text-muted-foreground">Loading vineyards…</div>;
  if (memberships.length === 0) {
    // If there's a pending invite waiting, route to the selector so the
    // PendingInvitesModal can be acted on without forcing vineyard creation.
    if (pendingInvites.length > 0) return <Navigate to="/select-vineyard" replace />;
    return <Navigate to="/onboarding" replace />;
  }
  if (!selectedVineyardId) return <Navigate to="/select-vineyard" replace />;
  return <Outlet />;
}
