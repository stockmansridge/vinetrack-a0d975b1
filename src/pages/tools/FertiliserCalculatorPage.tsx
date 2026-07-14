import { useVineyard } from "@/context/VineyardContext";
import { BetaAdminBanner } from "@/components/BetaAdminBanner";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export default function FertiliserCalculatorPage() {
  const { selectedVineyardId, memberships } = useVineyard();
  const vineyard = memberships.find((m) => m.vineyard_id === selectedVineyardId);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHead title="Fertiliser Calculator" description="Calculate fertiliser applications and record costs." path="/tools/fertiliser-calculator" />
      <BetaAdminBanner />

      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <FlaskConical className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Fertiliser Calculator</h1>
            <p className="text-sm text-muted-foreground">
              {vineyard?.vineyard_name
                ? `Vineyard: ${vineyard.vineyard_name}`
                : "No vineyard selected"}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/setup/chemicals">Manage saved products</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming next</CardTitle>
          <CardDescription>
            The full Fertiliser Calculator — per-hectare and per-vine modes,
            multi-block allocations, and Draft / Planned / Completed records —
            ships in the next slice. This scaffold confirms admin gating,
            routing and vineyard context are wired correctly.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Currently selected vineyard ID: <code className="text-foreground">{selectedVineyardId ?? "—"}</code></p>
          <p>
            Products will be sourced from the shared <code>saved_chemicals</code>
            library (no portal-only product table). Records will use the shared
            fertiliser_records and fertiliser_record_allocations tables.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
