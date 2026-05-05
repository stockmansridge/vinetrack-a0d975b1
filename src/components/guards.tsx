import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";

export function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireVineyard() {
  const { selectedVineyardId, memberships, loading } = useVineyard();
  if (loading) return <div className="p-8 text-muted-foreground">Loading vineyards…</div>;
  if (memberships.length === 0) return <Navigate to="/no-access" replace />;
  if (!selectedVineyardId) return <Navigate to="/select-vineyard" replace />;
  return <Outlet />;
}
