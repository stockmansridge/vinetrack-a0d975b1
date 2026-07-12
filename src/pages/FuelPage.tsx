import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useVineyard } from "@/context/VineyardContext";
import FuelPurchasesPage from "./FuelPurchasesPage";
import TractorFuelLogsPage from "./TractorFuelLogsPage";

export default function FuelPage() {
  const { memberships, selectedVineyardId } = useVineyard();
  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;
  const [tab, setTab] = useState<"purchases" | "machine">("purchases");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Fuel Log</h1>
        <p className="text-sm text-muted-foreground">
          Manage fuel purchases and machine refuelling records
          {vineyardName ? ` for ${vineyardName}` : " for the selected vineyard"}.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
        <TabsList className="border-2 border-border bg-muted/80 p-1.5 shadow-sm">
          <TabsTrigger
            value="purchases"
            className="px-5 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
          >
            Purchases
          </TabsTrigger>
          <TabsTrigger
            value="machine"
            className="px-5 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow"
          >
            Machine Logs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="purchases" className="mt-0">
          <FuelPurchasesPage embedded />
        </TabsContent>
        <TabsContent value="machine" className="mt-0">
          <TractorFuelLogsPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
