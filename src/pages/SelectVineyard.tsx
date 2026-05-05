import { Navigate, useNavigate } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SelectVineyard() {
  const { memberships, loading, selectVineyard, selectedVineyardId } = useVineyard();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) return <div className="p-8">Loading vineyards…</div>;
  if (memberships.length === 0) return <Navigate to="/no-access" replace />;
  if (selectedVineyardId) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-muted/30 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold">Select a vineyard</h1>
            <p className="text-muted-foreground">Choose which vineyard to manage.</p>
          </div>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
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
      </div>
    </div>
  );
}
