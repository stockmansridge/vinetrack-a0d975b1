import { Navigate, useNavigate } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreateVineyardDialog } from "@/components/vineyard/CreateVineyardDialog";
import {
  PendingInvitationsSection,
} from "@/components/invites/PendingInvitesModal";
import { ArchivedVineyardsSection } from "@/components/vineyard/ArchivedVineyardsSection";
import { usePendingInvites } from "@/hooks/usePendingInvites";
import { useQuery } from "@tanstack/react-query";
import { fetchArchivedVineyardsForOwner } from "@/lib/vineyardSettingsQuery";

export default function SelectVineyard() {
  const { memberships, loading, selectVineyard, selectedVineyardId } = useVineyard();
  const { signOut, user } = useAuth();
  const {
    data: pendingInvites = [],
    isLoading: invitesLoading,
    error: pendingInvitesError,
  } = usePendingInvites();
  const { data: archivedVineyards = [], isLoading: archivedLoading } = useQuery({
    queryKey: ["archived-vineyards", user?.id],
    enabled: !!user,
    queryFn: () => fetchArchivedVineyardsForOwner(user!.id),
  });
  const navigate = useNavigate();

  if (loading || invitesLoading || archivedLoading) {
    return <div className="p-8">Loading vineyards…</div>;
  }

  // If the user has no memberships, no pending invites, and no archived
  // vineyards to restore, force onboarding.
  if (
    memberships.length === 0 &&
    pendingInvites.length === 0 &&
    archivedVineyards.length === 0 &&
    !pendingInvitesError
  ) {
    return <Navigate to="/onboarding" replace />;
  }
  if (memberships.length > 0 && selectedVineyardId) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-muted/30 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold">
              {memberships.length === 0 ? "Welcome to VineTrack" : "Select a vineyard"}
            </h1>
            <p className="text-muted-foreground">
              {memberships.length === 0
                ? pendingInvitesError
                  ? "We couldn't check invitations right now. Retry below, or create a new vineyard."
                  : "You have a pending invitation. Accept it, or create a new vineyard."
                : "Choose which vineyard to manage."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CreateVineyardDialog onCreated={() => navigate("/dashboard")} />
            <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
          </div>
        </div>
        {memberships.length === 0 && pendingInvites.length > 0 && (
          <div className="mb-6 rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {pendingInvites.length === 1
                ? "You have a pending vineyard invitation."
                : `You have ${pendingInvites.length} pending vineyard invitations.`}{" "}
              Accept it below, or create your own vineyard above.
            </p>
          </div>
        )}
        <div className="mb-6">
          <PendingInvitationsSection
            title="Pending invitations"
            description="Accept an invite before creating your first vineyard."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {memberships.map((m) => (
            <Card
              key={m.vineyard_id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => {
                selectVineyard(m.vineyard_id);
                navigate("/dashboard");
              }}
            >
              <CardHeader>
                <CardTitle className="text-lg">{m.vineyard_name ?? m.vineyard_id}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="secondary">{m.role}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-8">
          <ArchivedVineyardsSection />
        </div>
      </div>
    </div>
  );
}
