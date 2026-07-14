import { useVineyard } from "@/context/VineyardContext";
import { BetaAdminBanner } from "@/components/BetaAdminBanner";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Scissors } from "lucide-react";

export default function PruningTrackerPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyard = memberships.find((m) => m.vineyard_id === selectedVineyardId);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHead title="Pruning Tracker" description="Track pruning progress across the vineyard." />
      <BetaAdminBanner />

      <div className="flex items-center gap-3 mb-6">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Scissors className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pruning Tracker</h1>
          <p className="text-sm text-muted-foreground">
            {vineyard?.vineyard_name
              ? `Vineyard: ${vineyard.vineyard_name}`
              : "No vineyard selected"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming next</CardTitle>
          <CardDescription>
            The full Pruning Tracker interface — vineyard progress summary,
            block list, row-quarter selection, Complete Today form and activity
            history — ships in the next slice. This scaffold confirms admin
            gating, routing and vineyard context are wired correctly.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Currently selected vineyard ID: <code className="text-foreground">{selectedVineyardId ?? "—"}</code></p>
          <p>
            This tool will read from the shared pruning tables (pruning_seasons,
            pruning_entries, pruning_row_segments) and paddocks.rows already
            used by the iOS and Android apps.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
