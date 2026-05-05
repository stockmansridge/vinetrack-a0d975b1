import { useQuery } from "@tanstack/react-query";
import { useVineyard } from "@/context/VineyardContext";
import { fetchCount } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Map, Tractor, SprayCan, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const tiles = [
  { key: "paddocks", label: "Paddocks", icon: Map },
  { key: "tractors", label: "Tractors", icon: Tractor },
  { key: "spray_equipment", label: "Spray equipment", icon: SprayCan },
];

function Tile({ table, label, Icon, vineyardId }: { table: string; label: string; Icon: any; vineyardId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["count", table, vineyardId],
    queryFn: () => fetchCount(table, vineyardId),
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">
          {isLoading ? "…" : error ? "—" : data}
        </div>
      </CardContent>
    </Card>
  );
}

function TeamTile({ vineyardId }: { vineyardId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["count", "vineyard_members", vineyardId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("vineyard_members")
        .select("*", { count: "exact", head: true })
        .eq("vineyard_id", vineyardId);
      if (error) throw error;
      return count ?? 0;
    },
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Team members</CardTitle>
        <Users className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{isLoading ? "…" : data}</div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyard = memberships.find((m) => m.vineyard_id === selectedVineyardId);

  if (!selectedVineyardId) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{vineyard?.vineyard_name ?? "Dashboard"}</h1>
        <p className="text-sm text-muted-foreground">Read-only overview</p>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Tile key={t.key} table={t.key} label={t.label} Icon={t.icon} vineyardId={selectedVineyardId} />
        ))}
        <TeamTile vineyardId={selectedVineyardId} />
      </div>
    </div>
  );
}
